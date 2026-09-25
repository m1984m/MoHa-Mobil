/**
 * GET /stat — povzetek statistike za pogled v aplikaciji.
 *
 * Poizvedbe so TU in samo tu: aplikacija in `scripts/statistika.mjs` obe bereta
 * prek te poti, zato se SQL ne more razdvojiti na dve mesti.
 *
 * Zaščita je dvojna in nobena od njiju ni skrivanje vhoda v aplikaciji:
 *   - `Origin` mora biti znan (to preveri že usmerjevalnik),
 *   - glava `x-stat-key` se mora ujemati s skrivnostjo `STAT_KEY`.
 * Deset dotikov na ime v Nastavitvah samo odpre zaslon — ključ je tisto, kar
 * zares varuje.
 *
 * Žeton za Cloudflarov SQL API (`CF_API_TOKEN`, pravica Account Analytics:
 * Read) in `CF_ACCOUNT_ID` sta skrivnosti Workerja, zato v aplikacijo nikoli ne
 * prideta — odjemalec vidi samo seštevke.
 */

const NABOR = 'moha_mobil';
const CACHE_MS = 60_000;      // branja so omejena (10.000/dan); minuta je dovolj sveže
let cache = new Map();        // 'dni' -> { ob, telo }

// Primerjava, ki ne izda dolžine ujemanja po času izvajanja.
function enakaKljuca(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function sql(env, poizvedba) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
      body: poizvedba,
      signal: AbortSignal.timeout(9000),
    },
  );
  const besedilo = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${besedilo.slice(0, 200)}`);
  return JSON.parse(besedilo).data ?? [];
}

/**
 * Vse poizvedbe na enem mestu. `dni` je že preverjeno celo število.
 * Opombe o narečju: za štetje ob vzorčenju se uporablja SUM(_sample_interval),
 * za dan toStartOfInterval (toDate ni zanesljiv) in za mediano
 * quantileExactWeighted (quantileWeighted z novo obliko klica ne dela).
 */
export function poizvedbe(dni) {
  const OD = `timestamp > NOW() - INTERVAL '${dni}' DAY`;
  return {
    zagoni: `
      SELECT blob3 AS nacin, blob4 AS razlicica, blob5 AS tema, blob6 AS starejsi,
             SUM(_sample_interval) AS n
      FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'zagon' AND ${OD}
      GROUP BY nacin, razlicica, tema, starejsi ORDER BY n DESC FORMAT JSON`,
    zavihki: `
      SELECT blob3 AS zavihek, SUM(_sample_interval) AS n
      FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'zavihek' AND ${OD}
      GROUP BY zavihek ORDER BY n DESC FORMAT JSON`,
    filter: `
      SELECT blob3 AS smer, SUM(_sample_interval) AS n
      FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'filter' AND ${OD}
      GROUP BY smer ORDER BY n DESC FORMAT JSON`,
    namestitev: `
      SELECT blob3 AS korak, SUM(_sample_interval) AS n
      FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'namestitev' AND ${OD}
      GROUP BY korak ORDER BY n DESC FORMAT JSON`,
    omrezje: `
      SELECT blob3 AS stanje, SUM(_sample_interval) AS n
      FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'omrezje' AND ${OD}
      GROUP BY stanje ORDER BY n DESC FORMAT JSON`,
    // Casovnica zagonov po dnevih — ena serija, za crto/ploscino.
    zagoniDnevi: `
      SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS dan, SUM(_sample_interval) AS n
      FROM ${NABOR} WHERE blob1 = 'app' AND blob2 = 'zagon' AND ${OD}
      GROUP BY dan ORDER BY dan FORMAT JSON`,
    // Casovnica zaledja po dnevih: skupaj, od tega napake, in mediana odziva.
    // Samo OBA in ORS: branje (tts) traja sekunde in bi zameglilo mediano.
    zaledjeDnevi: `
      SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS dan,
             SUM(_sample_interval) AS n,
             sumIf(_sample_interval, blob4 = 'napaka' OR blob4 = 'nedosegljiv') AS napak,
             quantileExactWeighted(0.5)(double1, _sample_interval) AS ms_p50
      FROM ${NABOR} WHERE blob1 = 'srv' AND blob2 IN ('oba', 'ors') AND ${OD}
      GROUP BY dan ORDER BY dan FORMAT JSON`,
    // Najbolj gledana postajalisca (blob8 pri GetArrivalsForStopPoint).
    postaje: `
      SELECT blob8 AS postaja, SUM(_sample_interval) AS n
      FROM ${NABOR}
      WHERE blob1 = 'srv' AND blob3 = 'GetArrivalsForStopPoint' AND blob8 != '' AND ${OD}
      GROUP BY postaja ORDER BY n DESC LIMIT 60 FORMAT JSON`,
    zaledje: `
      SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS dan,
             blob2 AS storitev, blob4 AS izid,
             SUM(_sample_interval) AS n,
             quantileExactWeighted(0.5)(double1, _sample_interval) AS ms_p50
      FROM ${NABOR} WHERE blob1 = 'srv' AND ${OD}
      GROUP BY dan, storitev, izid ORDER BY dan DESC, n DESC FORMAT JSON`,
  };
}

export async function handleStat(request, env, cors) {
  const json = (o, s) => new Response(JSON.stringify(o), {
    status: s,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });

  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  if (!env.STAT_KEY) return json({ error: 'STAT_KEY ni nastavljen' }, 503);
  if (!enakaKljuca(request.headers.get('x-stat-key') ?? '', env.STAT_KEY)) {
    return json({ error: 'napacen kljuc' }, 401);
  }
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return json({ error: 'CF_API_TOKEN ali CF_ACCOUNT_ID ni nastavljen' }, 503);
  }

  const zahtevani = Number(new URL(request.url).searchParams.get('dni') ?? 7);
  const dni = Number.isFinite(zahtevani) ? Math.min(90, Math.max(1, Math.round(zahtevani))) : 7;

  const hit = cache.get(dni);
  if (hit && Date.now() - hit.ob < CACHE_MS) {
    return json({ ...hit.telo, izPredpomnilnika: true }, 200);
  }

  const q = poizvedbe(dni);
  const imena = Object.keys(q);
  let izidi;
  try {
    izidi = await Promise.all(imena.map(k => sql(env, q[k])));
  } catch (e) {
    return json({ error: 'poizvedba ni uspela', detail: String(e && e.message ? e.message : e) }, 502);
  }

  const telo = { dni, ob: new Date().toISOString() };
  imena.forEach((k, i) => { telo[k] = izidi[i]; });

  if (cache.size > 8) cache = new Map();
  cache.set(dni, { ob: Date.now(), telo });
  return json(telo, 200);
}
