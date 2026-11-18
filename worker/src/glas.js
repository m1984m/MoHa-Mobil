/**
 * Novi glas za glasno branje (ElevenLabs) — pogon za POST /tts in stikalo GET/POST /glas.
 *
 * V aplikaciji se glas še naprej imenuje Petra; bere ga glas ElevenLabs. Ključ je
 * samo za MoHa Mobil, z lastno mejo kreditov pri ElevenLabs. Krediti so plačljivi
 * in omejeni, zato:
 *
 *   - vsaka POVED se sintetizira samo enkrat in ostane v D1 (tabela glas_povedi,
 *     shema ../glas.sql): naslednjič pride iz shrambe brez kreditov. Besedilo za
 *     branje se zato razreže na povedi; »V živo.« ali »Postajališče Glavni trg.«
 *     se ponovita v vsakem branju, cel odstavek pa skoraj nikoli.
 *   - mesečna zgornja meja kreditov (GLAS_MEJA_KREDITOV). Ko je dosežena, /tts bere
 *     s prejšnjim glasom (Edge, sl-SI-PetraNeural), dokler se mesec ne obrne.
 *   - stikalo v tabeli glas_stanje (zaslon Statistika v aplikaciji): novi glas se
 *     izklopi za vse, ne da bi bilo treba brisati skrivnost.
 *
 * Povedi so brez števk (stevilke.js) in s časi besed, da so uporabne tudi zunaj
 * Workerja.
 *
 * Skrivnost: npx wrangler secret put ELEVENLABS_API_KEY. Brez nje ali brez
 * tabel v D1 tega pogona ni in /tts dela kot prej.
 */

import { enakaKljuca, prevecPoskusov } from './stat.js';
import { vBesede } from './stevilke.js';

export const GLAS_PRIVZETO = '1QgmVFFJ2yzJsEU1pSGg';   // slovenski glas ElevenLabs
export const MODEL_PRIVZETO = 'eleven_v4_turbo';        // hitri model s slovenščino
// 64 kbit/s: poved (3 s) ima ~24 kB.
export const FORMAT = 'mp3_44100_64';
const JEZIK = 'sl';
const STABILNOST = 0.3;                                  // 0,5 je naravno, nižje bolj razgibano
const API = 'https://api.elevenlabs.io';

// Najdaljše branje (šest odhodov) ima okoli 14 povedi po razrezu; več jih ne
// pričakujemo, in vsaka nova je en klic na ElevenLabs.
export const NAJVEC_POVEDI = 16;
// Meja dolžine PO razpisu števk: »999999« je šest znakov, razpisano pa 60, in 800
// znakov samih števk bi dalo skoraj 7.000 znakov za en klic. Najdaljše pravo branje
// ima okoli 550 znakov; kar je daljše, bere prejšnji glas.
export const NAJVEC_ZNAKOV = 1000;
// 500: najdaljši povedi v aplikaciji sta seznama vozovnic v ceniku (ena poved s
// podpičji, razpisano 470 in 453 znakov). Pri 400 ju je bral prejšnji glas in sta se
// v enem branju cenika glasova mešala. Cenik se spremeni enkrat na leto, zato se
// plača enkrat.
export const NAJVEC_ZNAKOV_POVEDI = 500;
// Hkratnih klicev: naročnina ElevenLabs omejuje sočasnost.
const VZPOREDNO = 3;
// Vse nove povedi enega branja skupaj. Po tem bere Edge; aplikacija čaka 12 s.
// 7 s: seznam vozovnic iz cenika (470 znakov, 40 s zvoka) je ob prvi sintezi trajal
// 4,4 s (izmerjeno 19.11.2026) in bi pri 4,5 s na počasnejši dan padel na prejšnji
// glas, rezervirani krediti pa bi ostali porabljeni. Navadna poved je gotova v ~1 s.
const CAS_MS = 7000;
// Ocena, kadar ElevenLabs stroška ne pove v glavi `character-cost` (izmerjeno
// 18.11.2026: 268 znakov je stalo 53 kreditov).
export const KREDITI_NA_ZNAK = 0.2;
export const MEJA_PRIVZETO = 3000;
const STANJE_VELJA_MS = 30_000;

const fmtMesec = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit' });
/** Mesec v Ljubljani, 'YYYY-MM' — obdobje mesečne meje. */
export function mesecLj(ms) {
  return fmtMesec.format(new Date(ms));
}

/**
 * Povedi v besedilu. Meja je končno ločilo,
 * presledek, velika začetnica. Za kratko okrajšavo z veliko začetnico (»Sv. Peter«,
 * »Dr. Kovača«) se ne reže: narobe odrezan kos bi ostal v shrambi,
 * preveč skupaj pa pomeni samo manj ponovne rabe.
 */
export function povedi(besedilo) {
  // Vezaj s presledki v imenih postajališč (»Zrkovska - Gasilski dom«) glas prebere z
  // nenaravnim premorom; vejica da kratek, naraven premor (Matej zavrnil 18.11.2026).
  const cisto = String(besedilo ?? '').trim().replace(/(?<=\p{L}|\d)\s+[-–—]\s+(?=\p{L}|\d)/gu, ', ')
    // Oznaka »S31« (forSpeech: »S enaintrideset«): sama črka S zveni kot predlog »s«; Matej je
    // 18.11.2026 izbral »Es enaintrideset«. Samo pred številom z besedo.
    .replace(/(^|[^\p{L}])S (?=\p{L}*(?:ena|dva|dve|tri|štiri|pet|šest|sedem|osem|devet|deset|najst|set|sto)(?![\p{L}]))/gu, '$1Es ');
  const deli = cisto.split(/(?<=[.!?])\s+(?=[A-ZČŠŽĐĆ])/u).filter(Boolean);
  const cele = [];
  for (const d of deli) {   // za kratko okrajšavo se ne reže
    const prej = cele[cele.length - 1];
    if (prej !== undefined && /(^|\s)\p{Lu}\p{L}{0,2}\.$/u.test(prej)) cele[cele.length - 1] = `${prej} ${d}`;
    else cele.push(d);
  }
  // Poved iz ene ali dveh besed (»V živo.«) sama zveni odsekano (Matej zavrnil 18.11.2026),
  // zato gre k prejšnji. Izjema je naslov novega postajališča (»Postajališče Tabor.«
  // ima tudi samo dve besedi): ta začne novo poved, sicer bi se na Domu, kjer se bere
  // več postajališč zapored, prilepil na zadnji odhod prejšnjega in bi bila vsaka taka
  // kombinacija nova, plačana poved. Tako je »Postajališče Tabor. V živo.« ista poved
  // na Domu in v listu postajališča.
  const out = [];
  for (const d of cele) {
    if (out.length && d.split(/\s+/).length <= 2 && !d.startsWith('Postajališče ')) out[out.length - 1] += ` ${d}`;
    else out.push(d);
  }
  return out;
}

/** Ključ povedi v shrambi: glas, model in zapis zvoka so del ključa, nastavitve glasu ne. */
export async function kljucPovedi(glas, model, poved) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${glas}|${model}|${FORMAT}|${poved}`));
  return Array.from(new Uint8Array(buf).subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * MP3 brez oznak ID3 (v2 na začetku, v1 na koncu). Povedi se zlepijo v en posnetek;
 * oznaka sredi toka pri nekaterih predvajalnikih naredi pok ali ustavi branje.
 */
export function brezOznak(u8) {
  let od = 0, konec = u8.length;
  while (konec - od > 10 && u8[od] === 0x49 && u8[od + 1] === 0x44 && u8[od + 2] === 0x33) {
    const velikost = ((u8[od + 6] & 0x7f) << 21) | ((u8[od + 7] & 0x7f) << 14) | ((u8[od + 8] & 0x7f) << 7) | (u8[od + 9] & 0x7f);
    od += 10 + velikost + ((u8[od + 5] & 0x10) ? 10 : 0);
  }
  if (od > konec) od = konec;
  if (konec - od >= 128 && u8[konec - 128] === 0x54 && u8[konec - 127] === 0x41 && u8[konec - 126] === 0x47) konec -= 128;
  return u8.subarray(od, konec);
}

// Bitne hitrosti (kbit/s) in vzorčenja za Layer III: MPEG-1 ter MPEG-2/2.5.
const BITNE = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const VZORCENJA = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * MP3 brez prvega okvira, kadar je ta glava »Info«/»Xing« (tih okvir z dolžino in
 * številom okvirov). ElevenLabs jo doda vsaki povedi; v zlepljenem posnetku bi prva
 * povedala dolžino samo prve povedi, in predvajalnik (WebKit) bi po njej presodil
 * trajanje celega branja. Brez glav ga oceni iz bitne hitrosti, ki je stalna.
 * V shrambi ostane poved cela; odreže se samo pri zlepljanju.
 * Česar ne prepozna, pusti pri miru.
 */
export function brezGlaveInfo(u8) {
  if (u8.length < 64 || u8[0] !== 0xff || (u8[1] & 0xe0) !== 0xe0) return u8;
  const razlicica = (u8[1] >> 3) & 3, plast = (u8[1] >> 1) & 3;     // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5; plast 1 = Layer III
  if (plast !== 1 || razlicica === 1) return u8;
  const hitrost = BITNE[razlicica === 3 ? 1 : 2][u8[2] >> 4];
  const vzorcenje = VZORCENJA[razlicica]?.[(u8[2] >> 2) & 3];
  if (!hitrost || !vzorcenje) return u8;
  const dolzina = Math.floor((razlicica === 3 ? 144 : 72) * hitrost * 1000 / vzorcenje) + ((u8[2] >> 1) & 1);
  if (dolzina < 24 || dolzina >= u8.length) return u8;
  // Oznaka je za glavo okvira in stranskimi podatki, na različnih odmikih glede na različico in kanale.
  let najdena = false;
  for (let i = 4; i < Math.min(dolzina, 48) - 3 && !najdena; i++) {
    const o = String.fromCharCode(u8[i], u8[i + 1], u8[i + 2], u8[i + 3]);
    najdena = o === 'Info' || o === 'Xing';
  }
  // Naslednji okvir se mora začeti s sinhronizacijo, sicer smo dolžino izračunali narobe.
  if (!najdena || u8[dolzina] !== 0xff || (u8[dolzina + 1] & 0xe0) !== 0xe0) return u8;
  return u8.subarray(dolzina);
}

/** Časi besed iz poravnave znakov (kot Pipecat calculate_word_times): [[beseda, začetek v s], …]. */
export function besedeIzPoravnave(poravnava) {
  const znaki = poravnava?.characters, casi = poravnava?.character_start_times_seconds;
  if (!Array.isArray(znaki) || !Array.isArray(casi) || znaki.length !== casi.length) return [];
  const out = [];
  let beseda = '', zacetek = 0;
  for (let i = 0; i < znaki.length; i++) {
    if (/\s/.test(znaki[i])) {
      if (beseda) out.push([beseda, zacetek]);
      beseda = '';
    } else {
      if (!beseda) zacetek = Math.max(0, Math.round(Number(casi[i]) * 1000) / 1000);
      beseda += znaki[i];
    }
  }
  if (beseda) out.push([beseda, zacetek]);
  return out;
}

function izBase64(b64) {
  const niz = atob(b64);
  const u8 = new Uint8Array(niz.length);
  for (let i = 0; i < niz.length; i++) u8[i] = niz.charCodeAt(i);
  return u8;
}

/**
 * Ena poved pri ElevenLabs. Vrne { mp3, casi, krediti } ali vrže (napaka ima `status`).
 * Telesa napake ne beremo naprej: lahko nosi podrobnosti o naročnini.
 */
export async function sintetiziraj(env, poved, { fetchFn = fetch, signal } = {}) {
  const glas = env.ELEVENLABS_VOICE_ID || GLAS_PRIVZETO;
  const res = await fetchFn(`${API}/v1/text-to-speech/${encodeURIComponent(glas)}/with-timestamps?output_format=${FORMAT}`, {
    method: 'POST',
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      text: poved,
      model_id: env.ELEVENLABS_MODEL || MODEL_PRIVZETO,
      language_code: JEZIK,
      voice_settings: { stability: STABILNOST },
    }),
    signal,
  });
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* telo nas ne zanima */ }
    throw Object.assign(new Error('elevenlabs ' + res.status), { status: res.status });
  }
  const j = await res.json();
  const mp3 = brezOznak(izBase64(String(j?.audio_base64 ?? '')));
  if (mp3.length < 256) throw Object.assign(new Error('elevenlabs prazen zvok'), { status: 200 });
  const casi = besedeIzPoravnave(j.alignment);
  // Časi besed so za rabo zunaj Workerja; brez njih poved vseeno preberemo.
  const strosek = Number(res.headers.get('character-cost'));
  const krediti = Number.isFinite(strosek) && strosek > 0 ? strosek : Math.ceil(poved.length * KREDITI_NA_ZNAK);
  return { mp3, casi, krediti };
}

// ── stanje in poraba ───────────────────────────────────────────────────────

let stanjeMem = null; // { ob, vklop: boolean, shramba: boolean }

/** Stikalo iz D1, v izolatu velja 30 s. Brez tabel (shema še ni vnesena) je novi glas izklopljen. */
export async function beriStanje(env, zdaj = Date.now()) {
  if (stanjeMem && zdaj - stanjeMem.ob < STANJE_VELJA_MS) return stanjeMem;
  const db = env.SPREMLJANJE_DB;
  let vklop = false, shramba = false;
  if (db) {
    try {
      const { results } = await db.prepare('SELECT k, v FROM glas_stanje').all();
      shramba = true;
      vklop = !results.some(r => r.k === 'vklop' && r.v === 'off');
    } catch { /* tabel ni: pogon ostane izklopljen */ }
  }
  stanjeMem = { ob: zdaj, vklop, shramba };
  return stanjeMem;
}

/** Samo za preverbe: pozabi stanje iz izolata. */
export function pozabiStanje() { stanjeMem = null; }

/** Ali /tts bere z novim glasom: skrivnost je nastavljena, shramba obstaja, stikalo ni izklopljeno. */
export async function glasVklopljen(env) {
  if (!env.ELEVENLABS_API_KEY || !env.SPREMLJANJE_DB) return false;
  const s = await beriStanje(env);
  return s.shramba && s.vklop;
}

export function mejaKreditov(env) {
  const m = Number(env.GLAS_MEJA_KREDITOV);
  return Number.isFinite(m) && m >= 0 && String(env.GLAS_MEJA_KREDITOV ?? '').trim() !== '' ? m : MEJA_PRIVZETO;
}

async function poraba(db, mesec) {
  const [k, r] = await Promise.all([
    db.prepare('SELECT krediti FROM glas_poraba WHERE mesec = ?1').bind(mesec).first(),
    db.prepare('SELECT COALESCE(SUM(znaki), 0) AS znaki, COUNT(*) AS povedi FROM glas_povedi WHERE mesec = ?1').bind(mesec).first(),
  ]);
  return { krediti: Number(k?.krediti) || 0, znaki: Number(r?.znaki) || 0, povedi: Number(r?.povedi) || 0 };
}

// Mesečna meja je trda: krediti se rezervirajo PRED klicem na ElevenLabs, z enim
// stavkom, ki ga SQLite izvede nedeljivo. Branje vsote in poznejši zapis bi hkratnim
// klicem (ali komu, ki /tts kliče v zanki z različnimi besedili) pustila, da vsi
// vidijo isto staro vsoto in mejo skupaj presežejo. Stavek nič ne spremeni, kadar bi
// vsota presegla mejo (`changes` = 0).
const REZERVIRAJ = `INSERT INTO glas_poraba (mesec, krediti) VALUES (?1, ?2)
  ON CONFLICT(mesec) DO UPDATE SET krediti = krediti + ?2 WHERE krediti + ?2 <= ?3`;
// Po sintezi: razlika med rezervirano oceno in dejanskim stroškom ter vračilo za
// povedi, ki jih ElevenLabs zanesljivo ni zaračunal (glej `vrnjeno` v noviZvok).
const POPRAVI = 'UPDATE glas_poraba SET krediti = MAX(0, krediti + ?2) WHERE mesec = ?1';

async function rezerviraj(db, mesec, krediti, meja) {
  if (krediti > meja) return false;
  const r = await db.prepare(REZERVIRAJ).bind(mesec, krediti, meja).run();
  return Number(r?.meta?.changes) > 0;
}

const VSTAVI = `INSERT OR IGNORE INTO glas_povedi (kljuc, besedilo, glas, model, zvok, casi, znaki, krediti, mesec, ustvarjeno)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`;

/**
 * Besedilo enega klica /tts z novim glasom.
 *
 * Vrne { buf, povedi, novihPovedi, novihZnakov } ali { napaka, novihZnakov }, kadar
 * mora brati prejšnji glas: 'povedi' (prazno ali preveč povedi), 'meja' (mesečna
 * meja kreditov), 'elevenlabs' (napaka ali iztek). Mešanice glasov ni — če ena
 * poved ne uspe, bere prejšnji glas celo besedilo; kar je medtem uspelo, je
 * plačano in gre v shrambo za naslednjič. Nikoli ne vrže.
 */
export async function noviZvok(env, ctx, besedilo, { fetchFn = fetch, zdaj = Date.now, casMs = CAS_MS } = {}) {
  let novihZnakov = 0;
  try {
    const db = env.SPREMLJANJE_DB;
    const glas = env.ELEVENLABS_VOICE_ID || GLAS_PRIVZETO;
    const model = env.ELEVENLABS_MODEL || MODEL_PRIVZETO;
    const razpisano = vBesede(besedilo);
    if (razpisano.length > NAJVEC_ZNAKOV) return { napaka: 'povedi', novihZnakov };
    const deli = povedi(razpisano);
    if (!deli.length || deli.length > NAJVEC_POVEDI || deli.some(p => p.length > NAJVEC_ZNAKOV_POVEDI)) {
      return { napaka: 'povedi', novihZnakov };
    }
    const kljuci = await Promise.all(deli.map(p => kljucPovedi(glas, model, p)));

    const razlicni = [...new Set(kljuci)];
    const { results } = await db.prepare(
      `SELECT kljuc, zvok FROM glas_povedi WHERE kljuc IN (${razlicni.map((_, i) => '?' + (i + 1)).join(', ')})`,
    ).bind(...razlicni).all();
    // D1 vrne BLOB kot polje števil (ali ArrayBuffer); Uint8Array sprejme oboje.
    const zvoki = new Map(results.map(r => [r.kljuc, new Uint8Array(r.zvok)]));

    const manjka = [];
    kljuci.forEach((k, i) => { if (!zvoki.has(k) && !manjka.some(m => m.kljuc === k)) manjka.push({ kljuc: k, poved: deli[i] }); });

    let novihPovedi = 0;
    if (manjka.length) {
      const mesec = mesecLj(zdaj());
      const oceni = (poved) => Math.ceil(poved.length * KREDITI_NA_ZNAK);
      const ocena = manjka.reduce((a, m) => a + oceni(m.poved), 0);
      if (!(await rezerviraj(db, mesec, ocena, mejaKreditov(env)))) return { napaka: 'meja', novihZnakov };

      const ctl = new AbortController();
      const casovnik = setTimeout(() => ctl.abort(), casMs);
      const novi = [];
      // Kredite vrnemo samo za povedi, za katere VEMO, da niso bile zaračunane:
      // ElevenLabs jih je zavrnil s statusom napake ali pa sploh niso bile poslane.
      // Prekinjena ali iztekla zahteva je lahko vseeno zaračunana, zato njena
      // rezervacija ostane (sicer bi kdo z dolgimi povedmi trošil mimo meje).
      let vrnjeno = 0;
      let padlo = false;
      const vrsta = manjka.slice();
      const delavec = async () => {
        while (vrsta.length && !padlo) {
          const m = vrsta.shift();
          try {
            const r = await sintetiziraj(env, m.poved, { fetchFn, signal: ctl.signal });
            novi.push({ ...m, ...r });
          } catch (e) {
            if (!ctl.signal.aborted && typeof e?.status === 'number' && e.status >= 400) vrnjeno += oceni(m.poved);
            padlo = true;
            ctl.abort();
          }
        }
      };
      try {
        await Promise.all(Array.from({ length: Math.min(VZPOREDNO, manjka.length) }, delavec));
      } finally {
        clearTimeout(casovnik);
      }
      for (const m of vrsta) vrnjeno += oceni(m.poved);   // niso prišle na vrsto

      // Nove povedi v shrambo in popravek rezervacije na dejanski strošek, v enem
      // paketu. Če paket ne uspe, ostane rezervirana ocena — meja ostane na varni strani.
      const ustvarjeno = new Date(zdaj()).toISOString();
      const stavki = novi.map(n => db.prepare(VSTAVI).bind(
        n.kljuc, n.poved, glas, model,
        n.mp3.buffer.slice(n.mp3.byteOffset, n.mp3.byteOffset + n.mp3.byteLength),
        JSON.stringify(n.casi), n.poved.length, n.krediti, mesec, ustvarjeno,
      ));
      const popravek = novi.reduce((a, n) => a + n.krediti - oceni(n.poved), 0) - vrnjeno;
      if (popravek !== 0) stavki.push(db.prepare(POPRAVI).bind(mesec, popravek));
      if (stavki.length) {
        const zapis = db.batch(stavki).catch(e => { console.log('glas: zapis v shrambo ni uspel — ' + String(e?.message ?? e)); });
        if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(zapis); else await zapis;
      }
      for (const n of novi) { zvoki.set(n.kljuc, n.mp3); novihZnakov += n.poved.length; }
      novihPovedi = novi.length;
      if (padlo || novi.length < manjka.length) return { napaka: 'elevenlabs', novihZnakov };
    }

    const kosi = kljuci.map(k => brezGlaveInfo(zvoki.get(k)));
    const buf = new Uint8Array(kosi.reduce((a, k) => a + k.length, 0));
    let od = 0;
    for (const k of kosi) { buf.set(k, od); od += k.length; }
    return { buf: buf.buffer, povedi: deli.length, novihPovedi, novihZnakov };
  } catch (e) {
    console.log('glas: nepričakovana napaka — ' + String(e?.message ?? e));
    return { napaka: 'elevenlabs', novihZnakov };
  }
}

// ── GET/POST /glas ─────────────────────────────────────────────────────────

/**
 * Stikalo in poraba za zaslon Statistika. Zaščita kot /stat: znan Origin (preveri
 * usmerjevalnik), omejevalnik poskusov in glava x-stat-key.
 *
 *   GET  /glas                 → { vklopljen, kljuc, shramba, mesec, krediti, znaki, povedi, vsehPovedi, meja, glas, model }
 *   POST /glas  {"vklopljen": bool}  → isto, po spremembi
 */
export async function handleGlas(request, env, cors) {
  const json = (o, s) => new Response(JSON.stringify(o), {
    status: s,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
  if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env.STAT_KEY) return json({ error: 'STAT_KEY ni nastavljen' }, 503);
  if (await prevecPoskusov(env, request)) return json({ error: 'preveč zahtev' }, 429);
  if (!enakaKljuca(request.headers.get('x-stat-key') ?? '', env.STAT_KEY)) return json({ error: 'napacen kljuc' }, 401);

  const db = env.SPREMLJANJE_DB;
  if (!db) return json({ error: 'shramba ni nastavljena' }, 503);

  try {
    if (request.method === 'POST') {
      let telo = null;
      try { telo = await request.json(); } catch { /* spodaj */ }
      if (!telo || typeof telo.vklopljen !== 'boolean') return json({ error: 'pričakujem {"vklopljen": true|false}' }, 400);
      await db.prepare('INSERT INTO glas_stanje (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
        .bind('vklop', telo.vklopljen ? 'on' : 'off').run();
      pozabiStanje();
    }
    pozabiStanje();
    const stanje = await beriStanje(env);
    if (!stanje.shramba) return json({ error: 'tabel glas_* ni (worker/glas.sql)' }, 503);
    const mesec = mesecLj(Date.now());
    const p = await poraba(db, mesec);
    const vseh = await db.prepare('SELECT COUNT(*) AS n FROM glas_povedi').first();
    return json({
      vklopljen: stanje.vklop, kljuc: !!env.ELEVENLABS_API_KEY, shramba: true,
      mesec, krediti: Math.round(p.krediti), znaki: p.znaki, povedi: p.povedi, vsehPovedi: Number(vseh?.n) || 0,
      meja: mejaKreditov(env),
      glas: env.ELEVENLABS_VOICE_ID || GLAS_PRIVZETO, model: env.ELEVENLABS_MODEL || MODEL_PRIVZETO,
    }, 200);
  } catch (e) {
    return json({ error: 'shramba', detail: String(e?.message ?? e).slice(0, 120) }, 502);
  }
}
