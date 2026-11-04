/**
 * Žeton Sec-MS-GEC različice 2 za storitev »Preberi na glas« v Edgeu.
 *
 * Dobeseden prenos iz edge-tts 7.3.1 (edge_tts/drm.py, generate_sec_ms_gec_v2),
 * z BigInt, da se ujema s Pythonovimi neomejenimi celimi števili. Tabele so
 * prepisane iz te izdaje. Ko Microsoft protokol spet spremeni, je treba ta
 * modul ponovno ustvariti iz nove izdaje edge-tts (preverba: edge-gec.test.mjs).
 */

const M = 0xFFFFFFFFn;
const B = (a) => a.map(BigInt);
const SHA256_INITIAL = B([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const SHA256_STATE = B([0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x4bd35ab, 0xfeb0a7e4, 0x3effbd2]);
const SHA256_SCHEDULE = B([0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0xcfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0xe5ab33, 0xd258b060, 0x72766564]);
const SHA256_ROUND_CONSTANTS = B([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0xfc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x6ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const SHA256_BLOCK_CONSTANTS = B([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0xc9dc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0xfc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x6ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
const SHA256_ADJUSTMENT = 0xc9dc06a7n;
const SHA256_SIGMA0_ADJUSTMENT = 0x59c0b80n;
const SHA256_SIGMA1_ADJUSTMENT = 0xb92c0n;
const CS64_COEFFICIENTS = [[0xe82e91b1n, 0xb32700d0n], [0x44de24c6n, 0x88dff51dn], [0x3beb65bcn, 0x29514038n], [0xc89c5933n, 0xb328cbdfn], [0x8d1ec211n, 0xd405b4d5n], [0x314ef5d5n, 0x26e55f3cn], [0xe92491b1n, 0x607801c6n], [0xf0a5b9d5n, 0x82b2c1fbn], [0x6064cf3n, 0xfa51a3dan], [0xda79fa60n, 0x207cc464n], [0xbed20560n, 0x3c3c74f3n], [0x89f9c9f8n, 0xd2d14b61n], [0x35fa38c6n, 0xbb04a2c1n], [0xcb49e3c6n, 0xc5626167n]];
const CS64_FACTOR = 0x82893933n;
const CS64_ADJUSTMENT0 = 0xf2f90b1an;
const CS64_ADJUSTMENT1 = 0xb1a0000n;
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WIN_EPOCH = 11644473600n;

const rol16 = (v) => { v &= M; return ((v << 16n) | (v >> 16n)) & M; };
const sigma0 = (v) => ((v >> 7n) ^ (v << 25n) ^ (v >> 18n) ^ (v << 14n) ^ (v >> 3n)) & M;
const sigma1 = (v) => ((v >> 17n) ^ (v << 15n) ^ (v >> 19n) ^ (v << 13n) ^ (v >> 10n)) & M;
// Python `x & mask` da tudi pri negativnem x nenegativen ostanek; BigInt & enako
// (dvojiški komplement), zato zadošča navaden &.

function beWord(b, i) {
  return (BigInt(b[i]) << 24n) | (BigInt(b[i + 1]) << 16n) | (BigInt(b[i + 2]) << 8n) | BigInt(b[i + 3]);
}
function leWord(b, i) {
  return BigInt(b[i]) | (BigInt(b[i + 1]) << 8n) | (BigInt(b[i + 2]) << 16n) | (BigInt(b[i + 3]) << 24n);
}
function beInt(b) { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; }

function wordsLe4Even(data) {
  const pad = (4 - (data.length % 4)) % 4;
  const p = new Uint8Array(data.length + pad); p.set(data);
  if (!p.length) return [];
  const w = [];
  for (let i = 0; i < p.length; i += 4) w.push(leWord(p, i));
  if (w.length % 2) w.push(0n);
  return w;
}

// Enako kot prva zanka v _sha256_rounds (druga je le razvita oblika istega).
function sha256Rounds(state, words, firstRound = 0) {
  let [a, b, c, d, e, f, g, h] = state;
  const K = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i++) {
    const re = e * 0x100000001n, ra = a * 0x100000001n;
    const t1 = h + ((re >> 6n) ^ (re >> 11n) ^ (re >> 25n)) + (g ^ (e & (f ^ g))) + K[i] + words[i];
    const t2 = ((ra >> 2n) ^ (ra >> 13n) ^ (ra >> 22n)) + ((a & b) | (c & (a | b)));
    [a, b, c, d, e, f, g, h] = [(t1 + t2) & M, a, b, c, (d + t1) & M, e, f, g];
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words, first = 16) {
  for (let i = first; i < 64; i++) {
    const x = words[i - 2], y = words[i - 15];
    const s1 = (x >> 17n) ^ (x << 15n) ^ (x >> 19n) ^ (x << 13n) ^ (x >> 10n);
    const s0 = (y >> 7n) ^ (y << 25n) ^ (y >> 18n) ^ (y << 14n) ^ (y >> 3n);
    words.push((s1 + words[i - 7] + s0 + words[i - 16]) & M);
  }
}

function sha256Init(data) {
  const words = new Array(14).fill(0n);
  words.push(beInt(data.subarray(0, 3)));
  words.push(beInt(data.subarray(3, 7)));
  for (let i = 16; i < 30; i++) {
    let v = SHA256_SCHEDULE[i - 16];
    if (i - 2 >= 14) v += i === 16 ? (sigma1(words[i - 2]) ^ SHA256_SIGMA1_ADJUSTMENT) : sigma1(words[i - 2]);
    if (i - 7 >= 14) v += words[i - 7];
    if (i - 15 >= 14) v += i === 29 ? (sigma0(words[i - 15]) ^ SHA256_SIGMA0_ADJUSTMENT) : sigma0(words[i - 15]);
    words.push(v & M);
  }
  words.push((sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14]
    + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]) & M);
  expandSchedule(words, 31);
  const w = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, i) => (x + w[i]) & M);
}

function sha256Digest(data) {
  const length = 57 + data.length;
  const zeros = (((55 - length) % 64) + 64) % 64;
  const rest = data.subarray(7);
  const p = new Uint8Array(rest.length + 1 + zeros + 8);
  p.set(rest); p[rest.length] = 0x80;
  let bits = BigInt(length * 8);
  for (let i = p.length - 1; i >= p.length - 8; i--) { p[i] = Number(bits & 0xFFn); bits >>= 8n; }
  let state = sha256Init(data.subarray(0, 7));
  for (let off = 0; off < p.length; off += 64) {
    const words = [];
    for (let i = 0; i < 16; i++) words.push(beWord(p, off + i * 4));
    expandSchedule(words);
    const w = sha256Rounds(state, words);
    state = state.map((x, i) => (x + w[i]) & M);
  }
  const out = new Uint8Array(32);
  state.forEach((v, i) => {
    out[i * 4] = Number(v >> 24n); out[i * 4 + 1] = Number((v >> 16n) & 0xFFn);
    out[i * 4 + 2] = Number((v >> 8n) & 0xFFn); out[i * 4 + 3] = Number(v & 0xFFn);
  });
  return out;
}

function cs64Digest(data, digest) {
  const keyA = leWord(digest, 0) | 1n, keyB = leWord(digest, 4) | 1n;
  const factors = [(keyA * CS64_FACTOR) & M, (keyB * CS64_FACTOR) & M];
  const terms = CS64_COEFFICIENTS.map(([c], i) => (c * factors[i % 2]) & M);
  const offsets = CS64_COEFFICIENTS.map(([, o]) => o);
  const z = new Uint8Array(data.length + 1); z.set(data, 1);
  wordsLe4Even(z).forEach((word, i) => {
    let term = word * (i % 2 === 0 ? keyA : keyB);
    let offset = rol16(word) * (i % 2 === 0 ? 0xEF0569FBn : 0xC31713DBn);
    if (i === 0) { term += CS64_ADJUSTMENT0 * factors[0]; offset += CS64_ADJUSTMENT1; }
    terms.push(term & M); offsets.push(offset & M);
  });
  let swapAcc = 0n, swapLast = 0n, state = 0n, acc = 0n;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i], y = terms[i + 1];
    let t = rol16((offsets[i] + x) & M);
    let q = (t * 0x76F50F34n) & M;
    swapAcc += (rol16(q) * 0xC3EFEA97n + q) & M;
    t = rol16((offsets[i + 1] + y) & M);
    q = (t * 0x1881CE3Cn) & M;
    swapLast = (rol16(q) * 0x35BD1EC9n + q) & M;
    swapAcc = (swapAcc + swapLast) & M;
    state = (state * keyA + x) & M;
    state = (rol16(state) * 0xCF98B111n) & M;
    state = (rol16(state) * 0x87085B9Fn) & M;
    state = (rol16(state) * 0x12CEB96Dn) & M;
    state = (rol16(state) * 0x257E1D83n) & M;
    acc += state;
    t = (state * keyB + y) & M;
    t = (rol16(t) * 0xA27416F5n) & M;
    t = (rol16(t) * 0xD38396FFn) & M;
    state = (rol16((rol16(t) * 0x7C932B89n) & M) * 0xBFA49F69n) & M;
    acc = (acc + state) & M;
  }
  return [swapLast ^ state, swapAcc ^ acc];
}

const hexU = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
const leBytes = (v) => [0n, 8n, 16n, 24n].map((s) => Number((v >> s) & 0xFFn));

// Žeton se spremeni vsakih 5 minut; izračun z BigInt ni zastonj, zato ga hranimo.
let zadnji = { kos: -1n, zeton: '' };

/** @param {number} unixSek */
export function secMsGecV2(unixSek = Date.now() / 1000) {
  let s = BigInt(Math.floor(unixSek)) + WIN_EPOCH;
  s -= s % 300n;
  if (s === zadnji.kos) return zadnji.zeton;
  const data = new TextEncoder().encode(`${s * 10000000n}${TRUSTED_CLIENT_TOKEN}`);
  const digest = sha256Digest(data);
  const [w0, w1] = cs64Digest(data, digest);
  const zeton = `${hexU([...leBytes(w0), ...leBytes(w1)])}-${hexU(digest)}`;
  zadnji = { kos: s, zeton };
  return zeton;
}
