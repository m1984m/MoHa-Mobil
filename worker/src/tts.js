/**
 * Glasno branje z nevronskim glasom — POST /tts
 *
 * Aplikacija je brala s sistemskim glasom telefona (Web Speech). Ta je za
 * slovenščino robotski, marsikje pa ga sploh ni. Zato Worker besedilo pošlje
 * Azure Speech (glas sl-SI-PetraNeural) in vrne MP3. Ključ je skrivnost
 * Workerja in v javni paket ne pride.
 *
 *   POST /tts   telo: navadno besedilo (text/plain, UTF-8) → audio/mpeg
 *
 * Telo je navadno besedilo namenoma: tak klic je za brskalnik »preprost« in ne
 * sproži predhodne zahteve OPTIONS, zato branje začne prej.
 *
 * Kvota: vir je Azure na brezplačni ravni F0, ki ima trdo mejo (0,5 M znakov na
 * mesec) in ne zaračuna ničesar. Ko je porabljena, Azure klic zavrne, aplikacija
 * pa prebere s sistemskim glasom. Stroška torej ni, je pa kvota skupna vsem:
 * kdor bi z glavo Origin v zanki pošiljal različna besedila, bi jo porabil v
 * dobri uri in Petra bi do konca meseca utihnila za vse. Zato meja dolžine in
 * omejevalnik na naslov IP (vezava TTS_LIMITER, brez pisanja v KV — to ima
 * svojo dnevno mejo, glej alarmRateLimited).
 */

import { recordUpstream } from './analytics.js';

const VOICE = 'sl-SI-PetraNeural';
// Enako kot `rate = 0.9` pri sistemskem glasu: bere se med hojo ali na postaji.
const RATE = '-10%';
const FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

// Najdaljše branje v aplikaciji je šest odhodov z enega postajališča, okoli
// 550 znakov. Daljše besedilo aplikacija prebere s sistemskim glasom.
const MAX_CHARS = 800;
// Azure F0 sintetizira ~1 s na 100 znakov (izmerjeno 25.09.2026: 267 znakov 3,1 s,
// 500 znakov čez 4,5 s — prejšnja meja 4,5 s je prekinila vsak daljši kos). Krajše
// od čakanja v aplikaciji (12 s): odjemalec mora dobiti naš odgovor, sicer odneha
// prej in Azure posnetek vseeno zaračuna v kvoto.
const TIMEOUT_MS = 10000;
// Vsako branje se začne s "Postajališče …" in ima več deset kB. Manjši 200 je
// pokvarjen odgovor in ne sme v predpomnilnik, kjer bi ležal 24 ur.
const MIN_BYTES = 1024;
// Isto besedilo da vedno isti posnetek, zato sme ležati dolgo.
const CACHE_S = 86400;

// Zavora v izolatu, kot pri /ev: ni jamstvo (izolatov je več), ustavi pa en
// odjemalec, ki bi v zanki klical isti izolat.
const NA_MINUTO = 30;
let okno = { min: 0, n: 0 };

function dovoljeno(zdaj = Date.now()) {
  const min = Math.floor(zdaj / 60000);
  if (min !== okno.min) okno = { min, n: 0 };
  if (okno.n >= NA_MINUTO) return false;
  okno.n++;
  return true;
}

// Na naslov IP (vezava TTS_LIMITER v wrangler.toml, 20 na 60 s). Človek na
// postaji prebere nekajkrat na minuto; zadetki v predpomnilniku se ne štejejo.
// Brez vezave (npr. lokalni razvoj) omejevalnika ni; napaka omejevalnika klica
// ne zavrne — varovalo ne sme ugasniti branja.
async function omejevalnik(env, request) {
  if (!env.TTS_LIMITER) return true;
  try {
    const { success } = await env.TTS_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'neznan' });
    return success;
  } catch {
    return true;
  }
}

export function xmlEscape(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
}

// Nadzorni znaki v SSML niso dovoljeni (XML 1.0) in Azure bi zahtevo zavrnil.
export function ocistiBesedilo(raw) {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function ssml(text) {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="sl-SI">`
    + `<voice name="${VOICE}"><prosody rate="${RATE}">${xmlEscape(text)}</prosody></voice></speak>`;
}

async function kljuc(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${VOICE}|${RATE}|${FORMAT}|${text}`));
  const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return new Request(`https://tts.moha-mobil.cache/${hex}`);
}

function napaka(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors },
  });
}

export async function handleTts(request, env, ctx, cors) {
  if (request.method !== 'POST') return napaka({ error: 'method not allowed' }, 405, cors);
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) {
    return napaka({ error: 'tts ni nastavljen' }, 503, cors);
  }

  const dolzina = Number(request.headers.get('Content-Length') ?? 0);
  if (dolzina > MAX_CHARS * 4) return napaka({ error: 'body too large' }, 413, cors);
  const text = ocistiBesedilo(await request.text());
  if (!text) return napaka({ error: 'prazno besedilo' }, 400, cors);
  if (text.length > MAX_CHARS) return napaka({ error: 'besedilo predolgo' }, 413, cors);

  const zacetek = Date.now();
  const drzava = (request.cf && request.cf.country) || '';
  const stej = (izid, status) => recordUpstream(env, {
    storitev: 'tts', metoda: 'petra', izid, status, preko: 'direct', drzava, ms: Date.now() - zacetek,
  });

  const zvok = (body, oznaka) => new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Proxy-Cache': oznaka, ...cors },
  });

  const cache = caches.default;
  const cacheKey = await kljuc(text);
  const hit = await cache.match(cacheKey);
  if (hit) {
    stej('cache', 200);
    return zvok(hit.body, 'HIT');
  }

  if (!dovoljeno() || !(await omejevalnik(env, request))) {
    stej('zavora', 429);
    return napaka({ error: 'preveč zahtev' }, 429, cors);
  }

  let res;
  try {
    res = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': FORMAT,
        'User-Agent': 'moha-mobil-proxy',
      },
      body: ssml(text),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    stej('nedosegljiv', 502);
    return napaka({ error: 'upstream unreachable', detail: String(e?.name ?? e) }, 502, cors);
  }

  if (!res.ok) {
    stej('napaka', res.status);
    // 401/403 (napačen ključ ali regija, porabljena kvota) se ne popravi sam:
    // 503 aplikaciji pove, naj Petre do konca seje ne kliče več. 429 je
    // prehoden, vse drugo 502. Telo Azure ne gre naprej, ker lahko nosi
    // podrobnosti o naročnini.
    const status = res.status === 401 || res.status === 403 ? 503 : res.status === 429 ? 429 : 502;
    return napaka({ error: 'tts', status: res.status }, status, cors);
  }

  // Meja časa velja tudi za branje telesa: prekinitev tu vrže in brez tega bi
  // Worker odgovoril s 500 (izjema) namesto z urejeno napako.
  let buf;
  try {
    buf = await res.arrayBuffer();
  } catch (e) {
    stej('nedosegljiv', 504);
    return napaka({ error: 'upstream timeout', detail: String(e?.name ?? e) }, 504, cors);
  }
  if (buf.byteLength < MIN_BYTES || !(res.headers.get('Content-Type') ?? '').startsWith('audio/')) {
    stej('napaka', 200);
    return napaka({ error: 'tts', status: 200 }, 502, cors);
  }
  stej('ok', 200);
  ctx.waitUntil(cache.put(cacheKey, new Response(buf.slice(0), {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': `public, max-age=${CACHE_S}` },
  })));
  return zvok(buf, 'MISS');
}
