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
import { edgeSynth } from './edge.js';
import { glasVklopljen, noviZvok, GLAS_PRIVZETO, MODEL_PRIVZETO } from './glas.js';

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

// Pozdrav na začetku (ga doda aplikacija): Petra nima sloga "prijazno" (mstts:express-as
// ga pri sl-SI ne pozna), zato ga oblikujemo sami — počasneje in s kratkim premorom,
// preden začne brati odhode (Matej: "bolj prijazen", "ne rabi biti višji").
const POZDRAV = /^(Dobro jutro|Dober dan|Dober večer|Zdravo|Hej|Good morning|Hello|Good evening|Hi|Hey)!\s*/;

export function ssml(text) {
  const m = text.match(POZDRAV);
  const glava = m
    ? `<prosody rate="-15%">${xmlEscape(m[1])}!</prosody><break time="300ms"/>`
    : '';
  const telo = m ? text.slice(m[0].length) : text;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="sl-SI">`
    + `<voice name="${VOICE}">${glava}<prosody rate="${RATE}">${xmlEscape(telo)}</prosody></voice></speak>`;
}

// Edge sprejme omejen SSML (en <voice>, en <prosody>); pozdrav dobi samo piko.
export function ssmlEdge(text) {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='sl-SI'>`
    + `<voice name='${VOICE}'><prosody pitch='+0Hz' rate='${RATE}' volume='+0%'>${xmlEscape(text)}</prosody></voice></speak>`;
}

// `novi`: oznaka novega glasu in modela, kadar bere on. Posnetka obeh glasov
// imata ločena ključa, da stikalo v /glas velja takoj in ne šele čez 24 ur.
async function kljuc(text, novi = '') {
  const glas = novi ? `eleven|${novi}` : `${VOICE}|${RATE}|${FORMAT}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${glas}|${text}`));
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
  // Najprej Azure (uradni ključ), ob kakršni koli napaki Azure samodejno Edge (brez ključa).
  // TTS_ENGINE = "edge" Azure izklopi.
  const azure = env.TTS_ENGINE !== 'edge' && env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION;

  const dolzina = Number(request.headers.get('Content-Length') ?? 0);
  if (dolzina > MAX_CHARS * 4) return napaka({ error: 'body too large' }, 413, cors);
  const text = ocistiBesedilo(await request.text());
  if (!text) return napaka({ error: 'prazno besedilo' }, 400, cors);
  if (text.length > MAX_CHARS) return napaka({ error: 'besedilo predolgo' }, 413, cors);

  const zacetek = Date.now();
  const drzava = (request.cf && request.cf.country) || '';
  // `znaki` samo, kadar je Azure odgovoril z zvokom (tedaj šteje v kvoto) — ne pri
  // zadetku v predpomnilniku ali zavrnitvi.
  let metoda = azure ? 'petra' : 'edge';
  const stej = (izid, status, znaki = 0) => recordUpstream(env, {
    storitev: 'tts', metoda, izid, status, preko: 'direct', drzava, ms: Date.now() - zacetek, znaki,
  });

  const zvok = (body, oznaka) => new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Proxy-Cache': oznaka, ...cors },
  });

  // Novi glas (ElevenLabs, glas.js): kadar je nastavljen in vklopljen, bere on;
  // ob napaki, izteku ali doseženi mesečni meji kreditov bere prejšnji glas.
  const novi = await glasVklopljen(env).catch(() => false);
  if (novi) metoda = 'eleven';

  const cache = caches.default;
  const cacheKey = await kljuc(text, novi ? `${env.ELEVENLABS_VOICE_ID || GLAS_PRIVZETO}|${env.ELEVENLABS_MODEL || MODEL_PRIVZETO}` : '');
  const hit = await cache.match(cacheKey);
  if (hit) {
    stej('cache', 200);
    return zvok(hit.body, 'HIT');
  }

  // Najprej omejevalnik na naslov IP, šele nato zavora v izolatu. V obratnem
  // vrstnem redu je zavrnjen klic že porabil števec izolata: en naslov s 30
  // novimi besedili na minuto je Petro utišal vsem, ki jih streže isti izolat.
  if (!(await omejevalnik(env, request)) || !dovoljeno()) {
    stej('zavora', 429);
    return napaka({ error: 'preveč zahtev' }, 429, cors);
  }

  if (novi) {
    const r = await noviZvok(env, ctx, text);
    if (r.buf && r.buf.byteLength >= MIN_BYTES) {
      // `znaki` so samo novi znaki, ki jih je ElevenLabs zaračunal; povedi iz
      // shrambe so zastonj. Branje brez ene nove povedi šteje kot zadetek.
      stej(r.novihPovedi ? 'ok' : 'cache', 200, r.novihZnakov);
      ctx.waitUntil(cache.put(cacheKey, new Response(r.buf.slice(0), {
        headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': `public, max-age=${CACHE_S}` },
      })));
      return zvok(r.buf, r.novihPovedi ? 'MISS' : 'HIT-SHRAMBA');
    }
    // 'meja' = mesečna meja kreditov, 'povedi' = besedilo ni za novi glas, 'napaka' = ElevenLabs.
    stej(r.napaka === 'meja' || r.napaka === 'povedi' ? r.napaka : 'napaka', 502, r.novihZnakov ?? 0);
    // Prejšnji glas ima svoj ključ predpomnilnika. Brez tega pogleda bi ob doseženi
    // meji vsako branje do konca meseca znova klicalo Azure in Edge.
    metoda = 'edge';
    const prej = await cache.match(await kljuc(text));
    if (prej) {
      stej('cache', 200);
      return zvok(prej.body, 'HIT');
    }
  }

  // Aplikacija čaka 12 s (speech.ts). Če je novi glas pred tem porabil svoj čas, dobi prejšnji
  // glas samo ostanek, da odgovor pride prej, kot aplikacija odneha in bere glas telefona.
  const preostane = () => Math.min(TIMEOUT_MS, Math.max(3000, 11000 - (Date.now() - zacetek)));

  // Azure: vrne zvok ali null (napaka se zabeleži, nato poskusi Edge).
  metoda = 'edge';
  let buf = null;
  if (azure) {
    try {
      const res = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': FORMAT,
          'User-Agent': 'moha-mobil-proxy',
        },
        body: ssml(text),
        signal: AbortSignal.timeout(preostane()),
      });
      if (res.ok && (res.headers.get('Content-Type') ?? '').startsWith('audio/')) {
        const b = await res.arrayBuffer();
        if (b.byteLength >= MIN_BYTES) { buf = b; metoda = 'petra'; }
        else recordUpstream(env, { storitev: 'tts', metoda: 'petra', izid: 'napaka', status: 200, preko: 'direct', drzava, ms: Date.now() - zacetek, znaki: text.length });
      } else {
        // Telo Azure ne gre naprej (lahko nosi podrobnosti o naročnini); samo status v statistiko.
        recordUpstream(env, { storitev: 'tts', metoda: 'petra', izid: 'napaka', status: res.status, preko: 'direct', drzava, ms: Date.now() - zacetek, znaki: 0 });
      }
    } catch (e) {
      recordUpstream(env, { storitev: 'tts', metoda: 'petra', izid: 'nedosegljiv', status: 502, preko: 'direct', drzava, ms: Date.now() - zacetek, znaki: 0 });
    }
  }
  if (!buf) {
    try {
      buf = await edgeSynth(ssmlEdge(text), { format: FORMAT, timeoutMs: preostane() });
    } catch (e) {
      stej(e?.name === 'TimeoutError' ? 'nedosegljiv' : 'napaka', e?.status ?? 502);
      return napaka({ error: 'tts', detail: String(e?.message ?? e).slice(0, 120) }, 502, cors);
    }
    if (buf.byteLength < MIN_BYTES) {
      stej('napaka', 200);
      return napaka({ error: 'tts', status: 200 }, 502, cors);
    }
  }
  stej('ok', 200, text.length);
  // Kadar je novi glas vklopljen, a je tokrat bral prejšnji glas (iztek, meja, napaka), gre
  // posnetek pod ključ prejšnjega glasu. Pod njegovim bi isto besedilo še 24 ur vračalo
  // prejšnji glas, čeprav so povedi medtem že plačane in v shrambi.
  const kljucZapisa = novi ? await kljuc(text) : cacheKey;
  ctx.waitUntil(cache.put(kljucZapisa, new Response(buf.slice(0), {
    headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': `public, max-age=${CACHE_S}` },
  })));
  return zvok(buf, 'MISS');
}
