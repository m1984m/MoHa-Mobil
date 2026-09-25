/**
 * Analitika — pisanje v Workers Analytics Engine.
 *
 * Dva vira dogodkov:
 *   1. Worker sam (`recordUpstream`) — vsak klic OBA/ORS, ki gre skozi proxy.
 *      Za to ni potrebna nobena vrstica v aplikaciji in ni nobenega podatka o
 *      uporabniku: šteje se metoda, izid, trajanje in ali je šlo iz
 *      predpomnilnika. Prav to bi 16.09.2026 takoj pokazalo, da Cloudflare do
 *      Marproma ne pride, namesto da je napaka več dni ostala neopažena.
 *   2. Aplikacija (`handleEvent`, pot POST /ev) — dogodki, ki jih strežnik ne
 *      more vedeti: ali je aplikacija nameščena, katera različica service
 *      workerja res teče, kateri zavihek se uporablja, ali kdo uporablja filter
 *      smeri in način za starejše.
 *
 * Kaj se NE zapisuje, nikoli:
 *   - koordinate (aplikacija pozna uporabnikovo lokacijo; tudi zaokrožene bi v
 *     mestu velikosti Maribora zadoščale za sled),
 *   - naslov IP ali karkoli, kar bi napravo identificiralo med sejami,
 *   - imena postaj, ki jih uporabnik išče.
 * Zato tudi ni piškotka in ni privolitvenega okna.
 *
 * Oblika zapisa (Analytics Engine dovoli 20 nizov, 20 števil in 1 indeks):
 *   blob1  vir          'srv' | 'app'
 *   blob2  dogodek      glej SRV_EVENTS / APP_EVENTS
 *   blob3..blob7        razsežnosti dogodka (odvisne od imena)
 *   double1             trajanje v ms (0, kadar ni smiselno)
 *   double2             1 — števec, da se da v SQL seštevati
 *   index1              ime dogodka (po tem se največkrat filtrira)
 */

// Najdaljša dovoljena vrednost ene razsežnosti. Analytics Engine dovoli 16 kB
// na zapis, a nas zanimajo kratke oznake — dolg niz pomeni napako ali zlorabo.
const MAX_DIM = 48;
// Največ dogodkov v eni zahtevi. Aplikacija jih ob vrnitvi povezave pošlje v
// svežnju; več kot toliko jih v čakalni vrsti sploh ne hrani.
const MAX_BATCH = 20;
const MAX_BODY = 4 * 1024;

// Dovoljena imena dogodkov iz aplikacije in koliko razsežnosti smejo imeti.
// Karkoli drugega se zavrže — končna točka je javna in mora prenesti tudi to,
// da jo kdo najde in vanjo pošilja smeti.
const APP_EVENTS = {
  zagon: 5,       // nacin, razlicicaSW, tema, starejsi, jezikNaprave
  zavihek: 1,     // ime zavihka
  filter: 1,      // v-center | iz-centra | izklop
  namestitev: 1,  // ponujeno | sprejeto | zavrnjeno
  omrezje: 1,     // offline | online
  napaka: 2,      // kje, vrsta
};

// Dovoljene vrednosti razsežnosti. Prosto besedilo ne pride v zapis; s tem je
// zloraba omejena na izbiro med znanimi oznakami, poleg tega pa ne more po
// nesreči uiti noben osebni podatek.
const APP_VALUES = {
  zagon: [
    ['namescena', 'brskalnik'],
    null,                                   // različica SW — preverjena z vzorcem
    ['svetla', 'temna', 'kontrast', 'crnobelo'],
    ['da', 'ne'],
    null,                                   // jezik naprave — preverjen z vzorcem
  ],
  zavihek: [['home', 'timetables', 'map', 'fav', 'settings']],
  filter: [['v-center', 'iz-centra', 'izklop']],
  namestitev: [['ponujeno', 'sprejeto', 'zavrnjeno']],
  omrezje: [['offline', 'online']],
  napaka: [['oba', 'ors', 'gtfs', 'alarmi'], null],
};

const RE_VERZIJA = /^[0-9]+\.[0-9]+\.[0-9]+(-([0-9a-f]{4,12}|dev))?$/;
const RE_JEZIK = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

// Best-effort zavora znotraj izolata. Prava omejitev pogostosti bi zahtevala
// skupno stanje (KV/DO) in pisanje ob vsaki zahtevi; to je za štetje predrago.
// Izolatov je lahko več hkrati, zato to ni jamstvo — je pa dovolj, da en
// odjemalec z ene lokacije ne more izčrpati dnevne kvote.
const NA_MINUTO = 600;
let okno = { min: 0, n: 0 };

function dovoljeno(zdaj = Date.now()) {
  const min = Math.floor(zdaj / 60000);
  if (min !== okno.min) okno = { min, n: 0 };
  if (okno.n >= NA_MINUTO) return false;
  okno.n++;
  return true;
}

function ocisti(v) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, MAX_DIM);
}

// Preveri eno razsežnost proti seznamu dovoljenih vrednosti oziroma vzorcu.
function veljavna(ime, i, v) {
  const pravila = APP_VALUES[ime];
  const p = pravila ? pravila[i] : undefined;
  if (Array.isArray(p)) return p.includes(v);
  if (ime === 'zagon' && i === 1) return RE_VERZIJA.test(v);
  if (ime === 'zagon' && i === 4) return RE_JEZIK.test(v);
  if (ime === 'napaka' && i === 1) return /^[a-z0-9_-]{1,32}$/i.test(v);
  return false;
}

// Zapis v Analytics Engine. Kadar vezava ni nastavljena (lokalni razvoj ali
// Worker brez nje), tiho ne naredi nič — analitika ne sme nikoli podreti poti,
// po kateri tečejo vozni redi.
export function zapisi(env, { vir, dogodek, dims = [], ms = 0, poskusi = 1, znaki = 0 }) {
  const ds = env && env.ANALYTICS;
  if (!ds || typeof ds.writeDataPoint !== 'function') return false;
  try {
    ds.writeDataPoint({
      blobs: [vir, dogodek, ...dims.map(d => ocisti(d))].slice(0, 20),
      // double3 je stevilo porabljenih poskusov navzgor. Brez tega se ne da
      // izmeriti, ali ponavljanje klicev (OBA_POSKUSI) sploh kaj prinese:
      // povprecje nad 1 pomeni, da prvi poskus pogosto visi.
      // double4 so znaki, ki jih je sintetiziral Azure (samo pri /tts) — iz njih se
      // na zaslonu s statistiko računa poraba mesečne kvote glasu.
      doubles: [Number.isFinite(ms) ? Math.max(0, Math.round(ms)) : 0, 1,
                Number.isFinite(poskusi) ? Math.max(1, Math.round(poskusi)) : 1,
                Number.isFinite(znaki) ? Math.max(0, Math.round(znaki)) : 0],
      indexes: [dogodek.slice(0, 96)],
    });
    return true;
  } catch {
    return false;
  }
}

// Stikalo za zapis postajalisca pri GetArrivalsForStopPoint.
const BELEZI_POSTAJO = true;

/**
 * Štetje na strežniku. Kliče se iz poti /oba in /ors.
 * `izid` je 'ok' | 'cache' | 'napaka', `preko` pa 'relay' | 'direct'.
 */
export function recordUpstream(env, { storitev, metoda, izid, status, preko, drzava, ms, postaja, poskusi, znaki }) {
  return zapisi(env, {
    vir: 'srv',
    poskusi,
    znaki,
    dogodek: storitev,                       // 'oba' | 'ors'
    // blob8 je id postajalisca, in to SAMO pri GetArrivalsForStopPoint. Iz tega
    // se na zaslonu s statistiko izrise karta najbolj gledanih postajalisc.
    // Je seštevek po dnevih in ni vezan na napravo ali sejo; ce kdaj ne bo vec
    // zazelen, postavi BELEZI_POSTAJO na false in zapis odpade.
    dims: [metoda, izid, String(status ?? ''), preko ?? '', drzava ?? '', BELEZI_POSTAJO ? String(postaja ?? '') : ''],
    ms,
  });
}


/**
 * Povzetek ene runde ogrevanja predpomnilnika iz cron-a (warm.js).
 *
 * Zapiše se EN podatkovni točka na klic cron-a, ne ena na postajališče — sicer bi
 * gretje samo po sebi pojedlo dnevno kvoto zapisov in zameglilo statistiko.
 *
 * `vir` je 'cron' in ne 'srv' namenoma: vse poizvedbe na zaslonu s statistiko
 * filtrirajo po `blob1 = 'srv'`, zato gretje števcev uporabe ne napihne.
 */
export function zapisiGretje(env, { postaj, uspelo, klicev, rund, lokacija }) {
  const ds = env && env.ANALYTICS;
  if (!ds || typeof ds.writeDataPoint !== 'function') return false;
  try {
    ds.writeDataPoint({
      // blob3 je Cloudflarova lokacija, in zapise se SAMO ob popolnem neuspehu:
      // sluzi odgovoru na vprasanje, ali cron vedno tece iz iste lokacije in ali
      // je prav ta pri Marpromu zavrnjena.
      blobs: ['cron', 'gretje', ocisti(lokacija ?? '')],
      doubles: [postaj, uspelo, klicev, rund],
      indexes: ['gretje'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * POST /ev — dogodki iz aplikacije.
 * Izvor je preverjen že v usmerjevalniku (isAllowedOrigin), zato tu skrbimo
 * samo za obliko, velikost in pogostost.
 */
export async function handleEvent(request, env, cors) {
  const glava = { 'Content-Type': 'application/json; charset=utf-8', ...cors };
  const noContent = (status) => new Response(null, { status, headers: cors });

  if (request.method !== 'POST') return noContent(405);

  const dolzina = Number(request.headers.get('Content-Length') ?? 0);
  if (dolzina > MAX_BODY) return noContent(413);

  let telo;
  try {
    const besedilo = await request.text();
    if (besedilo.length > MAX_BODY) return noContent(413);
    telo = JSON.parse(besedilo);
  } catch {
    return noContent(400);
  }

  const seznam = Array.isArray(telo && telo.b) ? telo.b : [telo];
  if (seznam.length === 0 || seznam.length > MAX_BATCH) return noContent(400);

  const drzava = (request.cf && request.cf.country) || '';
  let sprejetih = 0;
  for (const dogodek of seznam) {
    if (!dovoljeno()) break;
    if (!dogodek || typeof dogodek !== 'object') continue;
    const ime = ocisti(dogodek.e);
    const najvec = APP_EVENTS[ime];
    if (najvec === undefined) continue;

    const surove = Array.isArray(dogodek.d) ? dogodek.d.slice(0, najvec) : [];
    const dims = [];
    let vredu = true;
    for (let i = 0; i < surove.length; i++) {
      const v = ocisti(surove[i]);
      if (!veljavna(ime, i, v)) { vredu = false; break; }
      dims.push(v);
    }
    if (!vredu) continue;

    zapisi(env, { vir: 'app', dogodek: ime, dims: [...dims, drzava], ms: 0 });
    sprejetih++;
  }

  // Odjemalca izid ne zanima in odgovora ne bere; 204 je najcenejši.
  return sprejetih > 0 ? noContent(204) : new Response(JSON.stringify({ ok: false }), { status: 202, headers: glava });
}
