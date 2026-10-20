/**
 * Spremljanje vozil — prevoženi kilometri po avtobusih za zasebno stran
 * `/MoHa-Mobil/spremljanje/`.
 *
 * Marprom (OBA GetActiveDeviceDetails) pove samo, kje je vozilo ta trenutek. Za
 * kilometre čez dan mora nekdo položaje beležiti ves dan, tudi ko stran ni odprta,
 * zato to dela cron: vsako minuto dva vzorca (ob zagonu in 30 s pozneje), razdalja
 * med zaporednima položajema se prišteje vozilu, položaj pa se doda njegovi poti.
 *
 * Kilometri so OCENA in samo za čas, ko je vozilo prijavljeno na vožnjo — prazne
 * vožnje v garažo v podatkih niso. To ni števec kilometrov vozila. Razdalja med
 * vzorcema se meri po trasi linije (GTFS, trase.js), kadar sta obe točki na njej;
 * sicer po ravni črti. `km_trasa` je del kilometrov, izmerjen po trasi.
 *
 * Shramba je D1 (`SPREMLJANJE_DB`, shema v ../spremljanje.sql): ena vrstica na
 * vozilo in dan, pot je v isti vrstici kot besedilo, ki se mu sproti dodaja. Tako
 * je pisanj eno na vozilo na minuto (~30 vozil × ~1.140 minut ≈ 34.000 na dan,
 * brezplačna meja je 100.000). Kilometri in poti ostanejo 30 dni (~3 MB poti na dan,
 * skupaj ~100 MB; baza D1 na Workers Paid sprejme do 10 GB).
 *
 * GET /spremljanje?dan=YYYY-MM-DD[&dnevi=1]   vozila izbranega dne (+ seznam dni)
 * GET /spremljanje/pot?dan=YYYY-MM-DD&bus=123  pot enega vozila
 * GET /spremljanje/poti?dan=YYYY-MM-DD[&od=s]  poti vseh vozil (sledi na karti);
 *                                              z `od` samo točke po tem času
 * Vse zahteva glavo x-stat-key (isto geslo kot zaslon s statistiko).
 */

import { enakaKljuca, prevecPoskusov } from './stat.js';
import { razdaljaPoTrasi } from './trase.js';

export const RAZMIK_VZORCEV_MS = 30_000;
// Premik, manjši od tega, je šum GPS stoječega vozila. Izhodišče se premakne šele,
// ko je vozilo za toliko stran, zato se počasna vožnja v koloni ne izgubi.
export const NAJMANJ_KORAK_M = 25;
// Hitrejši »skok« je napaka položaja; razdalja se ne prišteje.
export const NAJVEC_HITROST_KMH = 90;
// Po daljši vrzeli (vozilo odjavljeno, izpad posrednika) ravna črta ne pove, kod
// je vozilo vozilo — razdalja se ne prišteje, pot se tam prekine.
export const NAJVEC_VRZEL_S = 300;
// Po trasi je pot znana tudi čez daljšo vrzel, zato sme biti vrzel daljša; hitrost
// po trasi je povprečje z ustavljanjem, zato nižja meja kot pri skoku.
export const NAJVEC_VRZEL_TRASA_S = 900;
export const NAJVEC_HITROST_TRASA_KMH = 70;
export const NAJVEC_VOZIL = 150;
// D1 dovoli 100 vezanih parametrov na stavek (12 na vozilo) in na brezplačnem
// paketu 50 poizvedb na klic Workerja — zato več vozil v enem stavku INSERT.
export const VOZIL_NA_STAVEK = 8;
export const DNI_KM = 30;
export const DNI_POT = 30;   // podaljšano s 7 dni 20.10.2026
// Grob okvir območja, ki ga Marprom pokriva; položaj zunaj je napaka.
const OKVIR = { latMin: 46.3, latMax: 46.8, lonMin: 15.3, lonMax: 16.0 };

const TZ = 'Europe/Ljubljana';
const fmtDan = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtUra = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Koledarski dan v Ljubljani, 'YYYY-MM-DD'. */
export function danLj(ms) {
  return fmtDan.format(new Date(ms));
}

/** [ura, minuta] v Ljubljani. */
export function uraLj(ms) {
  return fmtUra.format(new Date(ms)).split(':').map(Number);
}

/** Razdalja v metrih (haversine). */
export function razdaljaM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Vozila iz telesa GetActiveDeviceDetails: [{ bus, lat, lon, linija }].
 * Brez številke vozila ali z nemogočim položajem se izpustijo; vozilo, ki se v
 * odgovoru ponovi, šteje enkrat.
 */
export function vozilaIz(telo) {
  let j;
  try { j = JSON.parse(telo); } catch { return []; }
  const seznam = Array.isArray(j?.Vehicles) ? j.Vehicles : [];
  const videna = new Set();
  const out = [];
  for (const v of seznam) {
    // Marprom ima v konici ~46 vozil; meja ščiti kvoto pisanj D1 pred pokvarjenim
    // ali zlonamernim odgovorom (vsako vozilo je ena vrstica zapisa na minuto).
    if (out.length >= NAJVEC_VOZIL) break;
    const bus = String(v?.BusCode ?? '').trim();
    const lat = Number(v?.Lat);
    const lon = Number(v?.Lon);
    if (!/^[0-9A-Za-z-]{1,12}$/.test(bus) || videna.has(bus)) continue;
    if (!(lat >= OKVIR.latMin && lat <= OKVIR.latMax && lon >= OKVIR.lonMin && lon <= OKVIR.lonMax)) continue;
    videna.add(bus);
    out.push({ bus, lat, lon, linija: Number.isFinite(Number(v?.LineId)) ? Number(v.LineId) : null });
  }
  return out;
}

/**
 * Doda en vzorec (vozila ob času `t`, ms) stanju. Čista funkcija nad Map:
 * bus -> { km, kmTrasa, prva, zadnja, lat, lon, tpol, linije:Set, vzorcev, nove:[] }.
 * `lat/lon/tpol` je izhodišče (zadnji sprejeti položaj), `nove` so točke poti,
 * ki jih je treba še zapisati: 't,lat,lon' oziroma s predpono '!' za prekinitev.
 * `poTrasi(linija, latA, lonA, latB, lonB, ravna)` vrne razdaljo po trasi v m ali
 * null (zamenljiva za preverbe). Vrne množico vozil, ki jih je treba zapisati.
 */
export function dodajVzorec(stanje, vozila, t, spremenjena = new Set(), poTrasi = razdaljaPoTrasi) {
  const ts = Math.round(t / 1000);
  for (const v of vozila) {
    let s = stanje.get(v.bus);
    if (!s) {
      s = { km: 0, kmTrasa: 0, prva: t, zadnja: t, lat: v.lat, lon: v.lon, tpol: t, linije: new Set(), vzorcev: 0, nove: [] };
      s.nove.push(`!${ts},${v.lat.toFixed(5)},${v.lon.toFixed(5)}`);
      stanje.set(v.bus, s);
    } else if (t <= s.zadnja) {
      continue;                                   // vzorec ni novejši od zapisanega
    } else {
      const d = razdaljaM(s.lat, s.lon, v.lat, v.lon);
      const dt = (t - s.tpol) / 1000;
      if (d >= NAJMANJ_KORAK_M) {
        // Najprej po trasi linije; če par na trasi ni smiseln (hitrost, vrzel),
        // veljajo pravila za ravno črto.
        const dp = dt > 0 ? poTrasi(v.linija, s.lat, s.lon, v.lat, v.lon, d) : null;
        const poTrasiVelja = dp != null && dt <= NAJVEC_VRZEL_TRASA_S && (dp / dt) * 3.6 <= NAJVEC_HITROST_TRASA_KMH;
        const veljaven = poTrasiVelja || (dt > 0 && dt <= NAJVEC_VRZEL_S && (d / dt) * 3.6 <= NAJVEC_HITROST_KMH);
        if (poTrasiVelja) { s.km += dp / 1000; s.kmTrasa += dp / 1000; }
        else if (veljaven) s.km += d / 1000;
        s.nove.push(`${veljaven ? '' : '!'}${ts},${v.lat.toFixed(5)},${v.lon.toFixed(5)}`);
        s.lat = v.lat; s.lon = v.lon; s.tpol = t;
      } else if (dt > NAJVEC_VRZEL_S) {
        // Dolgo stal na istem mestu: izhodišče osvežimo, da naslednji premik ne
        // pade med »vrzeli« samo zato, ker je bil zadnji sprejeti položaj star.
        s.tpol = t;
      }
      s.zadnja = t;
    }
    if (v.linija != null) s.linije.add(v.linija);
    s.vzorcev++;
    spremenjena.add(v.bus);
  }
  return spremenjena;
}

/** Vrstica iz D1 -> stanje enega vozila. */
function izVrstice(r) {
  return {
    km: r.km, kmTrasa: r.km_trasa ?? 0, prva: r.prva, zadnja: r.zadnja, lat: r.lat, lon: r.lon, tpol: r.tpol,
    linije: new Set(String(r.linije ?? '').split(',').filter(Boolean).map(Number)),
    vzorcev: r.vzorcev, nove: [],
  };
}

const UPSERT = (vrstic) => `
  INSERT INTO dnevno (dan, bus, km, km_trasa, prva, zadnja, lat, lon, tpol, linije, vzorcev, pot)
  VALUES ${Array(vrstic).fill('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}
  ON CONFLICT (dan, bus) DO UPDATE SET
    km = excluded.km, km_trasa = excluded.km_trasa, zadnja = excluded.zadnja, lat = excluded.lat, lon = excluded.lon,
    tpol = excluded.tpol, linije = excluded.linije, vzorcev = excluded.vzorcev,
    pot = CASE WHEN excluded.pot = '' THEN dnevno.pot
               WHEN dnevno.pot IS NULL OR dnevno.pot = '' THEN excluded.pot
               ELSE dnevno.pot || ';' || excluded.pot END
  WHERE excluded.zadnja > dnevno.zadnja`;
// WHERE: dva zagona crona se lahko prekrijeta (Cloudflare zamakne zagon za nekaj
// deset sekund). Starejši zapis ne sme prepisati novejšega; izgubi se kvečjemu
// nekaj točk poti, kilometri pa ostanejo pravilni do ravne črte natančno.

/**
 * Cron: dva vzorca, nato en paketni zapis. `vozila()` vrne telo
 * GetActiveDeviceDetails ali null; `ura()` je čas vzorca (zamenljiv za preverbe).
 * Dan določi čas prvega vzorca, ne načrtovani čas crona — zagon ob 23:59:50 lahko
 * vzorči že po polnoči. Nikoli ne vrže.
 */
export async function zabeleziVozila(env, vozila, ura = Date.now) {
  const db = env.SPREMLJANJE_DB;
  if (!db) return null;
  const zacetek = ura();

  const telo1 = await vozila();
  const t1 = ura();
  const dan = danLj(t1);
  const v1 = telo1 ? vozilaIz(telo1) : [];
  // Ponoči ni vozil: drugega vzorca ne čakamo.
  let v2 = [], t2 = 0;
  if (v1.length) {
    await new Promise(r => setTimeout(r, Math.max(0, RAZMIK_VZORCEV_MS - (ura() - t1))));
    const telo2 = await vozila();
    t2 = ura();
    // Vzorec čez polnoč spada v nov dan; tega 30 s izpustimo.
    v2 = telo2 && danLj(t2) === dan ? vozilaIz(telo2) : [];
  }

  let zapisanih = 0;
  if (v1.length || v2.length) {
    const { results } = await db.prepare(
      'SELECT bus, km, km_trasa, prva, zadnja, lat, lon, tpol, linije, vzorcev FROM dnevno WHERE dan = ?1',
    ).bind(dan).all();
    const stanje = new Map(results.map(r => [r.bus, izVrstice(r)]));
    const spremenjena = dodajVzorec(stanje, v1, t1);
    if (v2.length) dodajVzorec(stanje, v2, t2, spremenjena);

    const vrstice = [...spremenjena].map(bus => {
      const s = stanje.get(bus);
      return [
        dan, bus, Math.round(s.km * 1000) / 1000, Math.round(s.kmTrasa * 1000) / 1000, s.prva, s.zadnja, s.lat, s.lon, s.tpol,
        [...s.linije].join(','), s.vzorcev, s.nove.join(';'),
      ];
    });
    const stavki = [];
    for (let i = 0; i < vrstice.length; i += VOZIL_NA_STAVEK) {
      const kos = vrstice.slice(i, i + VOZIL_NA_STAVEK);
      stavki.push(db.prepare(UPSERT(kos.length)).bind(...kos.flat()));
    }
    if (stavki.length) await db.batch(stavki);
    zapisanih = vrstice.length;
  }

  // Čiščenje enkrat na dan ob 3h (nekaj zagonov, da ga zamaknjen cron ne zgreši).
  const [h, minuta] = uraLj(t1);
  if (h === 3 && minuta < 5) {
    const pred = (dni) => danLj(t1 - dni * 86_400_000);
    await db.batch([
      db.prepare('UPDATE dnevno SET pot = NULL WHERE dan < ?1 AND pot IS NOT NULL').bind(pred(DNI_POT)),
      db.prepare('DELETE FROM dnevno WHERE dan < ?1').bind(pred(DNI_KM)),
    ]);
  }

  const izid = { dan, vozil: Math.max(v1.length, v2.length), vzorcev: (v1.length ? 1 : 0) + (v2.length ? 1 : 0), zapisanih, ms: ura() - zacetek };
  console.log(`spremljanje: dan=${izid.dan} vozil=${izid.vozil} vzorcev=${izid.vzorcev} zapisanih=${izid.zapisanih} ${izid.ms}ms`);
  return izid;
}

/** Točke poti iz shranjenega besedila: [[t(ms), lat, lon, prekinitev], …]. */
export function razcleniPot(besedilo) {
  if (!besedilo) return [];
  const out = [];
  for (const del of String(besedilo).split(';')) {
    if (!del) continue;
    const prek = del.startsWith('!');
    const [t, lat, lon] = (prek ? del.slice(1) : del).split(',').map(Number);
    if (Number.isFinite(t) && Number.isFinite(lat) && Number.isFinite(lon)) out.push([t * 1000, lat, lon, prek ? 1 : 0]);
  }
  return out;
}

const DAN_RE = /^\d{4}-\d{2}-\d{2}$/;
// Rep poti za osveževanje sledi: 12.000 znakov je ~430 točk (~3,5 h pri dveh
// točkah na minuto). Starejši `od` dobi celo pot.
const REP_ZNAKOV = 12_000;
const REP_NAJVEC_S = 2 * 3600;

/**
 * Točke iz repa poti, novejše od `od` (s), v shranjeni obliki. Kadar je rep
 * odrezan sredi poti, je prvi kos lahko načet in se izpusti.
 */
export function repPoti(besedilo, odrezan, od) {
  if (!besedilo) return '';
  const deli = String(besedilo).split(';');
  if (odrezan) deli.shift();
  const out = [];
  for (let i = deli.length - 1; i >= 0; i--) {
    const del = deli[i];
    const t = Number((del.startsWith('!') ? del.slice(1) : del).split(',', 1)[0]);
    if (!(t > od)) break;                       // točke so po času; starejše ne rabimo
    out.push(del);
  }
  return out.reverse().join(';');
}

export async function handleSpremljanje(request, env, path, cors) {
  const json = (o, s) => new Response(JSON.stringify(o), {
    status: s,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });

  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  if (!env.STAT_KEY) return json({ error: 'STAT_KEY ni nastavljen' }, 503);
  // Stran pošlje ~3 zahteve na minuto (kilometri, sledi, pot izbranega).
  if (await prevecPoskusov(env, request)) return json({ error: 'preveč zahtev' }, 429);
  if (!enakaKljuca(request.headers.get('x-stat-key') ?? '', env.STAT_KEY)) {
    return json({ error: 'napacen kljuc' }, 401);
  }
  const db = env.SPREMLJANJE_DB;
  if (!db) return json({ error: 'SPREMLJANJE_DB ni vezan' }, 503);

  const q = new URL(request.url).searchParams;
  const dan = q.get('dan') || danLj(Date.now());
  if (!DAN_RE.test(dan)) return json({ error: 'bad dan' }, 400);

  if (path === '/spremljanje/pot') {
    const bus = q.get('bus') ?? '';
    if (!/^[0-9A-Za-z-]{1,12}$/.test(bus)) return json({ error: 'bad bus' }, 400);
    const r = await db.prepare('SELECT pot FROM dnevno WHERE dan = ?1 AND bus = ?2').bind(dan, bus).first();
    return json({ dan, bus, pot: razcleniPot(r?.pot) }, 200);
  }

  // Sledi vseh vozil. Besedilo poti gre ven v shranjeni obliki ('t,lat,lon;…'),
  // brez razčlenjevanja na strežniku: cel dan je ~3 MB in to bi porabilo čas
  // procesorja Workerja, stran pa ga razčleni sama. Z `od` (sekunde, zadnja točka,
  // ki jo stran že ima) gre iz baze samo rep vsake poti, kar je med osveževanjem
  // nekaj sto bajtov na vozilo namesto celega dne.
  if (path === '/spremljanje/poti') {
    const od = Number(q.get('od') ?? 0);
    const zdajS = Date.now() / 1000;
    const rep = Number.isFinite(od) && od > zdajS - REP_NAJVEC_S && od <= zdajS + 60;
    const { results } = await db.prepare(rep
      ? 'SELECT bus, length(pot) AS n, substr(pot, -?2) AS pot FROM dnevno WHERE dan = ?1 AND pot IS NOT NULL'
      : 'SELECT bus, pot FROM dnevno WHERE dan = ?1 AND pot IS NOT NULL',
    ).bind(...(rep ? [dan, REP_ZNAKOV] : [dan])).all();
    const poti = {};
    for (const r of results) {
      const p = rep ? repPoti(r.pot, r.n > REP_ZNAKOV, od) : r.pot;
      if (p) poti[r.bus] = p;
    }
    return json({ dan, ob: Date.now(), rep, poti }, 200);
  }

  if (path !== '/spremljanje') return json({ error: 'not found' }, 404);

  const { results } = await db.prepare(
    'SELECT bus, km, km_trasa AS kmTrasa, prva, zadnja, lat, lon, linije, vzorcev, pot IS NOT NULL AS imaPot FROM dnevno WHERE dan = ?1 ORDER BY km DESC',
  ).bind(dan).all();
  const telo = {
    dan,
    ob: Date.now(),
    vozila: results.map(r => ({ ...r, km: Math.round(r.km * 100) / 100, kmTrasa: Math.round((r.kmTrasa ?? 0) * 100) / 100, linije: String(r.linije ?? '').split(',').filter(Boolean).map(Number), imaPot: !!r.imaPot })),
  };
  if (q.get('dnevi') === '1') {
    const d = await db.prepare(
      'SELECT dan, ROUND(SUM(km), 1) AS km, COUNT(*) AS vozil FROM dnevno GROUP BY dan ORDER BY dan DESC LIMIT ?1',
    ).bind(DNI_KM + 1).all();
    telo.dnevi = d.results;
    // Velikost arhiva za prikaz na strani: `size_after` je velikost cele baze D1 v
    // bajtih (vse tabele), ki jo D1 vrne ob vsaki poizvedbi; znaki poti so delež sledi.
    const a = await db.prepare(
      'SELECT COUNT(*) AS vrstic, COUNT(DISTINCT dan) AS dni, MIN(dan) AS od, COALESCE(SUM(length(pot)), 0) AS znakovPoti FROM dnevno',
    ).all();
    telo.arhiv = { ...a.results[0], bajtov: a.meta?.size_after ?? null };
  }
  return json(telo, 200);
}
