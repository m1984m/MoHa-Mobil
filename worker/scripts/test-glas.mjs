// node --test scripts/test-glas.mjs
// Novi glas: števke v besede, razrez na povedi, shramba v D1 (prava shema glas.sql v
// node:sqlite), mesečna meja, stikalo, /glas. ElevenLabs je ponarejen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { vBesede, stevnik, poSpolu, rodilnik, mestnik } from '../src/stevilke.js';
import {
  povedi, kljucPovedi, brezOznak, brezGlaveInfo, besedeIzPoravnave, noviZvok, glasVklopljen, handleGlas,
  pozabiStanje, mesecLj, mejaKreditov, sintetiziraj, NAJVEC_POVEDI, NAJVEC_ZNAKOV, NAJVEC_ZNAKOV_POVEDI,
  GLAS_PRIVZETO, MODEL_PRIVZETO,
} from '../src/glas.js';

// ── števke ──────────────────────────────────────────────────────────────────

test('stevnik in oblike po spolu in sklonu', () => {
  assert.equal(stevnik(0), 'nič');
  assert.equal(stevnik(21), 'enaindvajset');
  assert.equal(stevnik(105), 'sto pet');
  assert.equal(stevnik(8520), 'osem tisoč petsto dvajset');
  assert.equal(poSpolu(1, 'm'), 'en');
  assert.equal(poSpolu(2, 'z'), 'dve');
  assert.equal(poSpolu(1, 'z', true), 'eno');
  assert.equal(poSpolu(101, 'm'), 'sto en');
  assert.equal(poSpolu(11, 'm'), 'enajst');
  assert.equal(mestnik(1, 's'), 'enem');
  assert.equal(mestnik(7), 'sedmih');
  assert.equal(mestnik(8), 'osmih');
  assert.equal(mestnik(17), 'sedemnajstih');
  assert.equal(rodilnik(25), 'petindvajsetih');
  assert.equal(rodilnik(1), 'enega');
  assert.equal(rodilnik(3), 'treh');
});

test('vBesede: stavki iz readAloud.ts ostanejo brez števk', () => {
  const pari = [
    ['Linija G šest, smer Kamnica, ob 14:35.', 'Linija G šest, smer Kamnica, ob štirinajst petintrideset.'],
    ['Danes ni več odhodov. Prvi jutri ob 4:35, linija G šest.', 'Danes ni več odhodov. Prvi jutri ob štiri petintrideset, linija G šest.'],
    ['Kreni ob 14:00, na cilju boš ob 14:05.', 'Kreni ob štirinajst, na cilju boš ob štirinajst nič pet.'],
    ['Kreni ob 1:02, na cilju boš ob 2:21.', 'Kreni ob ena nič dve, na cilju boš ob dve enaindvajset.'],
    ['Izstopi na postajališču Glavni trg ob 15:02, po 7 postajališčih.', 'Izstopi na postajališču Glavni trg ob petnajst nič dve, po sedmih postajališčih.'],
    ['po 1 postajališču.', 'po enem postajališču.'],
    ['po 2 postajališčih.', 'po dveh postajališčih.'],
    ['Predlog 2: ena ura in deset minut, prihod ob 9:15, 1 prestop.', 'Predlog dva: ena ura in deset minut, prihod ob devet petnajst, en prestop.'],
    ['Predlog 1: dvajset minut, prihod ob 9:15, 2 prestopa.', 'Predlog ena: dvajset minut, prihod ob devet petnajst, dva prestopa.'],
    ['Prvi odhod ob 5:10, zadnji ob 22:40, skupaj 21 odhodov.', 'Prvi odhod ob pet deset, zadnji ob dvaindvajset štirideset, skupaj enaindvajset odhodov.'],
    ['Vreme danes: 1 stopinja, oblačno.', 'Vreme danes: ena stopinja, oblačno.'],
    ['Najvišja temperatura 2 stopinji, najnižja -3 stopinje.', 'Najvišja temperatura dve stopinji, najnižja minus tri stopinje.'],
    ['Padavine: 2,5 milimetra.', 'Padavine: dve celi pet milimetra.'],
    ['Padavine: 1,2 milimetra.', 'Padavine: ena cela dva milimetra.'],
    ['Padlo je 21,5.', 'Padlo je enaindvajset celih pet.'],
    ['Padavine: 12,5 milimetra.', 'Padavine: dvanajst celih pet milimetra.'],
    // Beseda za številom ni samostalnik: število ostane v osnovni obliki (»linija ena«, ne »linija en«).
    ['Naslednji odhodi: linija 1 ob 9:00, linija 6 ob 9:20.', 'Naslednji odhodi: linija ena ob devet, linija šest ob devet dvajset.'],
    ['Skupaj 121 odhodov, 1 odhod, 2 odhoda.', 'Skupaj sto enaindvajset odhodov, en odhod, dva odhoda.'],
    ['Velja 90 minut in 1 uro.', 'Velja devetdeset minut in eno uro.'],
    ['Padavine: 0,05 milimetra.', 'Padavine: nič cela nič pet milimetra.'],
    ['Veter do 25 kilometrov na uro.', 'Veter do petindvajsetih kilometrov na uro.'],
    ['Veter do 1 kilometra na uro.', 'Veter do enega kilometra na uro.'],
    ['Dnevna, 13 evrov in 50 centov; Enkratna, 1 evro in 1 cent.', 'Dnevna, trinajst evrov in petdeset centov; Enkratna, en evro in en cent.'],
    ['Otroci od 6 do 14 let, 2 evra.', 'Otroci od šestih do štirinajstih let, dva evra.'],
    ['Starejši od 65 let, 1 leto.', 'Starejši od petinšestdeset let, eno leto.'],
    ['Na vlak N0701, smer Ptuj.', 'Na vlak N nič sedem nič ena, smer Ptuj.'],
    ['Vstopi na avtobus linije A8520.', 'Vstopi na avtobus linije A osem tisoč petsto dvajset.'],
    ['Postajališče Tezno 2.', 'Postajališče Tezno dva.'],
  ];
  for (const [vhod, izhod] of pari) {
    const dobim = vBesede(vhod);
    assert.equal(dobim, izhod);
    assert.ok(!/\d/.test(dobim), dobim);
  }
});

test('vBesede: besedilo brez števk in že razpisane minute ostanejo, kot so', () => {
  for (const s of ['Linija G šest, smer Kamnica, čez štiri minute. V živo.', 'Postajališče Glavni trg.', '']) {
    assert.equal(vBesede(s), s);
  }
});

// ── povedi, ključ, MP3, časi besed ──────────────────────────────────────────

test('povedi: meja pri končnem ločilu, za kratko okrajšavo se ne reže', () => {
  assert.deepEqual(povedi('Postajališče Glavni trg. Linija G šest, smer Kamnica, čez štiri minute. V živo. Zamuja dve minuti.'), [
    'Postajališče Glavni trg.', 'Linija G šest, smer Kamnica, čez štiri minute. V živo.', 'Zamuja dve minuti.',
  ]);
  // vezaj s presledki → vejica; vezaj v besedi ostane
  assert.deepEqual(povedi('Postajališče Zrkovska - Gasilski dom. Linija G šest.'), [
    'Postajališče Zrkovska, Gasilski dom.', 'Linija G šest.',
  ]);
  assert.deepEqual(povedi('Postajališče Ul. Veljka Vlahoviča – S enaintrideset.'), ['Postajališče Ul. Veljka Vlahoviča, Es enaintrideset.']);
  assert.deepEqual(povedi('S tem je konec. Linija S šest.'), ['S tem je konec.', 'Linija Es šest.']);
  assert.deepEqual(povedi('V živo.'), ['V živo.']);
  assert.deepEqual(povedi('Dobro jutro! Postajališče Sv. Peter. Po voznem redu.'), [
    'Dobro jutro!', 'Postajališče Sv. Peter.', 'Po voznem redu.',
  ]);
  assert.deepEqual(povedi('  '), []);
  assert.deepEqual(povedi('brez ločila'), ['brez ločila']);
});

test('kljucPovedi: odvisen od glasu, modela in besedila', async () => {
  const a = await kljucPovedi('g', 'm', 'V živo.');
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, await kljucPovedi('g', 'm', 'V živo.'));
  assert.notEqual(a, await kljucPovedi('g2', 'm', 'V živo.'));
  assert.notEqual(a, await kljucPovedi('g', 'm2', 'V živo.'));
  assert.notEqual(a, await kljucPovedi('g', 'm', 'V živo'));
});

const telo = (n, zacetek = 0xff) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? zacetek : (i * 7) % 251));
function zId3(jedro, v1 = false) {
  const glava = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]); // ID3v2, 5 bajtov vsebine
  const rep = v1 ? Uint8Array.from({ length: 128 }, (_, i) => (i < 3 ? [0x54, 0x41, 0x47][i] : 0)) : new Uint8Array(0);
  const out = new Uint8Array(glava.length + jedro.length + rep.length);
  out.set(glava); out.set(jedro, glava.length); out.set(rep, glava.length + jedro.length);
  return out;
}

test('brezOznak: odreže ID3v2 in ID3v1, golega MP3 se ne dotakne', () => {
  const jedro = telo(400);
  assert.deepEqual([...brezOznak(zId3(jedro, true))], [...jedro]);
  assert.deepEqual([...brezOznak(zId3(jedro))], [...jedro]);
  assert.deepEqual([...brezOznak(jedro)], [...jedro]);
  assert.equal(brezOznak(Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f, 1])).length, 0); // oznaka daljša od datoteke
});

test('brezGlaveInfo: odreže samo prvi okvir z oznako Info/Xing, ostalo pusti', () => {
  // MPEG-1 Layer III, 64 kbit/s, 44,1 kHz: okvir ima 208 bajtov (glava ff fb 50 c0).
  const okvir = (oznaka) => { const o = new Uint8Array(208); o.set([0xff, 0xfb, 0x50, 0xc0]); if (oznaka) o.set([...oznaka].map(c => c.charCodeAt(0)), 21); return o; };
  const zlepi = (...d) => { const u = new Uint8Array(d.reduce((a, x) => a + x.length, 0)); let i = 0; for (const x of d) { u.set(x, i); i += x.length; } return u; };
  const zvok = zlepi(okvir(), okvir(), okvir());
  assert.equal(brezGlaveInfo(zlepi(okvir('Info'), zvok)).length, zvok.length);
  assert.equal(brezGlaveInfo(zlepi(okvir('Xing'), zvok)).length, zvok.length);
  assert.equal(brezGlaveInfo(zvok).length, zvok.length);                       // brez glave: nedotaknjen
  assert.equal(brezGlaveInfo(telo(2000)).length, 2000);                        // ni veljaven okvir
  const brezNaslednjega = zlepi(okvir('Info'), new Uint8Array(300));           // za glavo ni sinhronizacije
  assert.equal(brezGlaveInfo(brezNaslednjega).length, brezNaslednjega.length);
  assert.equal(brezGlaveInfo(new Uint8Array(10)).length, 10);
});

const poravnava = (besedilo) => ({
  characters: [...besedilo],
  character_start_times_seconds: [...besedilo].map((_, i) => i * 0.05),
  character_end_times_seconds: [...besedilo].map((_, i) => (i + 1) * 0.05),
});

test('besedeIzPoravnave: besede z ločili in začetki, pokrijejo celo besedilo', () => {
  const b = besedeIzPoravnave(poravnava('V živo, zdaj.'));
  assert.deepEqual(b, [['V', 0], ['živo,', 0.1], ['zdaj.', 0.4]]);
  assert.equal(b.map(x => x[0]).join(' '), 'V živo, zdaj.');
  assert.deepEqual(besedeIzPoravnave(null), []);
  assert.deepEqual(besedeIzPoravnave({ characters: ['a'], character_start_times_seconds: [] }), []);
});

// ── shramba in pogon ────────────────────────────────────────────────────────

// D1 nad pravim SQLite z isto shemo: preveri tudi SQL v glas.js. D1 vrne BLOB kot
// polje števil, zato ga tako vrne tudi ponaredek.
function lazniD1({ shema = true } = {}) {
  const db = new DatabaseSync(':memory:');
  if (shema) db.exec(readFileSync(new URL('../glas.sql', import.meta.url), 'utf8'));
  const vBazo = (a) => a.map(x => (x instanceof ArrayBuffer ? new Uint8Array(x) : x));
  const izBaze = (r) => r && Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Uint8Array ? [...v] : v]));
  const stavek = (sql, a = []) => ({
    sql, a,
    bind: (...b) => stavek(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...vBazo(a)).map(izBaze) }),
    first: async () => izBaze(db.prepare(sql).get(...vBazo(a))) ?? null,
    run: async () => { const i = db.prepare(sql).run(...vBazo(a)); return { success: true, meta: { changes: Number(i.changes) } }; },
  });
  return {
    surova: db,
    prepare: (sql) => stavek(sql),
    batch: async (st) => { for (const s of st) db.prepare(s.sql).run(...vBazo(s.a)); return []; },
  };
}

// Ponarejen ElevenLabs: vsaka poved dobi svoj »MP3« z oznako ID3 in poravnavo znakov.
function lazniElevenLabs({ padePri = null, strosek = null, zamik = 0 } = {}) {
  const klici = [];
  const fetchFn = async (url, init) => {
    const t = JSON.parse(init.body);
    klici.push({ url, glave: init.headers, ...t });
    if (zamik) await new Promise((r, zavrni) => { const c = setTimeout(r, zamik); init.signal?.addEventListener('abort', () => { clearTimeout(c); zavrni(new Error('prekinjen')); }); });
    if (padePri && t.text.includes(padePri)) return new Response('{"detail":{"status":"quota_exceeded"}}', { status: 401 });
    const mp3 = zId3(telo(2000 + t.text.length, 0xff));
    return new Response(JSON.stringify({ audio_base64: Buffer.from(mp3).toString('base64'), alignment: poravnava(t.text) }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...(strosek == null ? {} : { 'character-cost': String(strosek) }) },
    });
  };
  return { klici, fetchFn };
}

const okolje = (db, dodatno = {}) => ({ ELEVENLABS_API_KEY: 'k', SPREMLJANJE_DB: db, STAT_KEY: 'geslo', ...dodatno });
const ctx = () => { const cakaj = []; return { cakaj, waitUntil: (p) => cakaj.push(p) }; };
const T0 = Date.UTC(2026, 10, 18, 12, 0);
const BRANJE = 'Postajališče Glavni trg. Linija G šest, smer Kamnica, čez štiri minute. V živo. Linija P 7, smer Kamnica, ob 14:35. Po voznem redu. Linija G šest, smer Kamnica, čez štiri minute. V živo.';

test('noviZvok: prvič sintetizira vsako različno poved enkrat, drugič vse iz shrambe', async () => {
  pozabiStanje();
  const db = lazniD1();
  const el = lazniElevenLabs();
  const c = ctx();
  const r = await noviZvok(okolje(db), c, BRANJE, { fetchFn: el.fetchFn, zdaj: () => T0 });
  await Promise.all(c.cakaj);
  assert.equal(r.napaka, undefined);
  assert.equal(r.povedi, 5);
  assert.equal(r.novihPovedi, 4);                       // ista poved je dvakrat, plača se enkrat
  assert.equal(el.klici.length, 4);
  assert.deepEqual(el.klici.map(k => k.text).sort(), [
    'Linija G šest, smer Kamnica, čez štiri minute. V živo.', 'Linija P sedem, smer Kamnica, ob štirinajst petintrideset.',
    'Po voznem redu.', 'Postajališče Glavni trg.',
  ]);
  const k0 = el.klici[0];
  assert.ok(k0.url.includes(`/v1/text-to-speech/${GLAS_PRIVZETO}/with-timestamps`) && k0.url.includes('output_format=mp3_44100_64'));
  assert.equal(k0.model_id, MODEL_PRIVZETO);
  assert.equal(k0.language_code, 'sl');
  assert.deepEqual(k0.voice_settings, { stability: 0.3 });
  assert.equal(k0.glave['xi-api-key'], 'k');

  // Zlepljen zvok: pet kosov brez oznak ID3, v vrstnem redu besedila.
  const dolzine = ['Postajališče Glavni trg.', 'Linija G šest, smer Kamnica, čez štiri minute. V živo.',
    'Linija P sedem, smer Kamnica, ob štirinajst petintrideset.', 'Po voznem redu.', 'Linija G šest, smer Kamnica, čez štiri minute. V živo.'].map(s => 2000 + s.length);
  assert.equal(r.buf.byteLength, dolzine.reduce((a, b) => a + b, 0));
  const u8 = new Uint8Array(r.buf);
  assert.equal(u8[0], 0xff);
  assert.equal(u8[dolzine[0]], 0xff);

  // Shramba: štiri vrstice, brez števk, časi pokrijejo besedilo.
  const vrstice = db.surova.prepare('SELECT besedilo, casi, znaki, krediti, mesec, glas, model, length(zvok) AS b FROM glas_povedi ORDER BY besedilo').all();
  assert.equal(vrstice.length, 4);
  for (const v of vrstice) {
    assert.ok(!/\d/.test(v.besedilo), v.besedilo);
    assert.equal(JSON.parse(v.casi).map(x => x[0]).join(' '), v.besedilo);
    assert.equal(v.znaki, v.besedilo.length);
    assert.equal(v.krediti, Math.ceil(v.besedilo.length * 0.2));
    assert.equal(v.mesec, '2026-11');
    assert.equal(v.b, 2000 + v.besedilo.length);
    assert.equal(v.glas, GLAS_PRIVZETO);
  }
  assert.equal(r.novihZnakov, vrstice.reduce((a, v) => a + v.znaki, 0));

  // Drugo branje: nič klicev, enak zvok.
  const r2 = await noviZvok(okolje(db), ctx(), BRANJE, { fetchFn: el.fetchFn, zdaj: () => T0 });
  assert.equal(el.klici.length, 4);
  assert.equal(r2.novihPovedi, 0);
  assert.equal(r2.novihZnakov, 0);
  assert.deepEqual([...new Uint8Array(r2.buf)], [...u8]);

  // Tretje: ena nova poved, ostale iz shrambe.
  const r3 = await noviZvok(okolje(db), ctx(), 'Postajališče Glavni trg. Danes brez padavin.', { fetchFn: el.fetchFn, zdaj: () => T0 });
  assert.equal(r3.novihPovedi, 1);
  assert.equal(el.klici.length, 5);
});

test('noviZvok: strošek iz glave character-cost ima prednost pred oceno', async () => {
  const db = lazniD1();
  const el = lazniElevenLabs({ strosek: 17 });
  const c = ctx();
  await noviZvok(okolje(db), c, 'Po voznem redu.', { fetchFn: el.fetchFn, zdaj: () => T0 });
  await Promise.all(c.cakaj);
  assert.equal(db.surova.prepare('SELECT krediti FROM glas_povedi').get().krediti, 17);
});

test('noviZvok: mesečna meja ustavi nove povedi, shranjene bere naprej; nov mesec jo sprosti', async () => {
  const db = lazniD1();
  const el = lazniElevenLabs({ strosek: 60 });
  const env = okolje(db, { GLAS_MEJA_KREDITOV: '70' });
  let c = ctx();
  assert.equal((await noviZvok(env, c, 'Po voznem redu.', { fetchFn: el.fetchFn, zdaj: () => T0 })).novihPovedi, 1);   // 60 kreditov
  await Promise.all(c.cakaj);
  const r = await noviZvok(env, ctx(), 'Postajališče Glavni trg. Linija G šest, smer Kamnica, čez štiri minute. Brez padavin.', { fetchFn: el.fetchFn, zdaj: () => T0 });
  assert.equal(r.napaka, 'meja');                         // porabljenih 60 + ocena novih 5 + 10 + 3 = 78 > 70
  assert.equal(el.klici.length, 1);
  assert.equal((await noviZvok(env, ctx(), 'Po voznem redu.', { fetchFn: el.fetchFn, zdaj: () => T0 })).novihPovedi, 0); // iz shrambe
  const december = Date.UTC(2026, 11, 1, 12, 0);
  c = ctx();
  assert.equal((await noviZvok(env, c, 'Brez padavin.', { fetchFn: el.fetchFn, zdaj: () => december })).novihPovedi, 1);
  await Promise.all(c.cakaj);
  assert.equal(mejaKreditov({}), 3000);
  assert.equal(mejaKreditov({ GLAS_MEJA_KREDITOV: '0' }), 0);
  assert.equal(mejaKreditov({ GLAS_MEJA_KREDITOV: 'abc' }), 3000);
  assert.equal(mesecLj(Date.UTC(2026, 10, 30, 23, 30)), '2026-12');   // 00:30 v Ljubljani je že december
});

test('noviZvok: ena poved pade → napaka za celo besedilo, uspele ostanejo v shrambi', async () => {
  const db = lazniD1();
  const el = lazniElevenLabs({ padePri: 'Kamnica' });
  const c = ctx();
  const r = await noviZvok(okolje(db), c, 'Postajališče Glavni trg. Linija G šest, smer Kamnica, prihaja zdaj.', { fetchFn: el.fetchFn, zdaj: () => T0 });
  await Promise.all(c.cakaj);
  assert.equal(r.napaka, 'elevenlabs');
  assert.equal(r.buf, undefined);
  const shranjene = db.surova.prepare('SELECT besedilo FROM glas_povedi').all().map(v => v.besedilo);
  assert.ok(shranjene.every(s => !s.includes('Kamnica')));
  assert.equal(r.novihZnakov, shranjene.reduce((a, s) => a + s.length, 0));
});

test('noviZvok: meja dolžine velja po razpisu števk', async () => {
  const el = lazniElevenLabs();
  const db = lazniD1();
  // 798 znakov samih števk se razpiše v več tisoč znakov: en klic bi stal več kot tisoč kreditov.
  assert.equal((await noviZvok(okolje(db), ctx(), '999999 '.repeat(114).trim() + '.', { fetchFn: el.fetchFn })).napaka, 'povedi');
  const dolga = 'Zelo dolga poved ' + 'besed '.repeat(Math.ceil(NAJVEC_ZNAKOV_POVEDI / 6)) + 'brez konca.';
  assert.ok(dolga.length > NAJVEC_ZNAKOV_POVEDI && dolga.length < NAJVEC_ZNAKOV);
  assert.equal((await noviZvok(okolje(db), ctx(), dolga, { fetchFn: el.fetchFn })).napaka, 'povedi');
  assert.equal(el.klici.length, 0);
  assert.equal(db.surova.prepare('SELECT COUNT(*) AS n FROM glas_poraba').get().n, 0);
});

test('noviZvok: prazno, preveč povedi in izjema baze vrnejo napako, ne vržejo', async () => {
  const el = lazniElevenLabs();
  assert.equal((await noviZvok(okolje(lazniD1()), ctx(), '   ', { fetchFn: el.fetchFn })).napaka, 'povedi');
  const dolgo = Array.from({ length: NAJVEC_POVEDI + 1 }, (_, i) => `Kratek stavek ${'abcdefghijklmnopqrstu'[i]}.`).join(' ');
  assert.equal((await noviZvok(okolje(lazniD1()), ctx(), dolgo, { fetchFn: el.fetchFn })).napaka, 'povedi');
  assert.equal((await noviZvok(okolje(lazniD1({ shema: false })), ctx(), 'Po voznem redu.', { fetchFn: el.fetchFn })).napaka, 'elevenlabs');
  assert.equal(el.klici.length, 0);
});

test('sintetiziraj: napaka nosi status, telo napake ne gre naprej', async () => {
  await assert.rejects(
    sintetiziraj({ ELEVENLABS_API_KEY: 'k' }, 'Kamnica.', { fetchFn: lazniElevenLabs({ padePri: 'Kamnica' }).fetchFn }),
    (e) => e.status === 401 && !/quota/.test(e.message),
  );
});

test('noviZvok: meja je trda tudi ob hkratnih klicih; neuspela sinteza rezervacijo vrne', async () => {
  const db = lazniD1();
  const krediti = () => db.surova.prepare("SELECT krediti FROM glas_poraba WHERE mesec = '2026-11'").get()?.krediti ?? 0;
  // Pet hkratnih branj z različnim besedilom, vsako oceni na 5 kreditov; meja 10 spusti dve.
  const el = lazniElevenLabs({ zamik: 20 });
  const env = okolje(db, { GLAS_MEJA_KREDITOV: '10' });
  const cakaj = [];
  const izidi = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(x => {
    const c = ctx(); cakaj.push(c);
    return noviZvok(env, c, `Hkratno branje ${x} tukaj.`, { fetchFn: el.fetchFn, zdaj: () => T0 });
  }));
  await Promise.all(cakaj.flatMap(c => c.cakaj));
  assert.equal(izidi.filter(r => r.buf).length, 2);
  assert.equal(izidi.filter(r => r.napaka === 'meja').length, 3);
  assert.equal(el.klici.length, 2);
  assert.equal(krediti(), 10);

  // Sinteza pade: rezervirana ocena se vrne, da izpad ElevenLabs ne poje meje.
  const db2 = lazniD1();
  const c2 = ctx();
  const r = await noviZvok(okolje(db2), c2, 'Brez padavin danes zvečer.', { fetchFn: lazniElevenLabs({ padePri: 'Brez' }).fetchFn, zdaj: () => T0 });
  await Promise.all(c2.cakaj);
  assert.equal(r.napaka, 'elevenlabs');
  assert.equal(db2.surova.prepare('SELECT krediti FROM glas_poraba').get().krediti, 0);

  // Iztek: zahteva je bila poslana in je lahko zaračunana, zato rezervacija OSTANE.
  const db4 = lazniD1();
  const c4 = ctx();
  const pocasen = lazniElevenLabs({ zamik: 300 });
  const r4 = await noviZvok(okolje(db4), c4, 'Počasna poved brez konca.', { fetchFn: pocasen.fetchFn, zdaj: () => T0, casMs: 20 });
  await Promise.all(c4.cakaj);
  assert.equal(r4.napaka, 'elevenlabs');
  assert.equal(db4.surova.prepare('SELECT krediti FROM glas_poraba').get().krediti, Math.ceil('Počasna poved brez konca.'.length * 0.2));
  assert.equal(db4.surova.prepare('SELECT COUNT(*) AS n FROM glas_povedi').get().n, 0);

  // Ena od štirih povedi je zavrnjena: vrnejo se krediti zanjo in za tiste, ki niso
  // prišle na vrsto; prekinjene ostanejo rezervirane.
  const db5 = lazniD1();
  const c5 = ctx();
  const povedi5 = ['Prva poved tukaj.', 'Druga pade takoj.', 'Tretja poved tukaj.', 'Četrta poved tukaj.', 'Peta poved tukaj.', 'Šesta poved tukaj.'];
  await noviZvok(okolje(db5), c5, povedi5.join(' '), { fetchFn: lazniElevenLabs({ padePri: 'pade', zamik: 15 }).fetchFn, zdaj: () => T0 });
  await Promise.all(c5.cakaj);
  const ostalo = db5.surova.prepare('SELECT krediti FROM glas_poraba').get().krediti;
  const vse = povedi5.reduce((a, p) => a + Math.ceil(p.length * 0.2), 0);
  assert.ok(ostalo > 0 && ostalo < vse, `${ostalo} od ${vse}`);

  // Besedilo, katerega ocena sama presega mejo, ne rezervira ničesar.
  const db3 = lazniD1();
  assert.equal((await noviZvok(okolje(db3, { GLAS_MEJA_KREDITOV: '2' }), ctx(), 'Predolgo za tako nizko mejo.', { fetchFn: el.fetchFn, zdaj: () => T0 })).napaka, 'meja');
  assert.equal(db3.surova.prepare('SELECT COUNT(*) AS n FROM glas_poraba').get().n, 0);
});

// ── stikalo ─────────────────────────────────────────────────────────────────

const zahteva = (metoda, telo, kljuc = 'geslo') => new Request('https://w/glas', {
  method: metoda, headers: { 'x-stat-key': kljuc, 'Content-Type': 'application/json' }, body: telo === undefined ? undefined : JSON.stringify(telo),
});

test('glasVklopljen: potrebuje skrivnost, bazo in tabele; stikalo ga izklopi', async () => {
  pozabiStanje();
  const db = lazniD1();
  assert.equal(await glasVklopljen({ SPREMLJANJE_DB: db }), false);                 // brez skrivnosti
  assert.equal(await glasVklopljen({ ELEVENLABS_API_KEY: 'k' }), false);            // brez baze
  pozabiStanje();
  assert.equal(await glasVklopljen(okolje(lazniD1({ shema: false }))), false);      // brez tabel
  pozabiStanje();
  assert.equal(await glasVklopljen(okolje(db)), true);

  const izklop = await handleGlas(zahteva('POST', { vklopljen: false }), okolje(db), {});
  assert.equal(izklop.status, 200);
  assert.equal((await izklop.json()).vklopljen, false);
  assert.equal(await glasVklopljen(okolje(db)), false);
  const vklop = await (await handleGlas(zahteva('POST', { vklopljen: true }), okolje(db), {})).json();
  assert.equal(vklop.vklopljen, true);
  assert.equal(await glasVklopljen(okolje(db)), true);
  pozabiStanje();
});

test('/glas: geslo, oblika telesa in poraba meseca', async () => {
  pozabiStanje();
  const db = lazniD1();
  const env = okolje(db);
  assert.equal((await handleGlas(zahteva('GET', undefined, 'narobe'), env, {})).status, 401);
  assert.equal((await handleGlas(zahteva('GET'), { ...env, STAT_KEY: undefined }, {})).status, 503);
  assert.equal((await handleGlas(zahteva('DELETE'), env, {})).status, 405);
  assert.equal((await handleGlas(zahteva('POST', { vklopljen: 'da' }), env, {})).status, 400);
  assert.equal((await handleGlas(zahteva('GET'), okolje(lazniD1({ shema: false })), {})).status, 503);

  const c = ctx();
  await noviZvok(env, c, 'Po voznem redu. Danes brez padavin.', { fetchFn: lazniElevenLabs({ strosek: 40 }).fetchFn });
  await Promise.all(c.cakaj);
  pozabiStanje();
  const s = await (await handleGlas(zahteva('GET'), env, { 'Access-Control-Allow-Origin': 'x' })).json();
  assert.deepEqual({ vklopljen: s.vklopljen, kljuc: s.kljuc, krediti: s.krediti, povedi: s.povedi, vsehPovedi: s.vsehPovedi, meja: s.meja, znaki: s.znaki },
    { vklopljen: true, kljuc: true, krediti: 80, povedi: 2, vsehPovedi: 2, meja: 3000, znaki: 'Po voznem redu.'.length + 'Danes brez padavin.'.length });
  assert.equal(s.glas, GLAS_PRIVZETO);
  pozabiStanje();
});

// ── POST /tts z novim glasom ───────────────────────────────────────────────

import { handleTts } from '../src/tts.js';

test('/tts: novi glas bere, drugo branje pride iz shrambe; ob napaki ElevenLabs poskusi prejšnji glas', async () => {
  pozabiStanje();
  const db = lazniD1();
  const el = lazniElevenLabs();
  const predpomnilnik = new Map();
  const izvirnik = { fetch: globalThis.fetch, caches: globalThis.caches };
  let drugiKlici = 0;
  globalThis.caches = { default: {
    match: async (k) => { const r = predpomnilnik.get(k.url); return r ? r.clone() : undefined; },
    put: async (k, r) => { predpomnilnik.set(k.url, r); },
  } };
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.elevenlabs.io/')) return el.fetchFn(url, init);
    drugiKlici++;
    throw new Error('omrežja v preverbi ni');
  };
  const klic = (besedilo, env, c) => handleTts(new Request('https://w/tts', { method: 'POST', body: besedilo }), env, c, { 'Access-Control-Allow-Origin': 'x' });
  try {
    const env = okolje(db);
    let c = ctx();
    const r1 = await klic('Postajališče Glavni trg. Po voznem redu. Linija G šest, smer Kamnica, ob 14:35.', env, c);
    await Promise.all(c.cakaj);
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal(r1.headers.get('X-Proxy-Cache'), 'MISS');
    assert.equal(r1.headers.get('Access-Control-Allow-Origin'), 'x');
    const zvok1 = new Uint8Array(await r1.arrayBuffer());
    assert.equal(el.klici.length, 3);
    assert.equal(predpomnilnik.size, 1);

    // Isto besedilo: rob vrne celo branje, brez baze in brez ElevenLabs.
    c = ctx();
    const r2 = await klic('Postajališče Glavni trg. Po voznem redu. Linija G šest, smer Kamnica, ob 14:35.', env, c);
    assert.equal(r2.headers.get('X-Proxy-Cache'), 'HIT');
    assert.deepEqual([...new Uint8Array(await r2.arrayBuffer())], [...zvok1]);

    // Drugo besedilo iz že znanih povedi: iz shrambe, brez novega klica.
    c = ctx();
    const r3 = await klic('Po voznem redu. Postajališče Glavni trg.', env, c);
    await Promise.all(c.cakaj);
    assert.equal(r3.status, 200);
    assert.equal(r3.headers.get('X-Proxy-Cache'), 'HIT-SHRAMBA');
    assert.equal(el.klici.length, 3);

    // ElevenLabs odpove: /tts ne vrne novega glasu, ampak poskusi prejšnjega
    // (v preverbi omrežja ni, zato 502 — pomembno je, da ne vrže in da napake ne predpomni).
    el.klici.length = 0;
    const slab = lazniElevenLabs({ padePri: 'Brez' });
    globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.elevenlabs.io/') ? slab.fetchFn(url, init) : Promise.reject(new Error('omrežja ni')));
    c = ctx();
    const r4 = await klic('Brez padavin.', env, c);
    await Promise.all(c.cakaj);
    assert.equal(r4.status, 502);
    assert.equal(slab.klici.length, 1);
    assert.equal(predpomnilnik.size, 2);

    // Novi glas odpove, bere prejšnji (tu ponarejen Azure): posnetek NE sme pod ključ novega,
    // sicer bi isto besedilo še 24 ur vračalo prejšnji glas.
    const zAzure = { ...env, AZURE_SPEECH_KEY: 'a', AZURE_SPEECH_REGION: 'r' };
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.elevenlabs.io/')) return slab.fetchFn(url, init);
      if (String(url).includes('tts.speech.microsoft.com')) return new Response(telo(3000), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
      throw new Error('omrežja ni');
    };
    c = ctx();
    const r4b = await klic('Brez padavin zvečer.', zAzure, c);
    await Promise.all(c.cakaj);
    assert.equal(r4b.status, 200);
    assert.equal(r4b.headers.get('X-Proxy-Cache'), 'MISS');
    assert.equal(predpomnilnik.size, 3);
    c = ctx();
    // Drugič: novi glas poskusi znova (povedi so morda že v shrambi); ko spet odpove, vrne
    // kopijo prejšnjega glasu iz predpomnilnika, brez novega klica na Azure.
    let azureKlicev = 0;
    const prejFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => { if (String(url).includes('tts.speech.microsoft.com')) azureKlicev++; return prejFetch(url, init); };
    c = ctx();
    const r4c = await klic('Brez padavin zvečer.', zAzure, c);
    await Promise.all(c.cakaj);
    assert.equal(r4c.status, 200);
    assert.equal(r4c.headers.get('X-Proxy-Cache'), 'HIT');
    assert.equal(slab.klici.length, 3);
    assert.equal(azureKlicev, 0);

    // Stikalo izklopljeno: ElevenLabs se ne kliče več, ključ predpomnilnika je drug.
    await handleGlas(zahteva('POST', { vklopljen: false }), env, {});
    c = ctx();
    const r5 = await klic('Po voznem redu. Postajališče Glavni trg.', env, c);
    await Promise.all(c.cakaj);
    assert.equal(r5.status, 502);                // Edge v preverbi ni dosegljiv; novega glasu ni vprašal
    assert.equal(slab.klici.length, 3);
    c = ctx();
    const r6 = await klic('Brez padavin zvečer.', zAzure, c);        // prejšnji glas ima svoj ključ: zadetek
    assert.equal(r6.headers.get('X-Proxy-Cache'), 'HIT');
    assert.notEqual(r5.headers.get('X-Proxy-Cache'), 'HIT');
  } finally {
    globalThis.fetch = izvirnik.fetch;
    globalThis.caches = izvirnik.caches;
    pozabiStanje();
  }
});

test('povedi: naslov postajališča začne novo poved, tudi ko ima samo dve besedi', () => {
  // Na Domu se bere več postajališč zapored. »Postajališče Tabor.« se ne sme prilepiti na
  // zadnji odhod prejšnjega, sicer je vsaka kombinacija nova, plačana poved.
  assert.deepEqual(povedi('Postajališče Glavni trg. V živo. Linija G šest, smer Kamnica, čez štiri minute. Postajališče Tabor. V živo. Linija P sedem, smer Tezno, prihaja zdaj.'), [
    'Postajališče Glavni trg. V živo.', 'Linija G šest, smer Kamnica, čez štiri minute.',
    'Postajališče Tabor. V živo.', 'Linija P sedem, smer Tezno, prihaja zdaj.',
  ]);
  // Ista poved kot v listu enega postajališča: pride iz shrambe.
  assert.deepEqual(povedi('Postajališče Tabor. V živo.'), ['Postajališče Tabor. V živo.']);
});

test('noviZvok: seznam vozovnic iz cenika (ena poved, 470 znakov) bere novi glas', async () => {
  const cenik = 'Posamične vožnje: Ena vožnja pri vozniku (z bančno kartico, brez prestopa), 1,50 €; Ena vožnja v predprodaji (s prestopom v petinsedemdeset minutah), en evro in petdeset centov; Ena vožnja, otroci od šestih do štirinajstih let (s prestopom v petinsedemdeset minutah), en evro; deset voženj (s prestopom v petinsedemdeset minutah), trinajst evrov; deset voženj, otroci od šestih do štirinajstih let (s prestopom v petinsedemdeset minutah), štiri evri.';
  assert.ok(cenik.length > 400 && cenik.length <= NAJVEC_ZNAKOV_POVEDI, String(cenik.length));
  const el = lazniElevenLabs();
  const c = ctx();
  const r = await noviZvok(okolje(lazniD1()), c, cenik, { fetchFn: el.fetchFn, zdaj: () => T0 });
  await Promise.all(c.cakaj);
  assert.equal(r.napaka, undefined);
  assert.equal(r.novihPovedi, 1);
  assert.equal(el.klici.length, 1);
});
