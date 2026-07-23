#!/usr/bin/env node
// Potegne svež GTFS iz Marproma v jpp_maribor/gtfs_raw/ in opozori pred potekom.
//
// Uporaba:
//   node scripts/fetch-gtfs.mjs           prenesi + namesti (če je feed drugačen) + preveri poteke
//   node scripts/fetch-gtfs.mjs --check   samo preveri lokalni feed, brez prenosa
//   node scripts/fetch-gtfs.mjs --force   prepiši tudi, če je feed identičen
//
// Po namestitvi je treba pognati `node scripts/build-gtfs.mjs`, da se regenerira
// web/public/gtfs/*.json (ta skripta surovih .txt namenoma ne prevaja sama).
//
// POZOR na past poletnih/šolskih voznih redov: feed_end_date v feed_info.txt zna biti
// 31.12., delovni servis v calendar.txt pa se konča že 31.8. Zato preverjamo poteke
// PO DNEVIH V TEDNU, ne le globalnega konca feeda.

import { readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';

const GTFS_URL = 'https://vozniredi.marprom.si/gtfs/gtfs.zip';
const WARN_DAYS = 14; // koliko dni pred potekom začnemo opozarjati

const here = dirname(fileURLToPath(import.meta.url));
const RAW = resolve(here, '../../../jpp_maribor/gtfs_raw'); // isti vir kot build-gtfs.mjs
const DAYS = ['pon', 'tor', 'sre', 'čet', 'pet', 'sob', 'ned'];

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check') || args.includes('-c');
const FORCE = args.includes('--force');

// --- minimalni ZIP reader (brez odvisnosti; ZIP64 ni podprt — GTFS je ~0,5 MB) ---
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: End of Central Directory ni najden');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);

  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('ZIP: pokvarjen central directory');
    const method    = buf.readUInt16LE(off + 10);
    const compSize  = buf.readUInt32LE(off + 20);
    const nameLen   = buf.readUInt16LE(off + 28);
    const extraLen  = buf.readUInt16LE(off + 30);
    const commLen   = buf.readUInt16LE(off + 32);
    const localOff  = buf.readUInt32LE(off + 42);
    const name      = buf.toString('utf8', off + 46, off + 46 + nameLen);

    // Local header ima svoje dolžine name/extra — ne smejo se predpostaviti enake kot v CD.
    const lNameLen  = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOff   = localOff + 30 + lNameLen + lExtraLen;
    const raw       = buf.subarray(dataOff, dataOff + compSize);

    if (!name.endsWith('/')) {
      if (method !== 0 && method !== 8) throw new Error(`ZIP: nepodprta kompresija ${method} (${name})`);
      files.set(basename(name), method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    }
    off += 46 + nameLen + extraLen + commLen;
  }
  return files;
}

// --- CSV (enak minimalni parser kot build-gtfs.mjs, le da bere iz stringa) ---
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let i = 0, field = '', row = [], inQuote = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQuote = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, idx) => [h, r[idx]])));
}

const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const fmt = (ymd) => `${ymd.slice(6, 8)}.${ymd.slice(4, 6)}.${ymd.slice(0, 4)}`;
const daysUntil = (ymd) => {
  const p = (s) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return Math.round((p(ymd) - p(todayYmd())) / 86400000);
};

// Vrne { feed: {start,end}, perDay: [{day, end, days}] } — perDay je zadnji datum,
// do katerega je za posamezen dan v tednu sploh na voljo kakšen servis.
function analyze(texts) {
  const feed = texts['feed_info.txt'] ? parseCSV(texts['feed_info.txt'])[0] : null;
  const cal = texts['calendar.txt'] ? parseCSV(texts['calendar.txt']) : [];
  const cols = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  const perDay = cols.map((col, idx) => {
    const ends = cal.filter(c => c[col] === '1').map(c => c.end_date).filter(Boolean);
    const end = ends.length ? ends.sort().at(-1) : null;
    return { day: DAYS[idx], end, days: end ? daysUntil(end) : null };
  });

  return {
    feedStart: feed?.feed_start_date || null,
    feedEnd: feed?.feed_end_date || null,
    version: feed?.feed_version || null,
    services: cal.length,
    perDay,
  };
}

function report(label, info) {
  console.log(`\n[fetch-gtfs] ${label}`);
  if (info.feedStart && info.feedEnd) {
    console.log(`  feed_info:  ${fmt(info.feedStart)} – ${fmt(info.feedEnd)}  (${info.services} servisov)`);
  } else {
    console.log(`  feed_info:  ni podatka`);
  }

  let worst = 0; // 0 = ok, 1 = opozorilo, 2 = poteklo
  for (const d of info.perDay) {
    if (d.end === null) {
      console.log(`  ${d.day}:  ✗ ni nobenega servisa`);
      worst = Math.max(worst, 2);
      continue;
    }
    if (d.days < 0)            { console.log(`  ${d.day}:  ✗ POTEKLO ${fmt(d.end)} (pred ${-d.days} dnevi)`); worst = Math.max(worst, 2); }
    else if (d.days <= WARN_DAYS) { console.log(`  ${d.day}:  ! poteče ${fmt(d.end)} (čez ${d.days} dni)`);   worst = Math.max(worst, 1); }
    else                       { console.log(`  ${d.day}:  ✓ do ${fmt(d.end)} (${d.days} dni)`); }
  }
  return worst;
}

async function readLocal() {
  if (!existsSync(RAW)) return null;
  const out = {};
  for (const f of await readdir(RAW)) {
    if (f.endsWith('.txt')) out[f] = await readFile(resolve(RAW, f), 'utf8');
  }
  return Object.keys(out).length ? out : null;
}

// --- main ---
const local = await readLocal();

if (CHECK_ONLY) {
  if (!local) { console.error(`[fetch-gtfs] ✗ lokalnega feeda ni v ${RAW}`); process.exit(1); }
  const level = report(`lokalni feed (${RAW})`, analyze(local));
  if (level === 2) console.log(`\n  → vozni redi so POTEKLI: poženi \`node scripts/fetch-gtfs.mjs\``);
  else if (level === 1) console.log(`\n  → poteče kmalu: preveri, ali je Marprom objavil nov feed`);
  process.exit(0);
}

console.log(`[fetch-gtfs] prenašam ${GTFS_URL} ...`);
let zip;
try {
  const res = await fetch(GTFS_URL, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  zip = Buffer.from(await res.arrayBuffer());
} catch (e) {
  console.error(`[fetch-gtfs] ✗ prenos ni uspel: ${e.message}`);
  if (local) {
    console.error(`[fetch-gtfs] preverjam stanje obstoječega feeda:`);
    report(`lokalni feed (${RAW})`, analyze(local));
  }
  process.exit(1);
}
console.log(`  prejeto ${(zip.length / 1024).toFixed(1)} kB`);

const entries = unzip(zip);
const fresh = {};
for (const [name, buf] of entries) if (name.endsWith('.txt')) fresh[name] = buf.toString('utf8');
if (!fresh['stops.txt'] || !fresh['stop_times.txt']) {
  console.error(`[fetch-gtfs] ✗ v zipu ni pričakovanih GTFS datotek (${[...entries.keys()].join(', ')})`);
  process.exit(1);
}

const infoNew = analyze(fresh);
const identical = local && Object.keys(fresh).every(f => local[f] === fresh[f])
  && Object.keys(local).length === Object.keys(fresh).length;

if (local) report(`obstoječi feed`, analyze(local));
const level = report(`prenešeni feed`, infoNew);

if (identical && !FORCE) {
  console.log(`\n[fetch-gtfs] feed je identičen obstoječemu — nič za posodobiti (--force za vsiljen zapis).`);
} else {
  // gtfs_raw ni pod gitom, zato pred prepisom naredimo varnostno kopijo starega feeda.
  if (local) {
    const tag = analyze(local).feedStart || 'prev';
    const backup = `${RAW}_backup_${tag}`;
    if (!existsSync(backup)) {
      await mkdir(backup, { recursive: true });
      for (const f of Object.keys(local)) await copyFile(resolve(RAW, f), resolve(backup, f));
      console.log(`\n[fetch-gtfs] varnostna kopija → ${backup}`);
    }
  }
  await mkdir(RAW, { recursive: true });
  for (const [f, text] of Object.entries(fresh)) await writeFile(resolve(RAW, f), text, 'utf8');

  const rows = (t) => (t ? t.trim().split('\n').length - 1 : 0);
  console.log(`[fetch-gtfs] ✓ zapisano v ${RAW}`);
  for (const f of ['stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt']) {
    console.log(`  ${f.padEnd(15)} ${String(rows(local?.[f])).padStart(6)} → ${String(rows(fresh[f])).padStart(6)}`);
  }
  console.log(`\n  → naslednji korak: node scripts/build-gtfs.mjs`);
}

if (level === 2) console.log(`\n[fetch-gtfs] ✗ tudi nov feed ima potekle dneve — Marprom še ni objavil naslednjega voznega reda.`);
else if (level === 1) console.log(`\n[fetch-gtfs] ! del voznega reda poteče v ${WARN_DAYS} dneh — spremljaj objavo novega feeda.`);
