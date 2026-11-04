/**
 * Sinteza govora prek storitve »Preberi na glas« brskalnika Microsoft Edge
 * (isti glasovi kot Azure, tudi sl-SI-PetraNeural), brez ključa.
 *
 * To ni uradna storitev: protokol je povzet po knjižnici edge-tts
 * (github.com/rany2/edge-tts, constants.py + drm.py + communicate.py, 7.x).
 * Microsoft ga občasno spremeni (najpogosteje zahtevano različico brskalnika v
 * CHROMIUM_FULL_VERSION ali žeton Sec-MS-GEC). Tedaj klic pade, aplikacija pa
 * prebere s sistemskim glasom — popravek je posodobitev konstant spodaj po
 * zadnji izdaji edge-tts.
 *
 * Potek: WebSocket → sporočilo speech.config → sporočilo ssml → binarni kosi
 * z glavo Path:audio (MP3) → besedilno sporočilo Path:turn.end.
 */

import { secMsGecV2 } from './edge-gec.js';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
// 800 znakov je ~60 s govora ≈ 360 kB; več je okvara ali zloraba.
const MAX_BYTES = 2 * 1024 * 1024;
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split('.')[0];
const WSS_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

function hex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function nakljucniHex(n) {
  return hex(crypto.getRandomValues(new Uint8Array(n)));
}

function datum() {
  // JavaScriptova oblika datuma, kot jo pošilja Edge.
  return new Date().toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) /, '$1 $3 $2 $4 ')
    .replace('GMT', 'GMT+0000 (Coordinated Universal Time)');
}

/**
 * @param {string} ssml  celoten <speak> dokument
 * @param {{format:string, timeoutMs:number}} o
 * @returns {Promise<ArrayBuffer>} MP3
 */
export async function edgeSynth(ssml, { format, timeoutMs }) {
  const url = `${WSS_URL}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
    + `&ConnectionId=${nakljucniHex(16)}`
    + `&Sec-MS-GEC=${secMsGecV2()}`
    + `&Sec-MS-GEC-Version=2-${CHROMIUM_FULL_VERSION}`;

  const res = await fetch(url, {
    headers: {
      Upgrade: 'websocket',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: `muid=${nakljucniHex(16).toUpperCase()};`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ws = res.webSocket;
  if (!ws) {
    const e = new Error(`edge: ni WebSocket (HTTP ${res.status})`);
    e.status = res.status;
    throw e;
  }
  ws.accept();

  return await new Promise((resolve, reject) => {
    const kosi = [];
    let skupaj = 0;
    let konec = false;
    const zakljuci = (napaka) => {
      if (konec) return;
      konec = true;
      clearTimeout(ura);
      try { ws.close(1000, 'konec'); } catch { /* že zaprt */ }
      if (napaka) return reject(napaka);
      const out = new Uint8Array(skupaj);
      let i = 0;
      for (const k of kosi) { out.set(k, i); i += k.length; }
      resolve(out.buffer);
    };
    const ura = setTimeout(() => zakljuci(Object.assign(new Error('edge: časovna meja'), { name: 'TimeoutError' })), timeoutMs);

    // Binarni kosi pridejo kot ArrayBuffer ali Blob (lokalni workerd). Blob se bere
    // asinhrono, zato gre vse skozi verigo obljub: turn.end se obdela šele, ko so
    // prebrani vsi kosi pred njim, vrstni red zvoka pa ostane pravilen.
    let veriga = Promise.resolve();
    ws.addEventListener('message', (ev) => {
      const d = ev.data;
      veriga = veriga.then(async () => {
        if (konec) return;
        if (typeof d === 'string') {
          if (d.includes('Path:turn.end')) zakljuci(kosi.length ? null : new Error('edge: brez zvoka'));
          return;
        }
        const b = new Uint8Array(d instanceof ArrayBuffer ? d : await d.arrayBuffer());
        if (b.length < 2) return;
        const dolzGlave = (b[0] << 8) | b[1];
        const glava = new TextDecoder().decode(b.subarray(2, 2 + dolzGlave));
        if (!glava.includes('Path:audio')) return;
        const zvok = b.subarray(2 + dolzGlave);
        if (zvok.length) { kosi.push(zvok); skupaj += zvok.length; }
        if (skupaj > MAX_BYTES) zakljuci(new Error('edge: odgovor prevelik'));
      }).catch((e) => zakljuci(e));
    });
    ws.addEventListener('close', () => { veriga = veriga.then(() => zakljuci(kosi.length ? null : new Error('edge: povezava zaprta'))); });
    ws.addEventListener('error', () => zakljuci(new Error('edge: napaka WebSocket')));

    const ts = datum();
    ws.send(
      `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n`
      + '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
      + `"outputFormat":"${format}"}}}}\r\n`,
    );
    ws.send(
      `X-RequestId:${nakljucniHex(16)}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`,
    );
  });
}
