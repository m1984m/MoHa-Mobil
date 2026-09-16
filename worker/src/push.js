/**
 * MoHa Mobil — Web Push: šifriranje in pošiljanje potisnih obvestil.
 *
 * ── Od kod ta koda ──────────────────────────────────────────────────────────
 * Prenesena iz projekta Mateleni, kjer je bila v Node preverjena proti pravim
 * VAPID ključem in v živo proti Firefoxu, Chromu in Safariju:
 *   D:\Claude\projekti\Mateleni\spike\site\functions\api\send-test.js  (izvirnik, čisti JS)
 *   D:\Claude\projekti\Mateleni\app\src\lib\server\webpush.ts          (kasnejši prenos v TS)
 * Tu so preimenovane funkcije (`sendWebPush` → `sendPush`), podpis sprejme
 * objekt namesto besedila, komentarji so v slovenščini.
 *
 * ── Zakaj ne npm paket `web-push` ───────────────────────────────────────────
 * Paket `web-push` stoji na `node:crypto` ECDH in odjemalcu `node:https`; oboje
 * v izvajalnem okolju Workerjev ne deluje zanesljivo (glej web-push-libs/web-push,
 * težava #718). Ta Worker tudi namerno nima bundlerja in node_modules. Šifriranje
 * je zato napisano neposredno na WebCrypto po specifikacijah:
 *   RFC 8291 — Message Encryption for Web Push (dogovor o ključu ECDH),
 *   RFC 8188 — aes128gcm, šifrirano kodiranje vsebine HTTP,
 *   RFC 8292 — VAPID (avtorizacija s podpisanim žetonom JWT, ES256).
 *
 * Ključa VAPID v tej datoteki NI. Javni pride iz `env.VAPID_PUBLIC` (spremenljivka
 * v wrangler.toml, javna je po definiciji), zasebni iz `env.VAPID_PRIVATE`
 * (skrivnost, `npx wrangler secret put VAPID_PRIVATE`).
 */

const te = new TextEncoder();

// ── Pretvorbe bajtov ─────────────────────────────────────────────────────────

/** base64url (brez obrobnih `=`) → bajti. */
export function b64urlToBytes(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

/** Bajti → base64url brez obrobnih `=`. */
export function bytesToB64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * HKDF po RFC 5869. WebCrypto opravi extract in expand v enem klicu deriveBits,
 * zato tu ni ročnega HMAC koraka.
 */
async function hkdf(saltBytes, ikmBytes, infoBytes, bits) {
  const key = await crypto.subtle.importKey('raw', ikmBytes, 'HKDF', false, ['deriveBits']);
  const out = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes }, key, bits);
  return new Uint8Array(out);
}

// ── RFC 8292: glava Authorization (VAPID) ────────────────────────────────────

/**
 * Sestavi glavo `vapid t=<JWT>, k=<javni ključ>` za en izvor potisne storitve.
 *
 * `env.VAPID_PUBLIC`  = base64url, nestisnjena točka P-256, 65 B (0x04 ‖ x ‖ y)
 * `env.VAPID_PRIVATE` = base64url, surov 32-bajtni zasebni skalar `d`
 * (to je zapis, ki ga izpiše `web-push generate-vapid-keys`; glej secrets/vapid.json).
 *
 * Ključ uvozimo kot JWK, ker WebCrypto zasebnega skalarja P-256 v surovi obliki
 * ne zna uvoziti — x in y izluščimo iz javne točke.
 */
export async function vapidAuthHeader(env, endpointOrigin) {
  const pub = b64urlToBytes(env.VAPID_PUBLIC);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC ni 65-bajtna nestisnjena točka P-256');
  }
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE,
  };
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const header = bytesToB64url(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(te.encode(JSON.stringify({
    aud: endpointOrigin,                             // občinstvo = izvor potisne storitve
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,  // 12 h (največ dovoljeno je 24 h)
    sub: env.VAPID_SUBJECT || 'mailto:moha-mobil@localhost',
  })));
  const signingInput = header + '.' + claims;

  // WebCrypto ECDSA P-256 vrne podpis že v surovi obliki r‖s (64 B) — to je
  // natanko zapis JWS ES256, pretvorbe iz DER ni treba.
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(signingInput)));

  return 'vapid t=' + signingInput + '.' + bytesToB64url(sig) + ', k=' + env.VAPID_PUBLIC;
}

// ── RFC 8291 + RFC 8188: en zapis aes128gcm ──────────────────────────────────

/**
 * Zašifrira besedilo za točno to naročnino. Vrne celotno telo zahteve
 * (glava kodiranja + šifropis), pripravljeno za POST na endpoint.
 */
export async function encryptPayload(subscription, payloadText) {
  const uaPub = b64urlToBytes(subscription.keys.p256dh);    // javni ključ brskalnika, 65 B
  const authSecret = b64urlToBytes(subscription.keys.auth); // 16-bajtna skrivnost naročnine

  // 1) Za vsako sporočilo nov par ECDH na strani strežnika (zahteva RFC 8291).
  const asKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  // 2) RFC 8291 §3.3–3.4:
  //    IKM = HKDF(sol = auth_secret, ikm = skupna skrivnost ECDH,
  //               info = "WebPush: info" ‖ 0x00 ‖ javni_brskalnika ‖ javni_strežnika)
  const ikm = await hkdf(
    authSecret, ecdh,
    concatBytes(te.encode('WebPush: info\0'), uaPub, asPub),
    256);

  // 3) RFC 8188 §2.2–2.3: naključna 16-bajtna sol → ključ vsebine (16 B) in nonce (12 B).
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 96);

  // 4) En sam (končni) zapis: čistopis ‖ 0x02, AES-128-GCM, brez AAD.
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const record = concatBytes(te.encode(payloadText), new Uint8Array([2]));
  const ctBody = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, aesKey, record));

  // 5) Glava kodiranja po RFC 8188 §2.1:
  //    sol(16) ‖ velikost zapisa(4, big-endian) ‖ dolžina keyid(1) ‖ keyid(= javni strežnika, 65)
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  header.set(asPub, 21);
  return concatBytes(header, ctBody);
}

// ── Pošiljanje ───────────────────────────────────────────────────────────────

/**
 * Pošlje eno potisno obvestilo.
 *
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription
 * @param {object} payloadObj  Objekt, ki ga service worker dobi kot JSON.
 * @param {object} env         Okolje Workerja (VAPID_PUBLIC, VAPID_PRIVATE, VAPID_SUBJECT).
 * @param {number} ttl         Koliko sekund naj potisna storitev čaka na napravo.
 * @returns {Promise<{ok: boolean, status: number}>}
 *          `status` 0 pomeni, da zahteva sploh ni odšla (kripto ali omrežna napaka).
 *          `status` 404 ali 410 pomeni, da je naročnina mrtva — kličoči jo mora izbrisati.
 */
export async function sendPush(subscription, payloadObj, env, ttl = 600) {
  if (!env || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return { ok: false, status: 0 };

  let body, origin;
  try {
    body = await encryptPayload(subscription, JSON.stringify(payloadObj));
    origin = new URL(subscription.endpoint).origin;
  } catch {
    return { ok: false, status: 0 };
  }

  try {
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': await vapidAuthHeader(env, origin),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(ttl),
        'Urgency': 'high',
      },
      body,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
