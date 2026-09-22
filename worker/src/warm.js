/**
 * Ogrevanje predpomnilnika iz cron-a.
 *
 * Zakaj sploh: pot Cloudflare → vozniredi.marprom.si občasno visi (22.09.2026
 * izmerjeno: z roba uspe okoli četrtina klicev, isti hip neposredno 15/15).
 * Uporabnik zato vsake toliko ne dobi živih podatkov. Tu nihče ne čaka, zato si
 * cron lahko privošči več poskusov, razmaknjenih čez minuto — in ko eden uspe,
 * ima vsak uporabnik, ki v naslednjih ~2 minutah pogleda to postajališče,
 * zadetek v predpomnilniku namesto klica, ki lahko pade.
 *
 * Trije premisleki, ki oblikujejo to kodo:
 *
 *  1. **Grejemo samo tisto, kar kdo gleda.** Seznam postajališč pride iz
 *     statistike zadnjih 30 minut. Ponoči je prazen in cron ne naredi nič —
 *     Marproma ne obremenjujemo za postajališča, ki jih nihče ne gleda.
 *
 *  2. **Poskusi morajo biti razmaknjeni.** Izmerjeno je, da so poskusi znotraj
 *     enega klica Workerja med seboj korelirani: kadar prvi visi, visijo vsi.
 *     Zato so rundè razmaknjene za ~12 s; v eni rundi gredo klici vzporedno, da
 *     runda traja toliko kot en klic, ne osemkrat toliko.
 *
 *  3. **Cron teče vsako minuto**, zato mora biti vse skupaj krajše od minute,
 *     sicer se klici prekrivajo.
 */

import { OBA_HEADERS, OBA_METHODS, kljucPredpomnilnika, obaUrl, zaPredpomnilnik } from './oba.js';
import { zapisiGretje } from './analytics.js';

const NABOR = 'moha_mobil';
const KLJUC_KV = 'warm:postaje';

const NAJVEC_POSTAJ = 8;        // zgornja meja klicev na rundo (in proti Marpromu)
const OKNO_MIN = 30;            // katera postajališča so »v rabi«
const SEZNAM_VELJA_MS = 5 * 60_000;
const RUND = 3;
const PAVZA_MS = 12_000;
const CAS_KLICA_MS = 6000;      // nihče ne čaka, zato sme biti daljši od uporabnikovih 4 s
const SE_SVEZE_S = 25;          // pod toliko sekund starosti postajališča ne grejemo

const pocakaj = (ms) => new Promise(r => setTimeout(r, ms));

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
 * Rezultat se shrani v KV za SEZNAM_VELJA_MS, da se poizvedba v Analytics Engine
 * ne ponovi vsako minuto (branja so omejena na 10.000/dan).
 */
async function postajeVRabi(env) {
  try {
    const shranjeno = await env.ALARMS_KV.get(KLJUC_KV, 'json');
    if (shranjeno && Date.now() - shranjeno.ob < SEZNAM_VELJA_MS) return shranjeno.ids;
  } catch { /* KV ni na voljo — poskusimo naravnost v statistiko */ }

  const poizvedba = `
    SELECT blob8 AS postaja, SUM(_sample_interval) AS n
    FROM ${NABOR}
    WHERE blob1 = 'srv' AND blob3 = 'GetArrivalsForStopPoint' AND blob8 != ''
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

  try {
    await env.ALARMS_KV.put(KLJUC_KV, JSON.stringify({ ob: Date.now(), ids }), { expirationTtl: 3600 });
  } catch { /* zapis ni nujen; brez njega se poizvedba samo ponovi */ }
  return ids;
}

/** Ena runda: vzporedno osveži vse postaje, ki še niso sveže. Vrne tiste, ki niso uspele. */
async function runda(env, ids, cache, ttl, stanje) {
  const izidi = await Promise.all(ids.map(async (id) => {
    const kljuc = kljucPredpomnilnika('GetArrivalsForStopPoint', { stopPointId: id });
    const hit = await cache.match(kljuc);
    if (hit && (Number(hit.headers.get('Age') ?? 0) || 0) <= SE_SVEZE_S) return null;  // že sveže

    stanje.klicev++;
    try {
      const res = await fetch(obaUrl('GetArrivalsForStopPoint', { stopPointId: id }), {
        headers: OBA_HEADERS,
        signal: AbortSignal.timeout(CAS_KLICA_MS),
      });
      if (!res.ok) return id;
      await cache.put(kljuc, zaPredpomnilnik(await res.text(), ttl));
      stanje.uspelo++;
      return null;
    } catch {
      return id;
    }
  }));
  return izidi.filter(Boolean);
}

/**
 * Glavni vstop, kliče se iz `scheduled`. Nikoli ne vrže — ogrevanje ne sme
 * podreti cron-a, ki poganja tudi zvonjenja.
 */
export async function ogrejPredpomnilnik(env) {
  if (!env.ANALYTICS || !env.CF_ACCOUNT_ID || !env.CF_API_TOKEN) return null;

  let ids;
  try {
    ids = await postajeVRabi(env);
  } catch (e) {
    console.log('gretje: seznama postaj ni bilo mogoče dobiti — ' + String(e && e.message ? e.message : e));
    return null;
  }
  if (!ids.length) {
    // Zapišemo tudi prazno rundo: sicer se »nihče ne uporablja aplikacije« ne loči
    // od »gretje se sploh ni izvedlo«, in to je prva stvar, ki jo človek pogleda.
    const prazno = { postaj: 0, uspelo: 0, klicev: 0, rund: 0, lokacija: '' };
    zapisiGretje(env, prazno);
    return prazno;
  }

  const cache = caches.default;
  const ttl = OBA_METHODS.GetArrivalsForStopPoint;
  const stanje = { uspelo: 0, klicev: 0 };
  let preostale = ids;
  let rund = 0;

  for (let r = 0; r < RUND && preostale.length; r++) {
    if (r > 0) await pocakaj(PAVZA_MS);
    rund = r + 1;
    try {
      preostale = await runda(env, preostale, cache, ttl, stanje);
    } catch (e) {
      console.log('gretje: runda ni uspela — ' + String(e && e.message ? e.message : e));
      break;
    }
  }

  // Kadar ni uspel NOBEN klic, pogledamo, iz katere Cloudflarove lokacije je cron
  // sploh tekel. Klici uporabnikov v istem trenutku uspevajo, zato je vredno
  // vedeti, ali cron vedno tece iz iste lokacije in ali je prav ta zavrnjena.
  // Dodatni klic je samo ob neuspehu, torej najvec eden na minuto.
  let lokacija = '';
  if (stanje.uspelo === 0) lokacija = await kjeTecem();

  const izid = { postaj: ids.length, uspelo: stanje.uspelo, klicev: stanje.klicev, rund, lokacija };
  zapisiGretje(env, izid);
  return izid;
}
