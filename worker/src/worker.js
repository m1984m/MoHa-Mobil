/**
 * MoHa Mobil — proxy Worker
 *
 * Rešuje dve težavi hkrati:
 *   1. Marpromov OBA vmesnik (živa vozila, prihodi) ne pošilja CORS glav, zato ga
 *      brskalnik ne sme klicati neposredno. Aplikacija je zato uporabljala javna
 *      posrednika corsproxy.io / allorigins — odvisnost od tretje osebe.
 *   2. Ključ za openrouteservice (pešpoti) se je ob gradnji vstavil kot besedilo v
 *      JavaScript paket in je bil na javni strani berljiv za vsakogar.
 *
 * Worker je edina točka, ki gre navzven: OBA doda CORS in predpomnjenje, ORS pa
 * dobi ključ šele tu, na strežniku.
 *
 * Poti:
 *   GET  /oba/GetLines
 *   GET  /oba/GetActiveDeviceDetails
 *   GET  /oba/GetArrivalsForStopPoint?stopPointId=123
 *   POST /ors/directions/foot-walking/geojson
 *   POST /ors/matrix/foot-walking
 *   POST /tts                     (glasno branje, glej tts.js)
 *   GET  /health
 *
 * Tretja naloga (dodano kasneje): alarm za odhod avtobusa. Telefon sme obvestilo
 * prikazati tudi, ko je aplikacija zaprta, samo prek potisne storitve brskalnika
 * — to pa zahteva strežnik, ki ob pravi minuti pošlje potisk. Zato:
 *   POST   /alarms/sync           shrani naročnino + čase zvonjenja
 *   DELETE /alarms/sync           pobriše naročnino
 *   GET    /alarms/status         stanje naročnine + javni ključ VAPID
 * in cron, ki se sproži vsako minuto (glej `scheduled` na dnu).
 *
 * Vse drugo vrne 404. Namerno: Worker ni splošen odprt proxy — brez tega bi ga
 * lahko kdorkoli uporabil za poljubne zahteve na tvoj račun.
 */

import { sendPush } from './push.js';
import { recordUpstream, handleEvent } from './analytics.js';
import { handleStat } from './stat.js';
import { processDue, DUE_WINDOW_MS } from './due.js';
import {
  OBA_BASE, OBA_METHODS, STALE_MAX_MS, TTL_PRAZNO, OBA_HEADERS,
  kljucPredpomnilnika, zaPredpomnilnik, razvrstiOdgovor,
} from './oba.js';
import { ogrejPredpomnilnik } from './warm.js';
import { handleTts } from './tts.js';

// Marprom je dosegljiv NEPOSREDNO samo, kadar Worker nima nastavljenega OBA_RELAY.
// Pot Cloudflare → vozniredi.marprom.si je NEZANESLJIVA in to niha po urah.
// 16.09.2026 je bila blokada popolna (s Cloudflarovega roba 522 po 19,5 s, z
// domačega omrežja 200 v 0,11 s), 22.09. pa delna: izmerjenih 15 klicev z roba
// = 3 uspehi in 12 iztekov časa, isti trenutek neposredno 15/15 v ~0,15 s.
// Vmes so ure brez ene same napake (11.–13. ura istega dne, 999 klicev).
// Ni kriv naš User-Agent (neposredno z istim 10/10) in ni Marpromov strežnik
// preobremenjen (neposredno odgovarja sproti) — gre za omrežno pot.
//
// Zato ta Worker klic OBA ob zamudi pošlje še na naslednji posrednik (glej
// ZAMIK_REZERVE_MS) in ob neuspehu postreže zadnji znani odgovor iz
// predpomnilnika. Od 05.10.2026 je blokada spet stalna in OBA_RELAY je nastavljen:
// Deno Deploy (Google), nato Vercel (AWS Stockholm), glej relay/README.md in
// relay-vercel/README.md. Ko Marprom odblokira Cloudflare, se OBA_RELAY odstrani
// in Worker spet kliče neposredno; rezerva in zasilni odgovor ostaneta varovalka.
// OBA_BASE, OBA_METHODS (s TTL) in STALE_MAX_MS so v oba.js, ker jih uporablja tudi cron.
const ORS_BASE = 'https://api.openrouteservice.org/v2';

// Dovoljeni ORS endpointi (natančno tisti, ki ju kliče aplikacija).
const ORS_PATHS = new Set([
  '/directions/foot-walking/geojson',
  '/matrix/foot-walking',
]);

const MAX_ORS_COORDS = 30;      // matrix pošlje izhodišče + do 25 postaj
const MAX_ORS_BODY = 8 * 1024;  // 8 kB je za te zahteve več kot dovolj

// ORS s Cloudflarovega roba ne odgovori: 12.10.2026 so bili 4 klici od 4 iztek
// časa po 9 s, z domačega omrežja in iz Google Cloud pa je odgovor prišel v
// 0,11 s — enak vzorec kot pri Marpromu. Zato najprej kratek neposreden poskus,
// nato posredniki iz OBA_RELAY po vrsti (posrednik ORS kliče sam, glej
// relay/README.md). Za razliko od OBA tu ni vzporedne rezerve: vsak klic, ki
// pride do ORS, gre v skupno dnevno kvoto ključa, zato naslednja pot dobi klic
// šele, ko prejšnja odpove. Neposredna pot, ki odpove, gre za KAZEN_MS na konec.
//
// Čas: neposredna pot dobi le 0,8 s (zdrav ORS odgovori v 0,1–0,6 s), preostanek
// do 5,5 s pa si posredniki razdelijo enakomerno (`razdeli` v klicNavzgor). Prej je
// neposredna pot vzela 2,5 s, prvi posrednik ostanek, in drugi posrednik ob
// visečem prvem na hladnem izolatu sploh ni prišel na vrsto (pregled 12.10.2026).
// Z dvema posrednikoma dobi vsak 2,35 s (oziroma 2,75 s, ko je neposredna pot na
// kazni) — več, kot posrednik sam čaka na ORS (2 s), zato pride njegov 502 prej.
const ORS_DIREKTNO_MS = 800;    // neposreden poskus, kadar obstajajo posredniki
const ORS_POSREDNIK_MS = 3200;  // zgornja meja za en posrednik
const ORS_SKUPAJ_MS = 5500;     // aplikacija pešpot opusti po 6 s (routing.ts)
// Dovoljene vrste vsebine v odgovoru ORS, ki gre k aplikaciji; vse drugo postane JSON.
const ORS_VSEBINA = new Set(['application/json', 'application/geo+json']);

// IZMERJENO 22.09.2026: ponavljanje klica ZNOTRAJ istega klica Workerja ne
// pomaga. Ob 3 poskusih so uspeli 2 klica od 21, ob enem samem 3 od 15 — če bi
// bili poskusi neodvisni, bi trije dali okoli 50 %. Kadar prvi poskus visi,
// visijo vsi trije; nov klic Workerja pa ima spet svojo možnost. Zato je na
// vsako pot en sam poskus, in ta je kratek: aplikacija tako hitro dobi zasilni
// ali vozni red, namesto da bi čakala 9 s.
//
// 4 s: najpočasnejši izmerjeni USPEŠEN klic je trajal 3,15 s, vsi ostali pod
// 0,8 s. Nižja meja bi začela rezati zdrave odgovore. Posredniki sami čakajo na
// Marprom največ 3,5 s, zato njihov odgovor (tudi 502) pride prej.
const OBA_TIMEOUT_MS = 4000;

// Več posrednikov (OBA_RELAY) se ne kliče več strogo po vrsti. Prej je visec prvi
// posrednik pomenil 4 s čakanja, preden je šel klic na drugega — izmerjeno 7,5 s
// za vsako postajališče brez predpomnilnika, aplikacija pa odneha po 8 s. Zdaj
// dobi prvi le prednost ZAMIK_REZERVE_MS (zdrav odgovor pride v 0,15–0,8 s); če
// do takrat ne odgovori, gre isti klic še na naslednjega in obvelja prvi veljaven
// odgovor, drugi se prekine. Ob napaki prvega gre naslednji takoj.
const ZAMIK_REZERVE_MS = 800;
// Zgornja meja za vse poskuse enega klica skupaj — varno pod 8 s aplikacije.
const OBA_SKUPAJ_MS = 6000;
// Poskusa, za katerega ostane manj časa, ne začnemo.
const NAJMANJ_ZA_POSKUS_MS = 1000;
// Posrednik, ki je odpovedal ali zaostal za rezervo, gre za toliko časa na konec
// vrste. Spomin je v izolatu (skupen spomin bi pomenil pisanje v KV), kar zadošča,
// da zaporedni klici istega izolata ne čakajo vsakič na isti visec posrednik.
const KAZEN_MS = 60_000;
const slabiCilji = new Map(); // ključ posrednika -> do kdaj je na koncu vrste

// Kadar imamo star odgovor, uporabnik ne čaka celega izteka: klic navzgor dobi
// toliko prednosti, kolikor traja zdrav odgovor (izmerjeno 0,15–0,31 s), potem pa
// gre ven zasilni, klic pa se dokonča v ozadju in napolni predpomnilnik.
const CAKAJ_NA_SVEZE_MS = 700;

const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));

// Ključi, za katere v tem izolatu že teče osvežitev v ozadju — da deset zaporednih
// vpogledov v isto postajališče ne sproži desetih klicev na Marprom.
const vTeku = new Set();


function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

// Vrne glave CORS samo za znane izvore. Neznanemu izvoru ne vrnemo
// Access-Control-Allow-Origin — brskalnik odgovor zavrže.
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const list = allowedOrigins(env);
  const h = { 'Vary': 'Origin' };
  if (origin && list.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, x-stat-key';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(obj, status, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra },
  });
}

// Zahteva mora imeti znan Origin. Brskalnik ga pri klicu na tujo domeno vedno
// pošlje, zato to aplikacije ne prizadene — prepreči pa, da bi kdo s `curl`
// brez glave Origin uporabljal Worker (in tvojo ORS kvoto) mimo omejitev.
function isAllowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  return allowedOrigins(env).includes(origin);
}

// Predpomnilnik v pomnilniku izolata — hitra pot za zaporedne klice istega
// izolata. Glavni predpomnilnik je Cloudflarov `caches.default` spodaj: ta je
// skupen vsem izolatom iste lokacije in 22.09.2026 je IZMERJENO, da na
// *.workers.dev deluje (X-Proxy-Cache: HIT). Prej je tu pisalo, da ne deluje;
// to ne drži več in je pomembno, ker je zasilni odgovor odvisen prav od njega
// (odgovor, ki ga je prinesel en izolat, mora biti na voljo vsem).
const memCache = new Map(); // url -> { body, ob, exp, prazno }

// Vrne shranjeni odgovor skupaj z njegovo starostjo in podatkom, ali mu je TTL
// že potekel. Potekli vnos se ne zavrže takoj: dokler ni starejši od
// STALE_MAX_MS, je še vedno boljsi od prazne postaje, kadar Marprom ne odgovori.
// Izjema je odgovor »ni podatkov« (`prazno`): ta kot zasilni ne velja nikoli.
function memBrani(key) {
  const hit = memCache.get(key);
  if (!hit) return null;
  const zdaj = Date.now();
  if (zdaj > hit.exp + (hit.prazno ? 0 : STALE_MAX_MS)) { memCache.delete(key); return null; }
  return {
    body: hit.body,
    starost: Math.round((zdaj - hit.ob) / 1000),
    potekel: zdaj > hit.exp,
    prazno: !!hit.prazno,
  };
}

// Isto za predpomnilnik na robu. Nikoli ne vrže: pokvarjeno branje pomeni samo,
// da kandidata ni in gre klic navzgor.
async function beriRob(cache, cacheKey, ttl) {
  try {
    const hit = await cache.match(cacheKey);
    if (!hit) return null;
    const starost = Number(hit.headers.get('Age') ?? 0) || 0;
    const prazno = hit.headers.get('X-Oba-Prazno') === '1';
    return {
      body: await hit.text(),
      starost,
      potekel: starost > (prazno ? TTL_PRAZNO : ttl),
      prazno,
      vir: 'edge',
    };
  } catch {
    return null;
  }
}

/**
 * Popravi ETAMin za starost odgovora.
 *
 * `ETAMin` je število minut DO prihoda, merjeno v trenutku, ko je Marprom
 * odgovor sestavil — torej edino polje, ki se s stanjem v predpomnilniku
 * pokvari. `ArrivalTime` (vozni red) in `DelayMin` (zamuda) ostaneta veljavna.
 *
 * Brez tega popravka bi 40-sekundni predpomnilnik avtobus kazal dlje, kot je
 * v resnici, kar je ravno nevarna smer napake: potnik misli, da ima še čas.
 * Prihodi, ki so med čakanjem v predpomnilniku že minili, izpadejo.
 */
function popraviEta(body, starostSek) {
  const minute = Math.round(starostSek / 60);
  if (minute < 1) return body;
  let j;
  try { j = JSON.parse(body); } catch { return body; }
  const seznam = j && j.ArrivalsForStopPoints;
  if (!Array.isArray(seznam)) return body;
  j.ArrivalsForStopPoints = seznam
    .map(a => (typeof a.ETAMin === 'number' ? { ...a, ETAMin: a.ETAMin - minute } : a))
    .filter(a => typeof a.ETAMin !== 'number' || a.ETAMin >= 0);
  return JSON.stringify(j);
}

/**
 * Enak popravek za vozila (GetActiveDeviceDetails). `ETA` je relativen čas v
 * minutah, izmerjen ob sestavi odgovora, in aplikacija z njim nadomesti prihod
 * avtobusa, ki je do 2 minuti stran — star ETA bi tam kazal več časa, kot ga je.
 * Vozila ostanejo vsa: ETA je lahko tudi negativen in ta pomen ohranimo,
 * odštejemo samo pretečene minute (zaokrožene enako kot pri prihodih).
 */
function popraviEtaVozil(body, starostSek) {
  const minute = Math.round(starostSek / 60);
  if (minute < 1) return body;
  let j;
  try { j = JSON.parse(body); } catch { return body; }
  const seznam = j && j.Vehicles;
  if (!Array.isArray(seznam)) return body;
  j.Vehicles = seznam.map(v => (v && typeof v.ETA === 'number' ? { ...v, ETA: v.ETA - minute } : v));
  return JSON.stringify(j);
}

function memPut(key, body, ttlSec, prazno = false) {
  // Zgornja meja vnosov, da izolat ne raste v nedogled (postaj je ~460).
  if (memCache.size > 600) memCache.clear();
  const zdaj = Date.now();
  memCache.set(key, { body, ob: zdaj, exp: zdaj + ttlSec * 1000, prazno });
}

// Seznam posrednikov iz OBA_RELAY (ločeni z vejicami, v vrstnem redu poskusov).
// Isti posredniki nosijo OBA in ORS.
function posredniki(env) {
  return String(env.OBA_RELAY ?? '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
}

// Omejevalnik na naslov IP prek vezave [[ratelimits]] (brez pisanja v KV, ki ima
// svojo dnevno mejo). Brez vezave (npr. lokalni razvoj) omejitve ni, napaka
// omejevalnika pa zahteve ne zavrne — varovalo ne sme ugasniti storitve.
async function omejeno(limiter, request) {
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key: request.headers.get('CF-Connecting-IP') || 'neznan' });
    return !success;
  } catch {
    return false;
  }
}

// ── OBA ───────────────────────────────────────────────────────────────────────

/**
 * En poskus na en cilj (posrednik ali Marprom neposredno). Nikoli ne vrže.
 * Meja časa velja tudi za branje telesa: posrednik lahko pošlje glave in obvisi
 * sredi telesa — prej je tu izjema ušla mimo vseh varoval (Cloudflare 1101 brez
 * glav CORS) in drugi posrednik ni bil nikoli poskušen.
 */
async function poskusiCilj(c, method, ctl, ms) {
  const casovnik = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(c.url, { headers: c.headers, signal: ctl.signal });
    if (!res.ok) {
      try { await res.body?.cancel(); } catch { /* telo nas ne zanima */ }
      // Posrednik ob neznanem Status od Marproma vrne 502 z X-Relay-Razlog.
      const izid = res.headers.get('X-Relay-Razlog') === 'neznano' ? 'neznano' : 'napaka';
      return { vrsta: 'napaka', izid, status: res.status };
    }
    const telo = await res.text();
    const vrsta = razvrstiOdgovor(method, telo);
    // 200 z napako v telesu (HTML, prazno, GetLines brez Status 1) šteje kot
    // napaka in ne kot 'ok', sicer statistika ne bi pokazala, da pot ne dela.
    // Neznan Status se obnaša kot napaka, v statistiki pa je viden posebej.
    return { vrsta: vrsta === 'neznano' ? 'napaka' : vrsta, izid: vrsta, status: 200, telo };
  } catch {
    return { vrsta: 'napaka', izid: 'nedosegljiv', status: 502 };
  } finally {
    clearTimeout(casovnik);
  }
}

/**
 * Klic navzgor čez vse cilje po vrsti, za OBA in ORS.
 *
 * `poskus(c, ctl, ms)` naredi en klic na cilj in vrne { vrsta, izid, status, … };
 * vsak izid z `vrsta` različno od 'napaka' je veljaven in konča klic. Naslednji
 * cilj gre takoj ob napaki prejšnjega, pri OBA pa tudi, če prejšnji po `zamik`
 * ms še ni odgovoril (rezerva, glej ZAMIK_REZERVE_MS); pri ORS je `zamik`
 * Infinity. Vsak cilj ima svojo mejo `c.najvec`, vsi skupaj `skupaj` ms; z
 * `razdeli` (ORS) dobi cilj kvečjemu enak delež preostanka kot vsak zdrav cilj za
 * njim, da zadnji ne ostane brez časa, kadar prejšnji visi do konca.
 * Vrne prvi veljaven izid ali null, kadar ni uspel noben cilj. Nikoli ne vrže.
 * Vsak poskus se zabeleži sam (`stej`) pod svojim imenom poti (relay / relay2 /
 * direct); prekinjeni poraženec kot 'prekinjen', da se v statistiki vidi, kako
 * pogosto rezerva prehiti prvega.
 */
function klicNavzgor(cilji, poskus, stej, { zamik, skupaj, razdeli = false }) {
  const zacetek = Date.now();
  const zdravi = cilji.filter(c => !((slabiCilji.get(c.kljuc) ?? 0) > zacetek));
  // Cilji na kazni pridejo na vrsto šele, ko so vsi zdravi odpovedali. Če so na
  // kazni vsi, jih vseeno poskusimo po vrsti — boljšega nimamo.
  const vrsta = zdravi.length ? zdravi : cilji.slice();
  const zadnji = zdravi.length ? cilji.filter(c => !zdravi.includes(c)) : [];

  return new Promise((resolve) => {
    const tece = new Map(); // cilj -> { ctl, zacel, prekinjen }
    let koncano = false;
    let rezerva = null;

    const koncaj = (izid) => {
      koncano = true;
      clearTimeout(rezerva);
      for (const t of tece.values()) { t.prekinjen = true; t.ctl.abort(); }
      resolve(izid);
    };

    const zazeni = (c) => {
      const ostane = zacetek + skupaj - Date.now();
      if (ostane < NAJMANJ_ZA_POSKUS_MS) return false;
      // `vrsta` tu že ne vsebuje cilja `c`: delež = ostanek / (ta + zdravi za njim).
      const delez = razdeli ? ostane / (1 + vrsta.length) : ostane;
      const t = { ctl: new AbortController(), zacel: Date.now(), prekinjen: false };
      tece.set(c, t);
      poskus(c, t.ctl, Math.min(c.najvec, delez)).then((izid) => {
        tece.delete(c);
        if (t.prekinjen) { stej('prekinjen', 0, c.preko); return; }
        stej(izid.izid, izid.status, c.preko);
        if (izid.vrsta !== 'napaka') {
          // Kdor je začel prej in še ni odgovoril, je zaostal za rezervo: naslednjih
          // KAZEN_MS gre na konec vrste. Tistega, ki je začel kasneje, ne kaznujemo.
          for (const [d, td] of tece) if (td.zacel < t.zacel) slabiCilji.set(d.kljuc, Date.now() + KAZEN_MS);
          slabiCilji.delete(c.kljuc);
          koncaj(izid);
          return;
        }
        slabiCilji.set(c.kljuc, Date.now() + KAZEN_MS);
        naprej();
      }).catch(() => { tece.delete(c); if (!koncano) naprej(); });
      return true;
    };

    // Naslednji zdravi cilj takoj (in za njim spet rezerva čez `zamik`); cilji na
    // kazni šele, ko ni v teku nobenega klica več. Infinity ne gre v setTimeout
    // (prelije se v 1 ms).
    const naprej = () => {
      if (koncano) return;
      clearTimeout(rezerva);
      if (vrsta.length && zazeni(vrsta.shift())) {
        if (vrsta.length && Number.isFinite(zamik)) rezerva = setTimeout(naprej, zamik);
        return;
      }
      if (tece.size) return;
      if (zadnji.length && zazeni(zadnji.shift())) return;
      koncaj(null);
    };

    naprej();
  });
}

async function handleOba(request, env, ctx, path, cors) {
  const method = path.replace(/^\/oba\//, '');
  // Object.hasOwn in ne `OBA_METHODS[method] === undefined`: podedovana imena
  // (toString, constructor, __proto__ …) so šla mimo seznama in vsako je porabilo
  // klic na oba posrednika (in njuno brezplačno kvoto).
  if (!Object.hasOwn(OBA_METHODS, method)) return json({ error: 'unknown method' }, 404, cors);
  const ttl = OBA_METHODS[method];

  // Stetje gre skozi isto pot kot odgovor; `stej` se poklice pri vsakem izhodu.
  const zacetek = Date.now();
  const drzava = (request.cf && request.cf.country) || '';
  let postaja = '';   // samo pri GetArrivalsForStopPoint; napolni se spodaj
  const stej = (izid, status, preko, poskusi = 1) => recordUpstream(env, {
    storitev: 'oba', metoda: method, izid, status, preko, drzava,
    ms: Date.now() - zacetek, postaja, poskusi,
  });

  const inUrl = new URL(request.url);
  const upstream = new URL(`${OBA_BASE}/${method}`);
  const parametri = {};

  // Prepišemo samo pričakovane parametre — nič drugega ne gre naprej.
  if (method === 'GetArrivalsForStopPoint') {
    const id = inUrl.searchParams.get('stopPointId');
    if (!/^\d{1,7}$/.test(id ?? '')) return json({ error: 'bad stopPointId' }, 400, cors);
    upstream.searchParams.set('stopPointId', id);
    parametri.stopPointId = id;
    postaja = id;
  }

  // Ključ predpomnilnika je upstream URL, zato si zadetek delijo vsi uporabniki:
  // ob 50 hkratnih uporabnikih Marprom dobi 1 zahtevo na 20 s namesto 50.
  const cacheKeyUrl = upstream.toString();

  // Popravek ETA za starost: prihodi (ETAMin) in vozila (ETA). GetLines nima
  // relativnega časa.
  const popravi = method === 'GetArrivalsForStopPoint' ? popraviEta
    : method === 'GetActiveDeviceDetails' ? popraviEtaVozil
    : null;

  // Brskalnik živih metod ne sme hraniti: popravek ETA (popraviEta) se zgodi tu,
  // odgovor v brskalnikovem predpomnilniku pa bi se staral brez njega in bi
  // avtobus kazal dlje, kot je. GetLines je vozni red linij in se ne stara.
  const zaOdjemalca = popravi ? 'no-store' : `public, max-age=${ttl}`;

  const postrezi = (body, starost, oznaka) => new Response(popravi ? popravi(body, starost) : body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': zaOdjemalca,
      'X-Proxy-Cache': oznaka,
      'X-Proxy-Age': String(starost),
      ...cors,
    },
  });

  // ── Predpomnilnik ──────────────────────────────────────────────────────────
  // Najprej pomnilnik izolata (hitra pot), nato rob (deljen med izolati). Rob
  // hrani z daljšim max-age od našega TTL, zato svežino presodimo sami po glavi
  // `Age` — `cache.match()` bi potekle vnose zavrgel in zasilnega ne bi bilo.
  // Ločimo dobro kopijo (`dober`, sme biti zasilna) in svež odgovor »ni podatkov«
  // (`prazen`, Status −1, nikoli zasilen).
  const cacheKey = kljucPredpomnilnika(method, parametri);
  const cache = caches.default;

  const izMem = memBrani(cacheKeyUrl);
  const izRoba = (!izMem || izMem.potekel || izMem.prazno) ? await beriRob(cache, cacheKey, ttl) : null;
  const kandidati = [izMem, izRoba].filter(Boolean);
  const dober = kandidati.filter(k => !k.prazno).sort((a, b) => a.starost - b.starost)[0] ?? null;
  const prazen = kandidati.find(k => k.prazno && !k.potekel) ?? null;

  // Dobra kopija v zasilnem oknu (TTL + 90 s), za pisanje odgovora »ni podatkov«.
  // Ta je ne sme prepisati: podnevi je Status −1 lahko muha, dober podatek izpred
  // minute pa je s popravljenim ETA še vedno boljši od prazne table.
  const dobraKopija = async () => {
    const m = memBrani(cacheKeyUrl);
    if (m && !m.prazno) return m;
    const r = await beriRob(cache, cacheKey, ttl);
    return r && !r.prazno ? r : null;
  };

  // ── Klic navzgor ───────────────────────────────────────────────────────────
  // Kljub posredniku ostane ključ predpomnilnika Marpromov naslov: ob menjavi ali
  // odstranitvi posrednika shranjeni odgovori ostanejo veljavni.
  // OBA_RELAY je seznam posrednikov, ločen z vejicami, v vrstnem redu poskusov
  // (Deno, nato Vercel). Ob napaki prvega gre isti klic na drugega — septembra je
  // Deno po dveh dneh porabil kvoto in prihodi so utihnili, ker rezerve ni bilo.
  const relays = posredniki(env);
  const cilji = relays.length
    ? relays.map((relay, i) => {
        const viaRelay = new URL(relay + '/oba/' + method);
        for (const [k, v] of upstream.searchParams) viaRelay.searchParams.set(k, v);
        return {
          url: viaRelay.toString(),
          headers: { ...OBA_HEADERS, 'x-relay-key': String(env.RELAY_KEY ?? '') },
          preko: i === 0 ? 'relay' : 'relay' + (i + 1),
          kljuc: relay,
          najvec: OBA_TIMEOUT_MS,
        };
      })
    : [{ url: upstream.toString(), headers: { ...OBA_HEADERS }, preko: 'direct', kljuc: 'direct', najvec: OBA_TIMEOUT_MS }];
  const preko = cilji.map(c => c.preko).join('>');

  // Shrani veljaven izid klica in pove, kaj naj dobi uporabnik. Odgovor »ni
  // podatkov« gre v predpomnilnik le za TTL_PRAZNO in samo, kadar ni dobre kopije;
  // če ta obstaja, jo dobi uporabnik kot zasilno (STALE), kot ob izpadu.
  // Napaka zapisa v predpomnilnik klica ne podre — podatek imamo.
  const shrani = async (izid) => {
    if (izid.vrsta === 'prazno') {
      const dobra = await dobraKopija();
      if (dobra) return { telo: dobra.body, starost: dobra.starost, oznaka: 'STALE' };
    }
    const prazno = izid.vrsta === 'prazno';
    const doba = prazno ? TTL_PRAZNO : ttl;
    memPut(cacheKeyUrl, izid.telo, doba, prazno);
    try { await cache.put(cacheKey, zaPredpomnilnik(izid.telo, doba, prazno)); } catch { /* ostane v pomnilniku izolata */ }
    return { telo: izid.telo, starost: 0, oznaka: 'MISS' };
  };

  // Poskus navzgor, ki sam zabeleži svoj izid in napolni oba predpomnilnika.
  // Nikoli ne vrže: vrne { telo, starost, oznaka } ob uspehu in `null` ob
  // neuspehu. Tako ga je mogoče enako uporabiti v ospredju (uporabnik čaka) kot v
  // ozadju (ne čaka nihče).
  const poskusiNavzgor = () => klicNavzgor(cilji, (c, ctl, ms) => poskusiCilj(c, method, ctl, ms), stej,
    { zamik: ZAMIK_REZERVE_MS, skupaj: OBA_SKUPAJ_MS })
    .then(izid => (izid ? shrani(izid) : null))
    .catch(() => null);

  // Svež zadetek gre ven takoj. Če je že čez polovico življenjske dobe, se v
  // ozadju sproži osvežitev — uporabnik zanjo ne čaka, ob naslednjem vpogledu pa
  // je podatek nov. Pri poti, ki vsak četrti klic spusti skozi, je vsak tak
  // poskus ena priložnost več, ki nikogar nič ne stane.
  if (dober && !dober.potekel) {
    stej('cache', 200, dober.vir ?? 'mem');
    if (dober.starost * 2 >= ttl && !vTeku.has(cacheKeyUrl)) {
      vTeku.add(cacheKeyUrl);
      ctx.waitUntil(poskusiNavzgor().finally(() => vTeku.delete(cacheKeyUrl)));
    }
    return postrezi(dober.body, dober.starost, dober.vir === 'edge' ? 'HIT' : 'HIT-MEM');
  }

  // Marprom je pred kratkim rekel »ni podatkov«. Ponoči (ni dobre kopije) to
  // dobi uporabnik takoj, brez novega klica; podnevi ima prednost dobra kopija.
  // Osvežitve v ozadju tu ni: ponoči bi samo trošila kvoto posrednikov.
  if (prazen) {
    stej('cache', 200, (dober ?? prazen).vir ?? 'mem');
    if (dober) return postrezi(dober.body, dober.starost, 'STALE');
    return postrezi(prazen.body, prazen.starost, prazen.vir === 'edge' ? 'HIT' : 'HIT-MEM');
  }

  // Od tu naprej gre klic navzgor v ospredju, zato tu šteje omejevalnik na naslov
  // IP. Zadetki v predpomnilniku se ne štejejo: normalen uporabnik jih ima večino,
  // zloraba (npr. zaporedni id-ji postajališč) pa same zgrešene.
  if (await omejeno(env.OBA_LIMITER, request)) {
    stej('zavora', 429, '');
    if (dober) return postrezi(dober.body, dober.starost, 'STALE');
    return json({ error: 'preveč zahtev' }, 429, cors);
  }

  const naloga = poskusiNavzgor();

  // Imamo star odgovor: potem uporabnik ne sme čakati štirih sekund. Damo klicu
  // kratko prednost — kadar je pot zdrava, odgovori v ~0,2 s in uporabnik dobi
  // sveže — sicer gre ven zasilni odgovor, klic pa se dokonča v ozadju in napolni
  // predpomnilnik za naslednji vpogled.
  if (dober) {
    const izid = await Promise.race([naloga, pocakaj(CAKAJ_NA_SVEZE_MS)]);
    if (izid) return postrezi(izid.telo, izid.starost, izid.oznaka);
    ctx.waitUntil(naloga);
    return postrezi(dober.body, dober.starost, 'STALE');
  }

  // Nič v predpomnilniku — tu se čakanju ne da izogniti.
  const izid = await naloga;
  if (izid === null) {
    return json({ error: 'upstream unreachable', via: preko }, 502, cors);
  }

  return postrezi(izid.telo, izid.starost, izid.oznaka);
}

// ── ORS ───────────────────────────────────────────────────────────────────────

/**
 * Sestavi telo za ORS SAMO iz preverjenih polj — nič drugega iz zahteve ne gre
 * naprej. Prej se je preverjalo `coordinates ?? locations`, naprej pa je šlo celo
 * telo: dve veljavni koordinati in 59 lokacij je šlo skozi. Polja so natanko
 * tista, ki jih pošilja aplikacija (src/lib/routing.ts): pešpot `coordinates`,
 * matrika `locations`, `sources`, `destinations` in `metrics`.
 * Vrne `{ telo }` ali `{ napaka }`.
 */
function orsTelo(sub, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { napaka: 'bad json' };
  const matrika = sub === '/matrix/foot-walking';
  // Omejitev velikosti zahteve — brez tega bi lahko kdo z eno zahtevo
  // požrl dnevno kvoto ORS.
  const tocke = matrika ? payload.locations : payload.coordinates;
  if (!Array.isArray(tocke) || tocke.length < 2 || tocke.length > MAX_ORS_COORDS) return { napaka: 'bad coordinates' };
  for (const c of tocke) {
    if (!Array.isArray(c) || c.length !== 2 || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) {
      return { napaka: 'bad coordinates' };
    }
  }
  const koordinate = tocke.map(c => [c[0], c[1]]);
  if (!matrika) return { telo: { coordinates: koordinate } };

  // `sources` in `destinations` sta indeksa v `locations`; oba neobvezna.
  const indeksi = (v) => v === undefined || (Array.isArray(v) && v.length >= 1 && v.length <= koordinate.length
    && v.every(i => Number.isInteger(i) && i >= 0 && i < koordinate.length));
  if (!indeksi(payload.sources) || !indeksi(payload.destinations)) return { napaka: 'bad indices' };
  const metrics = payload.metrics;
  if (metrics !== undefined && !(Array.isArray(metrics) && metrics.length >= 1 && metrics.length <= 2
      && metrics.every(m => m === 'distance' || m === 'duration'))) {
    return { napaka: 'bad metrics' };
  }
  const telo = { locations: koordinate };
  if (payload.sources !== undefined) telo.sources = payload.sources.slice();
  if (payload.destinations !== undefined) telo.destinations = payload.destinations.slice();
  if (metrics !== undefined) telo.metrics = metrics.slice();
  return { telo };
}

/**
 * En poskus ORS na en cilj (neposredno ali prek posrednika). Nikoli ne vrže.
 * Veljaven je odgovor ORS pod 500 s telesom JSON — tudi 4xx (npr. točka ni na
 * poti ali porabljena kvota ključa) gre nespremenjen k aplikaciji, ker bi ga
 * druga pot z istim ključem ponovila. Telo, ki ni JSON (npr. stran HTML z 401,
 * 403 ali 429, s katero kdo vmes zavrne promet s Cloudflara), ni odgovor ORS in
 * klic gre na naslednjo pot. Odgovor posrednika šteje za odgovor ORS samo z
 * oznako X-Relay-Ors: brez nje je to posrednikova napaka (star posrednik brez
 * poti /ors vrne 404 ali 405, napačen RELAY_KEY 403, ORS nedosegljiv 502).
 */
async function poskusiOrs(c, telo, ctl, ms) {
  const casovnik = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(c.url, { method: 'POST', headers: c.headers, body: telo, signal: ctl.signal });
    const body = await res.text();
    const odOrs = !c.posrednik || res.headers.get('X-Relay-Ors') === '1';
    let jeJson = true;
    try { JSON.parse(body); } catch { jeJson = false; }
    if (!odOrs || res.status >= 500 || !jeJson) return { vrsta: 'napaka', izid: 'napaka', status: res.status };
    // K aplikaciji gre samo JSON ali GeoJSON (ORS doda npr. »;charset=UTF-8«).
    const vrstaVsebine = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    return {
      vrsta: 'ok', izid: res.ok ? 'ok' : 'napaka', status: res.status, telo: body,
      tip: (ORS_VSEBINA.has(vrstaVsebine) ? vrstaVsebine : 'application/json') + '; charset=utf-8',
    };
  } catch {
    return { vrsta: 'napaka', izid: 'nedosegljiv', status: 502 };
  } finally {
    clearTimeout(casovnik);
  }
}

async function handleOrs(request, env, ctx, path, cors) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405, cors);
  if (!env.ORS_KEY) return json({ error: 'ORS_KEY ni nastavljen' }, 503, cors);

  const sub = path.replace(/^\/ors/, '');
  if (!ORS_PATHS.has(sub)) return json({ error: 'unknown endpoint' }, 404, cors);

  const raw = await request.text();
  if (raw.length > MAX_ORS_BODY) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400, cors); }

  const { telo, napaka } = orsTelo(sub, payload);
  if (napaka) return json({ error: napaka }, 400, cors);

  const zacetekOrs = Date.now();
  const drzavaOrs = (request.cf && request.cf.country) || '';
  const stejOrs = (izid, status, preko = '') => recordUpstream(env, {
    storitev: 'ors', metoda: sub.replace(/^\//, ''), izid, status, preko,
    drzava: drzavaOrs, ms: Date.now() - zacetekOrs,
  });

  // Kvota ORS (2.000 poti in 500 matrik na dan) je skupna vsem uporabnikom, zato
  // ima en naslov IP omejeno število klicev na minuto (vezava ORS_LIMITER).
  // Aplikacija ob zavrnitvi nariše zračno črto, enako kot ob izpadu ORS.
  if (await omejeno(env.ORS_LIMITER, request)) {
    stejOrs('zavora', 429);
    return json({ error: 'preveč zahtev' }, 429, cors);
  }

  // Ključ ORS ostane skrivnost Workerja: neposredno gre v Authorization, posredniku
  // pa v glavi x-ors-key skupaj z x-relay-key (posrednik ga ne hrani in ne beleži).
  // V paket aplikacije ne gre nikoli.
  const relays = posredniki(env);
  const glave = { 'Content-Type': 'application/json', 'Accept': 'application/json, application/geo+json' };
  const cilji = [
    {
      url: `${ORS_BASE}${sub}`, headers: { ...glave, 'Authorization': env.ORS_KEY },
      preko: 'direct', kljuc: 'ors:direct',
      // Brez posrednikov je neposredna pot edina in dobi ves čas.
      najvec: relays.length ? ORS_DIREKTNO_MS : ORS_SKUPAJ_MS,
    },
    ...relays.map((relay, i) => ({
      url: `${relay}/ors${sub}`,
      headers: { ...glave, 'x-relay-key': String(env.RELAY_KEY ?? ''), 'x-ors-key': env.ORS_KEY },
      preko: i === 0 ? 'relay' : 'relay' + (i + 1),
      // Ločen ključ od OBA: posrednik brez poti /ors ne sme kvariti poti za OBA.
      kljuc: 'ors:' + relay,
      najvec: ORS_POSREDNIK_MS,
      posrednik: true,
    })),
  ];
  const teloJson = JSON.stringify(telo);
  const izid = await klicNavzgor(cilji, (c, ctl, ms) => poskusiOrs(c, teloJson, ctl, ms), stejOrs,
    { zamik: Infinity, skupaj: ORS_SKUPAJ_MS, razdeli: true });
  if (!izid) {
    return json({ error: 'upstream unreachable', via: cilji.map(c => c.preko).join('>') }, 502, cors);
  }

  const out = new Response(izid.telo, { status: izid.status, headers: { 'Content-Type': izid.tip } });
  for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
  return out;
}

// ── Alarmi za odhod avtobusa ──────────────────────────────────────────────────
//
// Zakaj sploh strežnik: telefon sme obvestilo prikazati z zaprto aplikacijo samo
// prek potisne storitve brskalnika, `setTimeout` v zavihku pa umre takoj, ko
// uporabnik zavihek zapre. Odjemalec zato Workerju pove, KDAJ naj zazvoni, in
// Worker to enkrat na minuto preveri.

// Meje za POST /alarms/sync. Brez njih bi lahko kdo z eno zahtevo napolnil KV.
const ALARM_MAX_BODY = 256 * 1024;                  // 256 kB celotnega telesa
const ALARM_MAX_OCCURRENCES = 500;
const ALARM_MAX_AHEAD_MS = 120 * 24 * 3600 * 1000;  // 120 dni naprej
const ALARM_MAX_TEXT = 200;                         // znakov za title in body
const ALARM_MAX_ID = 100;
const ALARM_MAX_URL = 500;
const ALARM_MAX_ENDPOINT = 1000;

// Gostota zvonjenj ene naprave. Vsako zvonjenje cron pošlje in nato zapis v KV
// prepiše — eno pisanje od 1.000 na dan za ves račun. Brez meje je ena sama
// veljavna sinhronizacija s 500 zvonjenji v razmiku ene minute stala 500 pisanj.
// Aplikacija (src/lib/alarms.ts, computeOccurrences) da za vsak opomnik največ
// eno zvonjenje na izbrani dan (prvi odhod v oknu), zato se mejama ne približa:
// ponovitve istega opomnika so narazen ure (ponoči ne vozi nič), 48 opomnikov na
// dan pa nima nihče. Kar meji preseže, tiho odpade kot pretekli vnosi — zavrnitev
// bi napravi vzela tudi vse veljavne alarme. Če bi aplikacija kdaj zvonila za
// VSAK odhod v oknu, je treba meji pregledati.
const ALARM_MIN_RAZMIK_MS = 10 * 60_000;  // med zvonjenji istega opomnika
const ALARM_NA_DAN = 48;                   // zvonjenj ene naprave na dan (UTC)

// Koliko zahtev na /alarms/* sme en naslov IP na uro. Odjemalec sinhronizira
// ob odprtju in ob spremembi alarma — 60 je zanj ogromno, za zlorabo pa nič.
const ALARM_RATE_LIMIT = 60;
const ALARM_RATE_WINDOW_S = 3600;

// Naročnina, ki je nihče ne osveži, po tem času sama izgine iz KV — sicer bi se
// zapisi odjavljenih naprav nabirali za vedno. 130 dni je okno zvonjenj (120)
// plus rezerva.
const ALARM_SUB_TTL_S = 130 * 24 * 3600;

// Meji enega zagona crona. Worker ima omejen čas izvajanja; raje pustimo ostanek
// naslednji minuti, kot da nas okolje prekine sredi pisanja v KV.
const CRON_MAX_SENDS = 10;
const CRON_MAX_MS = 25_000;

// Brezplačni paket dovoli največ 50 podzahtevkov na en klic Workerja, in KV
// (get/put/list/delete), Cache API in fetch štejejo skupaj. Čez mejo platforma
// klic zavrne z izjemo; med potiskom in zapisom nazaj je to pomenilo, da je
// obvestilo odšlo, zapis pa ne, in naslednjo minuto je šlo isto obvestilo še
// enkrat (pregled 12.10.2026). Cron zato podzahtevke šteje sam in zapisa ne začne,
// če zanj — branje, potisk in zapis nazaj — ne bi bilo dovolj.
const PODZAHTEVKI_NA_KLIC = 50;
const PODZAHTEVKI_REZERVA = 2;
// Gretje (warm.js) teče samo brez OBA_RELAY in dobi toliko podzahtevkov, alarmi
// pa ostanek. Z OBA_RELAY gretja ni, ker kliče Marprom neposredno.
const PODZAHTEVKI_GRETJE = 16;
const PODZAHTEVKI_ZA_ZAPIS = 4;   // branje + potisk + zapis nazaj + 1 rezerve

// Endpoint naročnine sme kazati samo na znano potisno storitev. Brez tega bi bil
// /alarms/sync orodje, s katerim bi kdorkoli pošiljal poljubne zahteve z naslova
// Cloudflara (in v tvojem imenu).
const PUSH_HOSTS = [
  'push.services.mozilla.com',    // Firefox
  'fcm.googleapis.com',           // Chrome, Brave, Opera, novi Edge
  'android.googleapis.com',       // starejši Chrome
  'notify.windows.com',           // Windows / stari Edge (WNS)
  'push.services.microsoft.com',
  'push.apple.com',               // Safari — web.push.apple.com in regijske različice
];

function isKnownPushHost(host) {
  return PUSH_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Ključ v KV je izpeljan iz endpointa, ne naključen: odjemalec lahko isto
// naročnino pove večkrat, pa ne nastane podvojen zapis. Endpoint sam v ključu ne
// leži (vsebuje žeton naprave), 32 šestnajstiških znakov = 128 bitov je proti
// trkom več kot dovolj.
async function subIdFor(endpoint) {
  return (await sha256Hex(endpoint)).slice(0, 32);
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** Vrne besedilo napake ali null, če je naročnina v redu. */
function validateSubscription(sub) {
  if (!sub || typeof sub !== 'object') return 'manjka subscription';
  if (typeof sub.endpoint !== 'string' || !sub.endpoint || sub.endpoint.length > ALARM_MAX_ENDPOINT) {
    return 'neveljaven endpoint';
  }
  let u;
  try { u = new URL(sub.endpoint); } catch { return 'endpoint ni veljaven URL'; }
  if (u.protocol !== 'https:') return 'endpoint mora biti https';
  if (!isKnownPushHost(u.hostname)) return 'endpoint ni znana potisna storitev';

  const k = sub.keys;
  if (!k || typeof k !== 'object') return 'manjkajo keys';
  // p256dh je 65 B nestisnjene točke P-256 → 87–88 znakov base64url,
  // auth je 16 B skrivnosti → 22–24 znakov.
  if (typeof k.p256dh !== 'string' || k.p256dh.length < 87 || k.p256dh.length > 88 || !B64URL.test(k.p256dh)) {
    return 'neveljaven p256dh';
  }
  if (typeof k.auth !== 'string' || k.auth.length < 22 || k.auth.length > 24 || !B64URL.test(k.auth)) {
    return 'neveljaven auth';
  }
  return null;
}

/** Vrne `{ list }` ali `{ error }`. Prepiše samo znana polja — nič drugega v KV ne gre. */
function validateOccurrences(arr, now) {
  if (!Array.isArray(arr)) return { error: 'occurrences mora biti polje' };
  if (arr.length > ALARM_MAX_OCCURRENCES) {
    return { error: 'preveč vnosov (največ ' + ALARM_MAX_OCCURRENCES + ')' };
  }
  const out = [];
  let skipped = 0;
  for (const o of arr) {
    if (!o || typeof o !== 'object') return { error: 'vnos ni objekt' };
    const fireAt = Number(o.fireAt);
    if (!Number.isFinite(fireAt)) return { error: 'fireAt ni število' };
    if (fireAt > now + ALARM_MAX_AHEAD_MS) return { error: 'fireAt je več kot 120 dni naprej' };
    // Pretekel vnos tiho preskočimo in ga ne štejemo. Odjemalec te tekme ne more
    // dobiti — vnos lahko poteče med letom zahteve — zavrnitev celotne
    // sinhronizacije pa bi pomenila, da naprava zaradi enega poteklega alarma
    // izgubi tudi vse veljavne.
    if (fireAt <= now) { skipped++; continue; }
    if (typeof o.id !== 'string' || !o.id || o.id.length > ALARM_MAX_ID) return { error: 'neveljaven id' };
    if (typeof o.title !== 'string' || o.title.length > ALARM_MAX_TEXT) return { error: 'neveljaven title' };
    if (typeof o.body !== 'string' || o.body.length > ALARM_MAX_TEXT) return { error: 'neveljaven body' };
    if (o.tag !== undefined && (typeof o.tag !== 'string' || o.tag.length > ALARM_MAX_ID)) {
      return { error: 'neveljaven tag' };
    }
    if (o.url !== undefined && (typeof o.url !== 'string' || o.url.length > ALARM_MAX_URL)) {
      return { error: 'neveljaven url' };
    }
    out.push({ id: o.id, fireAt, title: o.title, body: o.body, tag: o.tag || o.id, url: o.url || '' });
  }
  out.sort((a, b) => a.fireAt - b.fireAt);
  const { list, capped } = omejiGostoto(out);
  return { list, skipped, capped };
}

// Opomnik, ki mu zvonjenje pripada: aplikacija sestavi id kot `<id opomnika>:<odhod>`.
function opomnikIz(id) {
  const i = id.lastIndexOf(':');
  return i > 0 ? id.slice(0, i) : id;
}

/**
 * Iz seznama, urejenega po `fireAt`, odstrani, kar preseže ALARM_MIN_RAZMIK_MS
 * ali ALARM_NA_DAN. Obdrži prejšnja zvonjenja. Vrne `{ list, capped }`.
 */
function omejiGostoto(list) {
  const zadnje = new Map();  // opomnik -> fireAt zadnjega obdržanega
  const naDan = new Map();   // dan (UTC) -> obdržanih
  const out = [];
  for (const o of list) {
    const fireAt = Number(o.fireAt);
    const opomnik = opomnikIz(String(o.id));
    const prej = zadnje.get(opomnik);
    if (prej !== undefined && fireAt - prej < ALARM_MIN_RAZMIK_MS) continue;
    const dan = Math.floor(fireAt / 86_400_000);
    const n = naDan.get(dan) ?? 0;
    if (n >= ALARM_NA_DAN) continue;
    zadnje.set(opomnik, fireAt);
    naDan.set(dan, n + 1);
    out.push(o);
  }
  return { list: out, capped: list.length - out.length };
}

// Najzgodnejše zvonjenje zapisa gre v metapodatke ključa KV (≤ 1 kB). `list()` jih
// vrne skupaj z imeni ključev, zato cron zapisa, ki še ne zvoni, sploh ne prebere —
// prej je vsako minuto prebral in razčlenil prav vsako naročnino.
function metaZa(occurrences) {
  let next = null;
  for (const o of occurrences) {
    const f = Number(o && o.fireAt);
    if (Number.isFinite(f) && (next === null || f < next)) next = f;
  }
  return { next };
}

// Seznama naročnin NE vzdržujemo sami. Prejšnja različica je imela polje id-jev
// pod ključem `index`, a KV nima transakcij: cron je indeks prebral na začetku
// in na koncu zapisal svojo različico, s čimer je vsako napravo, ki se je
// sinhronizirala med tekom, izbrisal iz seznama. Njen `sub:<id>` je ostal v KV,
// cron je ni pogledal nikoli več, `/alarms/status` pa je še vedno javljal
// `subscribed: true` — alarm je tiho obmolknil in se ni popravil sam.
// Delovni seznam zato dobimo iz `ALARMS_KV.list({ prefix: 'sub:' })`, ki je
// vedno popoln in ga ni treba vzdrževati.

// Števec na hashiran IP z eno urno okno. Shranjen je samo števec in samo uro —
// nič, kar bi napravo prepoznalo, ne preživi okna. Napaka KV nikoli ne zavrne
// zahteve: omejevalnik je varovalo, ne funkcija, na katero se odjemalec zanaša.
async function alarmRateLimited(request, env) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const hour = Math.floor(Date.now() / (ALARM_RATE_WINDOW_S * 1000));
    const key = 'rl:' + (await sha256Hex(ip + ':' + hour)).slice(0, 16);
    const current = Number(await env.ALARMS_KV.get(key)) || 0;
    if (current >= ALARM_RATE_LIMIT) return true;
    await env.ALARMS_KV.put(key, String(current + 1), { expirationTtl: ALARM_RATE_WINDOW_S });
    return false;
  } catch {
    return false;
  }
}

async function alarmsSync(request, env, cors) {
  const raw = await request.text();
  if (raw.length > ALARM_MAX_BODY) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400, cors); }

  const subErr = validateSubscription(payload && payload.subscription);
  if (subErr) return json({ error: subErr }, 400, cors);

  const now = Date.now();
  const occ = validateOccurrences(payload.occurrences, now);
  if (occ.error) return json({ error: occ.error }, 400, cors);
  // Brez endpointa in naslova: samo število, da se v dnevniku vidi, ali meja kdaj
  // zadene pravo aplikacijo (pričakovano nikoli) ali zlorabo.
  if (occ.capped) console.log(`alarms sync: meja gostote — odpadlo ${occ.capped} od ${occ.capped + occ.list.length}`);

  const sub = payload.subscription;
  const id = await subIdFor(sub.endpoint);
  await env.ALARMS_KV.put('sub:' + id, JSON.stringify({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    occurrences: occ.list,
    updatedAt: now,
  }), { expirationTtl: ALARM_SUB_TTL_S, metadata: metaZa(occ.list) });

  return json({
    ok: true,
    count: occ.list.length,
    until: occ.list.length ? occ.list[occ.list.length - 1].fireAt : null,
    // Samo kadar je kaj odpadlo zaradi meje gostote (ALARM_NA_DAN, ALARM_MIN_RAZMIK_MS).
    ...(occ.capped ? { capped: occ.capped } : {}),
  }, 200, cors);
}

async function alarmsUnsync(request, env, cors) {
  const raw = await request.text();
  if (raw.length > 4096) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw || '{}'); } catch { return json({ error: 'bad json' }, 400, cors); }

  const endpoint = payload && payload.endpoint;
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > ALARM_MAX_ENDPOINT) {
    return json({ error: 'manjka endpoint' }, 400, cors);
  }

  const id = await subIdFor(endpoint);
  await env.ALARMS_KV.delete('sub:' + id);

  // Odjava je idempotentna: da naročnine ni bilo, ni napaka — odjemalec, ki
  // odjavo ponovi po izpadu omrežja, ne sme dobiti napake.
  return json({ ok: true }, 200, cors);
}

/** Prebere zapis naročnine iz KV; vrne null, če ga ni ali je pokvarjen. */
async function readSub(env, id) {
  try {
    const doc = JSON.parse(await env.ALARMS_KV.get('sub:' + id) || 'null');
    return (doc && doc.endpoint && doc.keys) ? doc : null;
  } catch {
    return null;
  }
}

/**
 * Združi zvonjenja dveh zapisov brez podvajanja po `id`.
 * Ob istem `id` obvelja vnos iz zapisa z novejšim `updatedAt` — brskalnik je
 * med zamenjavo naročnine morda oba zapisa pustil za sabo, novejši pa nosi
 * tisto, kar je uporabnik nazadnje res nastavil.
 */
function mergeOccurrences(...docs) {
  const ordered = docs.filter(Boolean)
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)); // novejši prvi
  const byId = new Map();
  for (const doc of ordered) {
    const occ = Array.isArray(doc.occurrences) ? doc.occurrences : [];
    for (const o of occ) {
      if (!o || typeof o.id !== 'string') continue;
      if (!byId.has(o.id)) byId.set(o.id, o);   // prvi videni (iz novejšega zapisa) obvelja
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => (Number(a.fireAt) || 0) - (Number(b.fireAt) || 0))
    .slice(0, ALARM_MAX_OCCURRENCES);
}

/**
 * Brskalnik sme naročnino zamenjati sam (dogodek `pushsubscriptionchange` v
 * service workerju) — takrat je stari endpoint mrtev, uporabnik pa o tem ne ve
 * nič. Brez te poti bi mu alarmi tiho nehali zvoniti.
 */
async function alarmsResubscribe(request, env, cors) {
  const raw = await request.text();
  if (raw.length > ALARM_MAX_BODY) return json({ error: 'body too large' }, 413, cors);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400, cors); }

  const subErr = validateSubscription(payload && payload.subscription);
  if (subErr) return json({ error: subErr }, 400, cors);

  // Manjkajoč ali neveljaven `oldEndpoint` NI napaka: service worker ga ob
  // `pushsubscriptionchange` pogosto ne more prebrati, ker je stara naročnina
  // že izginila. Takrat to obravnavamo kot navaden vpis nove naročnine —
  // zavrnitev bi pomenila, da naprava po rotaciji endpointa tiho obmolkne.
  const oldEndpoint = payload.oldEndpoint;
  const hasOld = typeof oldEndpoint === 'string' && oldEndpoint !== ''
    && oldEndpoint.length <= ALARM_MAX_ENDPOINT;

  const sub = payload.subscription;
  const newId = await subIdFor(sub.endpoint);
  const oldId = hasOld ? await subIdFor(oldEndpoint) : null;

  const newDoc = await readSub(env, newId);
  // Če je stari endpoint enak novemu, zapisa NE smemo izbrisati — brskalnik je
  // javil zamenjavo, ki naslova ni zares spremenila. Brisanje bi tu pomenilo
  // izgubo vseh alarmov.
  const oldDoc = (oldId && oldId !== newId) ? await readSub(env, oldId) : null;

  // Vsak zapis je zase že znotraj meja gostote, skupaj pa ju lahko preseže.
  const { list: occurrences, capped } = omejiGostoto(mergeOccurrences(newDoc, oldDoc));
  if (capped) console.log(`alarms resubscribe: meja gostote — odpadlo ${capped} od ${capped + occurrences.length}`);
  await env.ALARMS_KV.put('sub:' + newId, JSON.stringify({
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    occurrences,
    updatedAt: Date.now(),
  }), { expirationTtl: ALARM_SUB_TTL_S, metadata: metaZa(occurrences) });

  if (oldDoc) await env.ALARMS_KV.delete('sub:' + oldId);

  // `moved` je true samo, kadar so zvonjenja res prišla z DRUGEGA, zdaj
  // izbrisanega zapisa — ne ob navadni posodobitvi istega endpointa.
  return json({ ok: true, moved: !!oldDoc, count: occurrences.length }, 200, cors);
}

async function alarmsStatus(request, env, cors) {
  const endpoint = new URL(request.url).searchParams.get('endpoint');

  // Brez parametra: odjemalec samo sprašuje po javnem ključu, ki ga potrebuje
  // za `pushManager.subscribe({ applicationServerKey })`.
  if (!endpoint) return json({ vapidPublic: env.VAPID_PUBLIC }, 200, cors);
  if (endpoint.length > ALARM_MAX_ENDPOINT) return json({ error: 'endpoint too long' }, 400, cors);

  const id = await subIdFor(endpoint);
  let doc = null;
  try { doc = JSON.parse(await env.ALARMS_KV.get('sub:' + id) || 'null'); } catch { doc = null; }
  const list = (doc && Array.isArray(doc.occurrences)) ? doc.occurrences : [];

  return json({
    subscribed: !!doc,
    count: list.length,
    until: list.length ? Math.max(...list.map(o => Number(o.fireAt) || 0)) : null,
    vapidPublic: env.VAPID_PUBLIC,
  }, 200, cors);
}

async function handleAlarms(request, env, ctx, path, cors) {
  if (!env.ALARMS_KV) return json({ error: 'ALARMS_KV ni vezan' }, 503, cors);
  // Zavrnemo tudi, kadar manjka SAMO zasebni ključ. Brez njega bi odjemalec
  // dobil `ok: true` in mislil, da so alarmi nastavljeni, cron pa ne bi mogel
  // poslati ničesar — med namestitvijo po README (javni ključ je v gitu,
  // skrivnost se nastavi posebej) je to povsem verjetno vmesno stanje.
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    return json({ error: 'VAPID ključa nista nastavljena' }, 503, cors);
  }

  // Branje stanja ne piše v KV in gre mimo omejevalnika.
  if (path === '/alarms/status' && request.method === 'GET') return alarmsStatus(request, env, cors);

  const mutating =
    (path === '/alarms/sync' && (request.method === 'POST' || request.method === 'DELETE')) ||
    (path === '/alarms/resubscribe' && request.method === 'POST');
  // Neznano pot zavrnemo PRED omejevalnikom — sicer bi vsaka smetna zahteva
  // pod /alarms stala eno pisanje v KV.
  if (!mutating) return json({ error: 'not found' }, 404, cors);

  // Omejevalnik teče samo pred spreminjajočimi zahtevami. Vsak njegov klic je
  // pisanje v KV, brezplačna meja pa je 1.000 pisanj na dan; če bi štel še
  // branja stanja in neznane poti, bi protizlorabni števec pojedel kvoto,
  // ki jo potrebujejo naročnine same.
  if (await alarmRateLimited(request, env)) return json({ error: 'preveč zahtev' }, 429, cors);

  if (path === '/alarms/sync' && request.method === 'POST') return alarmsSync(request, env, cors);
  if (path === '/alarms/sync' && request.method === 'DELETE') return alarmsUnsync(request, env, cors);
  return alarmsResubscribe(request, env, cors);
}

// ── Cron: pošlji, kar je zapadlo ──────────────────────────────────────────────

// Kaj dobi service worker kot JSON v dogodku `push`.
function alarmPayload(occ) {
  return {
    id: occ.id,
    title: occ.title || 'MoHa Mobil',
    body: occ.body || '',
    tag: occ.tag || occ.id,
    url: occ.url || '',
    fireAt: occ.fireAt,
  };
}

/**
 * @param {number} podzahtevki  koliko podzahtevkov (KV, fetch) sme porabiti ta
 *        zagon; glej PODZAHTEVKI_NA_KLIC.
 */
async function runDueAlarms(env, podzahtevki) {
  if (!env.ALARMS_KV) { console.log('alarms cron: ALARMS_KV ni vezan — preskočeno'); return; }
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE) {
    console.log('alarms cron: manjka ključ VAPID — preskočeno');
    return;
  }

  const started = Date.now();
  const budget = { left: CRON_MAX_SENDS };
  let pod = podzahtevki;
  let subs = 0, sent = 0, failed = 0, dropped = 0, expired = 0, removed = 0, errors = 0, skipped = 0;
  let stopped = false;
  let cursor;

  // Delovni seznam beremo iz KV samega. `list` vrne strani po največ 1.000
  // ključev, zato se vrtimo, dokler je kaj naprej.
  strani:
  for (;;) {
    if (pod < 1) { stopped = true; break; }
    pod--;
    let page;
    try {
      page = await env.ALARMS_KV.list({ prefix: 'sub:', cursor });
    } catch (e) {
      errors++;
      break;
    }

    for (const entry of page.keys) {
      if (Date.now() - started > CRON_MAX_MS || budget.left <= 0) { stopped = true; break strani; }
      const key = entry.name;

      // Metapodatek `next` (najzgodnejše zvonjenje, glej metaZa) pove, ali je zapis
      // sploh treba prebrati. Zapisi brez njega (izpred te različice) se berejo
      // kot prej, dokler jih naslednja sinhronizacija ne prepiše.
      const meta = entry.metadata;
      if (meta && typeof meta === 'object' && 'next' in meta
          && (meta.next === null || Number(meta.next) > Date.now() + DUE_WINDOW_MS)) {
        skipped++;
        continue;
      }

      // Zapis začnemo samo, če je podzahtevkov dovolj za branje, potisk in zapis
      // nazaj — potisk brez zapisa bi naslednjo minuto odšel še enkrat. Ostanek
      // počaka na naslednjo minuto (zamuda je dovoljena do LATE_GRACE_MS).
      if (pod < PODZAHTEVKI_ZA_ZAPIS) { stopped = true; break strani; }

      // Napaka KV pri eni naročnini ne sme ustaviti vseh preostalih. Vrstni red
      // ključev je stalen, zato bi sicer vsakič odpadli isti uporabniki.
      try {
        pod--;
        let doc = null;
        try { doc = JSON.parse(await env.ALARMS_KV.get(key) || 'null'); } catch { doc = null; }

        // Zapis je medtem potekel (TTL) — ni ga treba brisati, ga ni več.
        if (!doc) continue;
        // Zapis je pokvarjen: brez endpointa ali ključev z njim ni kaj početi.
        if (!doc.endpoint || !doc.keys) { pod--; await env.ALARMS_KV.delete(key); removed++; continue; }
        subs++;

        // Potiskov največ toliko, da ostaneta podzahtevek za zapis nazaj in rezerva.
        const zaPotiske = { left: Math.min(budget.left, pod - 2) };
        const pred = zaPotiske.left;
        const res = await processDue(doc, Date.now(), (d, occ) =>
          sendPush({ endpoint: d.endpoint, keys: d.keys }, alarmPayload(occ), env), zaPotiske);
        const poskusov = pred - zaPotiske.left;
        budget.left -= poskusov;
        pod -= poskusov;

        sent += res.sent;
        failed += res.failed;
        dropped += res.dropped;
        expired += res.expired;

        if (res.dead) {
          // 404/410: naprava je odjavljena ali je naročnina potekla.
          pod--;
          await env.ALARMS_KV.delete(key);
          removed++;
          continue;
        }
        // Zapišemo nazaj samo ob dejanski spremembi — vsak put v KV nekaj stane.
        if (!res.changed) continue;

        // Znano tveganje: če je telefon med pošiljanjem poslal novo sinhronizacijo
        // (izklopil ali dodal opomnik), jo ta zapis prepiše — izklopljen opomnik še
        // zvoni, nov ne. Ponovno branje pred zapisom tega ne reši: KV na lokaciji
        // crona ponovljena branja streže iz svojega predpomnilnika in zapisa z druge
        // lokacije ne vidi (pregled 12.10.2026). Popravi se ob naslednjem odprtju
        // aplikacije, ki ob zagonu sinhronizira znova; prava rešitev je stanje crona
        // v D1 ali Durable Objectu.
        pod--;
        await env.ALARMS_KV.put(key, JSON.stringify({
          ...doc,
          occurrences: res.occurrences,
          updatedAt: Date.now(),
        }), { expirationTtl: ALARM_SUB_TTL_S, metadata: metaZa(res.occurrences) });
      } catch (e) {
        errors++;
        continue;
      }
    }

    if (page.list_complete || !page.cursor) break;
    cursor = page.cursor;
  }

  console.log(
    `alarms cron: naročnin=${subs} preskočenih=${skipped} poslano=${sent} spodletelo=${failed} ` +
    `odpadlo=${dropped} zamujeno=${expired} odjavljenih=${removed} napakKV=${errors} ` +
    `podzahtevkov=${podzahtevki - pod}/${podzahtevki}` +
    `${stopped ? ' PREKINJENO(kvota/čas)' : ''} ${Date.now() - started}ms`);
}

// ── Vstopna točka ─────────────────────────────────────────────────────────────
async function usmeri(request, env, ctx, cors) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (path === '/health') {
    return json({
      ok: true,
      orsConfigured: !!env.ORS_KEY,
      ttsConfigured: !!(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION),
      allowedOrigins: allowedOrigins(env).length,
      obaVia: env.OBA_RELAY ? 'relay' : 'direct',
      relays: String(env.OBA_RELAY ?? '').split(',').filter(s => s.trim()).length,
      relayKeyConfigured: !!env.RELAY_KEY,
      analytics: !!env.ANALYTICS,
      statConfigured: !!(env.STAT_KEY && env.CF_API_TOKEN && env.CF_ACCOUNT_ID),
    }, 200, cors);
  }

  if (!isAllowedOrigin(request, env)) return json({ error: 'origin not allowed' }, 403, cors);

  if (path === '/ev') return handleEvent(request, env, cors);
  if (path === '/stat') return handleStat(request, env, cors);
  if (path.startsWith('/oba/')) return handleOba(request, env, ctx, path, cors);
  if (path.startsWith('/ors/')) return handleOrs(request, env, ctx, path, cors);
  if (path.startsWith('/alarms/')) return handleAlarms(request, env, ctx, path, cors);
  if (path === '/tts') return handleTts(request, env, ctx, cors);

  return json({ error: 'not found' }, 404, cors);
}

export default {
  // Nepričakovana izjema (npr. porabljena dnevna kvota pisanj v KV) je prej
  // pomenila Cloudflarovo stran 1101 brez glav CORS: brskalnik je odgovor zavrgel
  // in aplikacija ni videla niti statusa. Zdaj gre ven urejen JSON 500 z glavami
  // CORS za dovoljen izvor.
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    try {
      return await usmeri(request, env, ctx, cors);
    } catch (e) {
      console.log('fetch: nepričakovana napaka — ' + String(e && e.message ? e.message : e));
      return json({ error: 'internal error' }, 500, cors);
    }
  },

  // Cron (glej [triggers] v wrangler.toml): enkrat na minuto pošlje zapadla
  // obvestila. Delo gre v `waitUntil`, ker sme izvajanje teči tudi po vrnitvi
  // iz `scheduled`; `await` istega obljubka poskrbi, da napaka ne izgine tiho.
  async scheduled(event, env, ctx) {
    // Gretje (warm.js) kliče Marprom neposredno. Z OBA_RELAY Cloudflare do Marproma
    // ne pride, zato bi bilo gretje samo zapravljeni podzahtevki in do 6 s visenja;
    // takrat ne teče, alarmi pa dobijo vse podzahtevke (glej PODZAHTEVKI_NA_KLIC).
    const greje = posredniki(env).length === 0;
    const zaGretje = greje ? PODZAHTEVKI_GRETJE : 0;
    const zvonjenja = runDueAlarms(env, PODZAHTEVKI_NA_KLIC - PODZAHTEVKI_REZERVA - zaGretje).catch(e => {
      console.log('alarms cron: nepričakovana napaka — ' + String(e && e.message ? e.message : e));
    });
    // Ogrevanje teče vzporedno z zvonjenji in ju ne sme podreti.
    const gretje = !greje ? Promise.resolve(null) : ogrejPredpomnilnik(env, zaGretje).catch(e => {
      console.log('gretje: nepričakovana napaka — ' + String(e && e.message ? e.message : e));
    });
    const work = Promise.all([zvonjenja, gretje]);
    ctx.waitUntil(work);
    await work;
  },
};
