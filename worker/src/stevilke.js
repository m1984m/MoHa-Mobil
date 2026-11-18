/**
 * Števke v slovenske besede, preden gre besedilo k ElevenLabs (novi glas).
 *
 * Zakaj: model števke bere po svoje (sklon, spol, včasih tuj izgovor). Z besedo
 * zapisano število prebere tako, kot piše, in shranjena poved je uporabna povsod.
 *
 * Aplikacija (src/lib/pronounce.ts, forSpeech) je pred tem že razpisala minute in
 * ure (»čez štiri minute«), oznake linij (»G šest«), cene v evre in razpone. Tu
 * pride na vrsto, kar ostane v besedilih iz src/lib/readAloud.ts: ure dneva
 * (14:35), število postajališč, prestopov, odhodov, stopinj, kilometrov, zneski
 * in vse drugo, kar je še zapisano s števkami.
 *
 * Sklon in spol določi beseda ob številu; kjer je ne poznamo, je število v
 * imenovalniku moškega spola (»en«, »dva«), kot bi ga prebral človek s seznama.
 */

const ENICE = ['nič', 'ena', 'dva', 'tri', 'štiri', 'pet', 'šest', 'sedem', 'osem', 'devet',
  'deset', 'enajst', 'dvanajst', 'trinajst', 'štirinajst', 'petnajst', 'šestnajst', 'sedemnajst',
  'osemnajst', 'devetnajst'];
const DESETICE = ['', '', 'dvajset', 'trideset', 'štirideset', 'petdeset', 'šestdeset', 'sedemdeset',
  'osemdeset', 'devetdeset'];

/** Glavni števnik 0–999.999, osnovna oblika (»ena«, »dva«, »enaindvajset«, »sto pet«). */
export function stevnik(n) {
  if (n < 20) return ENICE[n];
  if (n < 100) {
    const e = n % 10, d = Math.floor(n / 10);
    return e ? `${ENICE[e]}in${DESETICE[d]}` : DESETICE[d];
  }
  if (n < 1000) {
    const st = Math.floor(n / 100), r = n % 100;
    const sto = st === 1 ? 'sto' : st === 2 ? 'dvesto' : `${ENICE[st]}sto`;
    return r ? `${sto} ${stevnik(r)}` : sto;
  }
  const t = Math.floor(n / 1000), r = n % 1000;
  const tisoc = t === 1 ? 'tisoč' : t === 2 ? 'dva tisoč' : `${stevnik(t)} tisoč`;
  return r ? `${tisoc} ${stevnik(r)}` : tisoc;
}

// Zadnji dve mesti odločata o obliki: 101 se sklanja kot 1, 112 kot 12.
function zRepom(n, rep) {
  const r = n % 100;
  const glava = n - r;
  const oblika = rep(r);
  if (oblika == null) return stevnik(n);
  return glava ? `${stevnik(glava)} ${oblika}` : oblika;
}

/** Imenovalnik po spolu: 'm' en/dva, 'z' ena/dve, 's' eno/dve; `eno` za tožilnik ženskega (»eno minuto«). */
export function poSpolu(n, spol, tozilnik = false) {
  return zRepom(n, (r) => {
    if (r === 1) return spol === 'm' ? 'en' : spol === 's' || tozilnik ? 'eno' : 'ena';
    if (r === 2) return spol === 'm' ? 'dva' : 'dve';
    return null;
  });
}

// Rodilnik in mestnik množine imata pri številih od 2 naprej isto obliko
// (»do treh kilometrov«, »po treh postajališčih«); ločita se samo pri 1.
function sklonjen(n, ena) {
  return zRepom(n, (r) => {
    if (r === 0) return n === 0 ? 'nič' : null;
    if (r === 1) return ena;
    if (r === 2) return 'dveh';
    if (r === 3) return 'treh';
    if (r === 4) return 'štirih';
    const b = stevnik(r);
    return b.replace(/sedem$/, 'sedm').replace(/osem$/, 'osm') + 'ih';
  });
}
export const rodilnik = (n, spol = 'm') => sklonjen(n, spol === 'z' ? 'ene' : 'enega');
export const mestnik = (n, spol = 'm') => sklonjen(n, spol === 'z' ? 'eni' : 'enem');

// Beseda za številom → spol. Dovolj je začetek besede; končnica pove sklon.
const ZENSKE = /^(minut|ur[aeio]?$|ur$|stopinj|vožnj|voženj|vozovnic|kart|linij|postaj(?!ališ)|sekund)/;
const SREDNJE = /^(postajališ|let[oia]?$|leti$|vozil)/;
const MOSKE = /^(prestop|odhod|prihod|evr|cent|kilometr|milimetr|metr|dan$|dni$|dnev|teden|tedn|mesec|korak|avtobus|vlak|otro|potnik)/;
// Spol besede za številom ali null, kadar besede ne poznamo. Neznana beseda (predlog,
// vejica, »smer«) števila ne sklanja: »linija 1 ob devet« je »linija ena«, ne »linija en«.
function spolBesede(b) {
  const m = b.toLowerCase();
  if (ZENSKE.test(m)) return 'z';
  if (SREDNJE.test(m)) return 's';
  if (MOSKE.test(m)) return 'm';
  return null;
}

const stevke = (s) => s.split('').map(c => ENICE[Number(c)]).join(' ');

// »ena cela«, »dve celi«, »tri cele«, »pet celih«; »nič cela pet« je ustaljeno branje.
function cela(n) {
  const r = n % 100;
  return n === 0 || r === 1 ? 'cela' : r === 2 ? 'celi' : r === 3 || r === 4 ? 'cele' : 'celih';
}

// Ura dneva. »14:00« → »štirinajst« (»ob 10.00« je »ob deset«),
// »14:05« → »štirinajst nič pet«, »1:02« → »ena nič dve« (ura in minuta sta ženskega spola).
function uraDneva(h, min) {
  const ura = h === 0 ? 'nič' : poSpolu(h, 'z');
  if (min === 0) return ura;
  return `${ura} ${min < 10 ? 'nič ' : ''}${poSpolu(min, 'z')}`;
}

const L = '\\p{L}';
const PRAVILA = [
  // Negativna temperatura: »-3 stopinje« → »minus 3 stopinje« (število razpiše pravilo spodaj).
  [/(^|[\s(])[-−](?=\d)/gu, (_m, pre) => `${pre}minus `],
  // Ura dneva; minute so vedno dvomestne, zato »6:14« ni razmerje.
  [/(?<![\d:,.])(\d{1,2}):(\d{2})(?![\d:])/g, (m, h, min) => (Number(h) < 25 && Number(min) < 60 ? uraDneva(Number(h), Number(min)) : m)],
  // Decimalno število z vejico: »2,5« → »dve cela pet«, »0,05« → »nič cela nič pet« (kot stevilke.py).
  [/(?<![\d.,])(\d{1,6}),(\d{1,3})(?![\d,]|\.\d)/g,
    (_m, celo, dec) => `${poSpolu(Number(celo), 'z')} ${cela(Number(celo))} ${dec.startsWith('0') ? stevke(dec) : stevnik(Number(dec))}`],
  // »po 7 postajališčih« → »po sedmih postajališčih« (mestnik).
  [new RegExp(`(^|[^${L}\\d])(po) (\\d{1,3}) (postajališč${L}*)`, 'giu'),
    (_m, pre, po, n, b) => `${pre}${po} ${mestnik(Number(n), 's')} ${b}`],
  // Razpon: »od 6 do 14 let« → »od šestih do štirinajstih let« (oba v rodilniku).
  [new RegExp(`(^|[^${L}\\d])(od) (\\d{1,3}) do (\\d{1,3})(?![\\d:,.])`, 'giu'),
    (_m, pre, od, a, b) => `${pre}${od} ${rodilnik(Number(a))} do ${rodilnik(Number(b))}`],
  // »do 25 kilometrov« → »do petindvajsetih kilometrov« (rodilnik); velja za vsako enoto za »do«.
  [new RegExp(`(^|[^${L}\\d])(do) (\\d{1,3}) (kilometr${L}*|metr${L}*|let|minut|ur)(?![${L}])`, 'giu'),
    (_m, pre, d, n, b) => `${pre}${d} ${rodilnik(Number(n), spolBesede(b) ?? 'm')} ${b}`],
  // Število pred znanim samostalnikom: spol po besedi (»ena stopinja«, »en prestop«, »dve leti«).
  // Tožilnik ženskega spola (»eno minuto«) prepoznamo po končnici -o.
  [new RegExp(`(?<![\\d.,:${L}])(\\d{1,6}) (${L}{2,})`, 'gu'),
    (m, n, b) => {
      const spol = spolBesede(b);
      return spol === null || (n.length > 1 && n.startsWith('0')) ? m : `${poSpolu(Number(n), spol, /o$/.test(b))} ${b}`;
    }],
  // Vse drugo: številka z vodilno ničlo ali predolga gre po števkah (koda linije
  // »N0701«), sicer glavni števnik (»Predlog 2:« → »Predlog dva:«).
  [/\d+/g, (n) => (n.length > 6 || (n.length > 1 && n.startsWith('0')) ? stevke(n) : stevnik(Number(n)))],
];

/** Besedilo brez števk. Besedilo, v katerem števk ni, vrne nespremenjeno. */
export function vBesede(besedilo) {
  let s = String(besedilo ?? '');
  if (!/\d/.test(s)) return s;
  // Črka tik ob številu (»N0701«, »4a«) dobi presledek, da števnik ne zraste z besedo.
  s = s.replace(new RegExp(`(${L})(\\d)`, 'gu'), '$1 $2').replace(new RegExp(`(\\d)(${L})`, 'gu'), '$1 $2');
  for (const [re, fn] of PRAVILA) s = s.replace(re, fn);
  return s.replace(/\s+/g, ' ').trim();
}
