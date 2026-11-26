/**
 * Skupne stalnice za Marpromov OBA.
 *
 * Tu so zato, ker jih potrebujeta dva klicatelja: pot za uporabnika
 * (`handleOba` v worker.js) in ogrevanje predpomnilnika iz cron-a (warm.js).
 * Ključ predpomnilnika se med njima NE sme raziti — če bi se, bi cron polnil
 * en predal, uporabnik pa bral iz drugega in ogrevanje ne bi imelo učinka.
 */

export const OBA_BASE = 'https://vozniredi.marprom.si/OBA';

// Dovoljene OBA metode in koliko sekund sme odgovor ležati v predpomnilniku.
// GetLines se spremeni nekajkrat letno, pozicije vozil pa se osvežujejo ~1×/min.
// Ob osipu na poti do Marproma je vsak zadetek v predpomnilniku klic, ki ne more
// pasti — zato sta živi metodi na zgornjem robu tistega, kar je še sveže.
// Prihodi se v aplikaciji osvežujejo na 15 s; 40 s star ETA zgreši kvečjemu za
// minuto (in se popravi, glej popraviEta), neuspel klic pa ne pokaže ničesar.
export const OBA_METHODS = {
  GetLines: 21600,                 // 6 h
  GetActiveDeviceDetails: 30,
  GetArrivalsForStopPoint: 40,
};

// Kako dolgo po izteku TTL se sme odgovor uporabiti kot zasilni. Velja SAMO
// takrat, ko upstream ne odgovori — sicer gre vedno po svežega. Pri prihodih to
// pomeni skupaj do 130 s, kar je po popravku ETA natančno na minuto; dlje ne
// gremo, ker bi obljubljali avtobus, ki je že šel.
export const STALE_MAX_MS = 90_000;

// Odgovor »ni podatkov« (Status −1 pri živi metodi, glej razvrstiOdgovor) sme
// ležati le kratko in nikoli kot zasilni: ponoči je pravilen (ni vozil), podnevi pa
// je lahko muha Marproma, ki jo naslednji klic že popravi.
export const TTL_PRAZNO = 20;

// Glave, s katerimi se predstavimo Marpromu. Preverjeno 22.09.2026, da osip na
// poti NI vezan nanje (z istim UA neposredno 10/10).
export const OBA_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'MoHaMobil/1.0 (+github.com/m1984m/MoHa-Mobil)',
};

/** Naslov navzgor za eno metodo; `parametri` so že preverjeni. */
export function obaUrl(method, parametri = {}) {
  const u = new URL(`${OBA_BASE}/${method}`);
  for (const [k, v] of Object.entries(parametri)) u.searchParams.set(k, String(v));
  return u.toString();
}

/**
 * Ključ za `caches.default`. Ostane na Marpromovem naslovu tudi, če bi klic kdaj
 * spet tekel prek posrednika — tako shranjeni odgovori ob menjavi poti ostanejo
 * veljavni.
 */
export function kljucPredpomnilnika(method, parametri = {}) {
  return new Request(obaUrl(method, parametri), { method: 'GET' });
}

/**
 * Razvrsti telo odgovora OBA, preden gre komurkoli naprej ali v predpomnilnik.
 *
 * Marprom tudi napako vrne s statusom HTTP 200, napako pa zapiše v telo:
 * {"Response":{"Status":-1,"Message":"Data is not available"}}. Prej je šlo vsako
 * telo s 200 v predpomnilnik kot dober odgovor — tudi HTML ali prazno, GetLines
 * pa tam leži 6 ur (aplikacija si seznam linij zapomni za celo sejo).
 *
 *   'ok'      Status 1 (pri GetLines še neprazen seznam linij)
 *   'prazno'  živa metoda s Status −1: ni podatkov. Ponoči je to pravilen odgovor
 *             (ni vozil in ni prihodov), enako za neobstoječe postajališče.
 *   'neznano' Status, ki ni ne 1 ne −1 — obravnava se kot napaka, v statistiki pa
 *             je viden posebej, da se novo vedenje Marproma opazi
 *   'napaka'  vse drugo: HTML, prazno ali neveljavno telo, GetLines brez Status 1
 */
export function razvrstiOdgovor(method, body) {
  let j;
  try { j = JSON.parse(body); } catch { return 'napaka'; }
  const status = j && j.Response ? j.Response.Status : undefined;
  if (status === 1) {
    if (method === 'GetLines' && !(Array.isArray(j.Lines) && j.Lines.length > 0)) return 'napaka';
    return 'ok';
  }
  if (status === -1) return method !== 'GetLines' ? 'prazno' : 'napaka';
  return status === undefined ? 'napaka' : 'neznano';
}

// ── Rezerva brezavta.si (derp.si) ──────────────────────────────────────────────
// Kliče se za GetArrivalsForStopPoint šele, ko odpovejo vsi posredniki (worker.js,
// brezavtaCilj), nikoli vzporedno z njimi. Brezavta bere
// iste Marpromove OBA podatke (prek svojega posrednika marprom-proxy.derp.si), torej
// ne pomaga, ko Marprom sam ne dela, pomaga pa, ko so blokirani ali ugasnjeni naši
// posredniki. Vklop z env BREZAVTA_REZERVA = '1' (dogovor z brezavta@derp.si).
export const BREZAVTA_BASE = 'https://api.beta.brezavta.si';
/** Toliko prihodov vrne tudi Marprom (~10); brezavta vrne cel dan (do ~580). */
export const BREZAVTA_NAJVEC = 12;
/** Dlje od tega ni »prihod«; tudi preprečí, da bi zvečer jutranje vožnje veljale za jutrišnje. */
export const BREZAVTA_OBZORJE_MIN = 180;

export function brezavtaUrl(stopPointId) {
  return `${BREZAVTA_BASE}/stops/MARPROM:${stopPointId}/arrivals?current=true`;
}

/** Sekunde od polnoči po uri Maribora. */
export function sekundeMb(ms = Date.now()) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Ljubljana', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const v = t => +(p.find(x => x.type === t)?.value ?? 0);
  return v('hour') * 3600 + v('minute') * 60 + v('second');
}

const hhmm = s => {
  const x = ((Math.round(s) % 86400) + 86400) % 86400;
  return `${String(Math.floor(x / 3600)).padStart(2, '0')}:${String(Math.floor(x / 60) % 60).padStart(2, '0')}`;
};

/**
 * Prihodi brezavta (seznam z arrival_/departure_ v sekundah od polnoči dneva
 * obratovanja) → telo v obliki Marpromovega GetArrivalsForStopPoint, da ga
 * predpomnilnik, popravek ETA in aplikacija obdelajo enako. Vozilo v živo nima
 * številke (BusCode prazen), zato nosi `Realtime: true`. Vrne null, če telo ni seznam.
 */
export function brezavtaVOba(seznam, nowSec = sekundeMb()) {
  if (!Array.isArray(seznam)) return null;
  const vrstice = [];
  for (const a of seznam) {
    if (!a || a.passed) continue;
    const sched = a.departure_scheduled ?? a.arrival_scheduled;
    if (typeof sched !== 'number') continue;
    const zivo = a.realtime === true && typeof (a.departure_realtime ?? a.arrival_realtime) === 'number';
    const t = zivo ? (a.departure_realtime ?? a.arrival_realtime) : sched;
    // Dan obratovanja teče čez polnoč (časi > 24 h): po polnoči je tak prihod iz
    // včerajšnjega dneva obratovanja, zato −24 h. Jutranjih voženj zvečer NE
    // previjemo na jutri (drug dan ima lahko drug vozni red) — izpadejo, kot pri
    // Marpromu, ki kaže samo bližnje prihode (pregled kode).
    let eta = (t - nowSec) / 60;
    if (eta > 720) eta -= 1440;
    if (eta < -1 || eta > BREZAVTA_OBZORJE_MIN) continue;
    const zakasnitev = a.departure_delay ?? a.arrival_delay;
    const zamuda = zivo ? Math.round((typeof zakasnitev === 'number' ? zakasnitev : t - sched) / 60) : undefined;
    const lineId = Number(String(a.route_id ?? '').split(':').pop());
    vrstice.push({
      LineId: Number.isFinite(lineId) ? lineId : 0,
      LineCode: String(a.route_short_name ?? ''),
      LineDescription: String(a.trip_headsign ?? ''),
      ArrivalTime: hhmm(sched),
      ETAMin: Math.max(0, Math.round(eta)),
      ...(zamuda !== undefined ? { DelayMin: zamuda } : {}),
      BusCode: '',
      Realtime: zivo,
    });
  }
  vrstice.sort((x, y) => x.ETAMin - y.ETAMin);
  if (vrstice.length === 0) return { Response: { Status: -1, Message: 'Data is not available' }, Vir: 'brezavta' };
  return { Response: { Status: 1, Message: 'OK' }, Vir: 'brezavta', ArrivalsForStopPoints: vrstice.slice(0, BREZAVTA_NAJVEC) };
}

/**
 * Odgovor, kakršen gre v predpomnilnik na robu (daljši max-age od TTL).
 * `prazno` (odgovor »ni podatkov«) leži samo svoj TTL, brez zasilnega podaljška,
 * in nosi oznako, da ga bralec loči od dobre kopije.
 */
export function zaPredpomnilnik(body, ttl, prazno = false) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${prazno ? ttl : ttl + Math.round(STALE_MAX_MS / 1000)}`,
  };
  if (prazno) headers['X-Oba-Prazno'] = '1';
  return new Response(body, { status: 200, headers });
}
