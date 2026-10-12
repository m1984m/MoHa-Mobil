/**
 * Ogrevanje predpomnilnika iz cron-a.
 *
 * Zakaj sploh: pot Cloudflare → vozniredi.marprom.si občasno visi (22.09.2026
 * izmerjeno: z roba uspe okoli četrtina klicev, isti hip neposredno 15/15).
 * Uporabnik zato vsake toliko ne dobi živih podatkov. Tu nihče ne čaka, zato je
 * vsak uspešen klic čista pridobitev: ko uspe, ima vsak uporabnik, ki v
 * naslednjih ~2 minutah pogleda to postajališče, zadetek v predpomnilniku
 * namesto klica, ki lahko pade.
 *
 * Trije premisleki, ki oblikujejo to kodo:
 *
 *  1. **Grejemo samo tisto, kar kdo gleda.** Seznam postajališč pride iz
 *     statistike zadnjih 30 minut. Ponoči je prazen in cron ne naredi nič —
 *     Marproma ne obremenjujemo za postajališča, ki jih nihče ne gleda.
 *
 *  2. **Najprej potipamo z eno samo postajališčem.** Izmerjeno je, da so izidi
 *     klicev znotraj enega klica Workerja med seboj korelirani: kadar prvi visi,
 *     visijo vsi. Zato prvi neuspeh pomeni konec — v slabi minuti odide en klic
 *     namesto osmih, Marprom pa ni po nepotrebnem spraševan.
 *
 *  3. **Cron teče vsako minuto**, zato mora biti vse skupaj krajše od minute;
 *     preostala postajališča gredo zato vzporedno.
 *
 * **Znana omejitev (22.09.2026):** Cloudflare cron-a ne požene nujno v Evropi —
 * izmerjeno je tekel iz **SIN (Singapur)**, od koder Marprom ni bil dosegljiv niti
 * enkrat (0 od 120 klicev), medtem ko so klici uporabnikov iz evropskih lokacij v
 * istih minutah uspevali. Smart Placement tega ne reši, ker po dokumentaciji
 * velja samo za `fetch` in ne za `scheduled`. Zato gretje **ni glavni obrambni
 * mehanizem** — to je osveževanje v ozadju na uporabnikovi poti (`handleOba`,
 * `poskusiNavzgor` prek `waitUntil`), ki teče tam, kjer so uporabniki. Gretje je
 * dodatek, ki se obnese takrat, ko Cloudflare cron postavi bliže.
 */

import { OBA_HEADERS, OBA_METHODS, kljucPredpomnilnika, obaUrl, zaPredpomnilnik, razvrstiOdgovor } from './oba.js';
import { zapisiGretje } from './analytics.js';

const NABOR = 'moha_mobil';
// Seznam postaj v rabi si zapomnimo v pomnilniku izolata in v caches.default —
// oboje je zastonj. Prej je šel v KV pod `warm:postaje` in se zapisal ob VSAKI
// osvežitvi, tudi ponoči s praznim seznamom: 288 pisanj na dan od 1.000, ki jih
// ima ves račun. Posledica predpomnilnika na lokaciji je le, da cron, ko teče iz
// druge lokacije, poizvedbo v statistiko ponovi (do 10.000 poizvedb na dan).
const KLJUC_SEZNAMA = 'https://warm.moha-mobil.cache/postaje';
let spomin = null;              // { ob, ids }

const NAJVEC_POSTAJ = 8;        // zgornja meja klicev proti Marpromu na minuto
const OKNO_MIN = 30;            // katera postajališča so »v rabi«
const SEZNAM_VELJA_MS = 5 * 60_000;
const CAS_KLICA_MS = 6000;      // nihče ne čaka, zato sme biti daljši od uporabnikovih 4 s
const SE_SVEZE_S = 25;          // pod toliko sekund starosti postajališča ne grejemo

/** Oznaka Cloudflarove lokacije, iz katere tece ta klic (npr. 'VIE'). '' ob napaki. */
async function kjeTecem() {
  try {
    const r = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(3000) });
    const m = /colo=([A-Z]{3})/.exec(await r.text());
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

/**
 * Katera postajališča so ljudje gledali v zadnjih OKNO_MIN minutah.
 * Rezultat velja SEZNAM_VELJA_MS, da se poizvedba v Analytics Engine ne ponovi
 * vsako minuto (branja so omejena na 10.000/dan); glej KLJUC_SEZNAMA.
 */
async function postajeVRabi(env) {
  if (spomin && Date.now() - spomin.ob < SEZNAM_VELJA_MS) return spomin.ids;
  const cache = caches.default;
  try {
    const hit = await cache.match(KLJUC_SEZNAMA);
    const shranjeno = hit ? await hit.json() : null;
    if (shranjeno && Array.isArray(shranjeno.ids) && Date.now() - shranjeno.ob < SEZNAM_VELJA_MS) {
      spomin = shranjeno;
      return shranjeno.ids;
    }
  } catch { /* predpomnilnik ni na voljo — poskusimo naravnost v statistiko */ }

  // Brez vrstic 'prekinjen': klic, ki ga je prehitel drugi posrednik, je isti
  // vpogled še enkrat in bi postajališče napihnil.
  const poizvedba = `
    SELECT blob8 AS postaja, SUM(_sample_interval) AS n
    FROM ${NABOR}
    WHERE blob1 = 'srv' AND blob3 = 'GetArrivalsForStopPoint' AND blob8 != '' AND blob4 != 'prekinjen'
      AND timestamp > NOW() - INTERVAL '${OKNO_MIN}' MINUTE
    GROUP BY postaja ORDER BY n DESC LIMIT ${NAJVEC_POSTAJ}
    FORMAT JSON`;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    { method: 'POST', headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` }, body: poizvedba,
      signal: AbortSignal.timeout(9000) },
  );
  if (!res.ok) throw new Error('SQL ' + res.status);
  const vrstice = (await res.json()).data ?? [];
  const ids = vrstice.map(v => String(v.postaja)).filter(id => /^\d{1,7}$/.test(id));

  spomin = { ob: Date.now(), ids };
  try {
    await cache.put(KLJUC_SEZNAMA, new Response(JSON.stringify(spomin), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${SEZNAM_VELJA_MS / 1000}` },
    }));
  } catch { /* zapis ni nujen; brez njega se poizvedba samo ponovi */ }
  return ids;
}

/**
 * Osveži eno postajališče. Vrne true ob uspehu, false ob neuspehu in null,
 * kadar je bilo že sveže in ga ni bilo treba spraševati.
 */
async function osvezi(id, cache, ttl) {
  const kljuc = kljucPredpomnilnika('GetArrivalsForStopPoint', { stopPointId: id });
  const hit = await cache.match(kljuc);
  if (hit && (Number(hit.headers.get('Age') ?? 0) || 0) <= SE_SVEZE_S) return null;

  try {
    const res = await fetch(obaUrl('GetArrivalsForStopPoint', { stopPointId: id }), {
      headers: OBA_HEADERS,
      signal: AbortSignal.timeout(CAS_KLICA_MS),
    });
    if (!res.ok) return false;
    // Enako preverjanje kot na poti za uporabnika (razvrstiOdgovor): napaka v
    // telesu s statusom 200 ni uspeh. Odgovor »ni podatkov« pomeni, da pot do
    // Marproma dela, v predpomnilnik pa ne gre — tam bi prepisal dobro kopijo.
    const telo = await res.text();
    const vrsta = razvrstiOdgovor('GetArrivalsForStopPoint', telo);
    if (vrsta !== 'ok' && vrsta !== 'prazno') return false;   // napaka ali neznan Status
    if (vrsta === 'ok') await cache.put(kljuc, zaPredpomnilnik(telo, ttl));
    return true;
  } catch {
    return false;
  }
}

/**
 * Glavni vstop, kliče se iz `scheduled`. Nikoli ne vrže — ogrevanje ne sme
 * podreti cron-a, ki poganja tudi zvonjenja.
 *
 * @param {number} podzahtevki  koliko podzahtevkov sme porabiti (meja 50 na klic
 *        velja za cel cron, glej PODZAHTEVKI_NA_KLIC v worker.js). Seznam postaj
 *        stane do 3 (cache.match, poizvedba, cache.put), vsako postajališče do 3
 *        (cache.match, fetch, cache.put) — temu primerno je postajališč manj.
 */
export async function ogrejPredpomnilnik(env, podzahtevki = Infinity) {
  if (!env.ANALYTICS || !env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;

  let ids;
  try {
    ids = await postajeVRabi(env);
  } catch (e) {
    console.log('gretje: seznama postaj ni bilo mogoče dobiti — ' + String(e && e.message ? e.message : e));
    return null;
  }
  ids = ids.slice(0, Math.max(0, Math.min(NAJVEC_POSTAJ, Math.floor((podzahtevki - 3) / 3))));
  if (!ids.length) {
    // Zapišemo tudi prazno rundo: sicer se »nihče ne uporablja aplikacije« ne loči
    // od »gretje se sploh ni izvedlo«, in to je prva stvar, ki jo človek pogleda.
    const prazno = { postaj: 0, uspelo: 0, klicev: 0, rund: 0, lokacija: '' };
    zapisiGretje(env, prazno);
    return prazno;
  }

  const cache = caches.default;
  const ttl = OBA_METHODS.GetArrivalsForStopPoint;

  // TIPANJE. Izmerjeno 22.09.2026: izidi klicev ZNOTRAJ enega klica Workerja so
  // med seboj korelirani — kadar prvi visi, visijo vsi. Zato najprej poskusimo
  // eno samo postajališče: če to ne gre, nima smisla spraševati Marproma še
  // sedemkrat. Tako v slabi minuti odide en klic namesto osmih.
  let uspelo = 0, klicev = 0;
  let i = 0;
  while (i < ids.length) {
    const izidTipanja = await osvezi(ids[i], cache, ttl);
    i++;
    if (izidTipanja === null) continue;       // to je bilo že sveže, poskusimo naslednje
    klicev++;
    if (izidTipanja === false) {
      const lokacija = await kjeTecem();
      const prazen = { postaj: ids.length, uspelo: 0, klicev, rund: 1, lokacija };
      zapisiGretje(env, prazen);
      return prazen;
    }
    uspelo++;
    break;                                     // pot je prehodna, nadaljujemo z ostalimi
  }

  // Ostala postajališča vzporedno: cron ima na voljo minuto, ne osemkrat šest sekund.
  const izidi = await Promise.all(ids.slice(i).map(id => osvezi(id, cache, ttl)));
  for (const x of izidi) {
    if (x === null) continue;
    klicev++;
    if (x) uspelo++;
  }

  const izid = { postaj: ids.length, uspelo, klicev, rund: 1, lokacija: '' };
  zapisiGretje(env, izid);
  return izid;
}
