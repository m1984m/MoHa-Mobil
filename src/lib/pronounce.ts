// Izgovorjava okrajšav v imenih postajališč in smeri za glasno branje.
//
// Glas okrajšavo prebere dobesedno ("prol pika brigad", "zeta ge Duplek") ali jo
// črkuje ("te a be o er"). Pred branjem jo zato razpišemo. Na zaslonu ostane
// zapis iz voznega reda — spremeni se samo besedilo za glas.
//
// Seznam je sestavljen iz dejanskih imen v voznem redu Marproma (25.09.2026).
// Nova okrajšava: dodaj vrstico [zapis, izgovor]. Daljši zapisi naj bodo pred
// krajšimi, ki jih vsebujejo ("Ul. Poh. odr." pred "Ul.").
const WORDS: [string, string][] = [
  ['Prol. brigad', 'Proletarskih brigad'],
  ['Pro. brigad', 'Proletarskih brigad'],
  ['Ul. Poh. odr.', 'Ulica Pohorskega odreda'],
  ['Poh. odr.', 'Pohorskega odreda'],
  ['Ul. V. Vlahovića', 'Ulica Veljka Vlahovića'],
  ['Cesta XIV. divizije', 'Cesta štirinajste divizije'],
  ['XIV. divizije', 'štirinajste divizije'],
  ['II. gimn.', 'Druga gimnazija'],
  ['Teh. fakul.', 'Tehniška fakulteta'],
  ['dom st. obč.', 'dom starejših občanov'],
  ['dom st. občanov', 'dom starejših občanov'],
  ['Koš. dol', 'Košaški dol'],
  ['Mal. odc.', 'Malečnik odcep'],
  ['Pokop.', 'Pokopališče'],
  ['Energet.', 'Energetika'],
  ['Ljubljan.', 'Ljubljanska'],
  ['UK Gosp.', 'Štuk Gosposvetska'],
  ['Gosp.', 'Gosposvetska'],
  ['Zg.', 'Zgornji'],
  ['Sp.', 'Spodnji'],
  ['Ul.', 'Ulica'],
  ['ul.', 'ulica'],
  // Tuja imena: zapis → izgovor (Matej)
  ['Focheva', 'Foševa'],
  ['City', 'Siti'],
  ['Greenwich', 'Grinvič'],
  ['Maribox', 'Mariboks'],
  ['Ilicha', 'Iliha'],
  ['Teplyjevo', 'Teplijevo'],
  ['Teplyevo', 'Teplijevo'],
  ['Waldorfska', 'Valdorfska'],
  ['E.Leclerc', 'Leklerk'],
  ["E'Leclerc", 'Leklerk'],
  ['E. Leclerc', 'Leklerk'],
  ['ŽP', 'železniška postaja'],
  ['Žp', 'železniška postaja'],
  ['AP', 'avtobusna postaja'],
  ['OŠ', 'osnovna šola'],
  ['MČ', 'mestna četrt'],
  ['UKC', 'Univerzitetni klinični center'],
  ['GH', 'Garažna hiša'],
  ['TŠC', 'Tehniški šolski center'],
  ['TC', 'trgovski center'],
  ['ZD', 'zdravstveni dom'],
  ['GD', 'gasilski dom'],
  ['HE', 'hidroelektrarna'],
  ['CSD', 'center za socialno delo'],
  ['EPF', 'Ekonomsko-poslovna fakulteta'],
  ['TABOR', 'Tabor'],
  // Cenik
  ['P+R', 'parkiraj in se pelji'],
  ['IJPP', 'I J P P'],
  ['MOM', 'Mestne občine Maribor'],
  ['TIC', 'turistično informacijski center'],
  ['3DVA', 'Tri dva'],
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Meja besede brez lookbehind (starejši Safari ga ne pozna in bi ob nalaganju
// modula podrl aplikacijo): pred zapisom začetek ali ne-črka, za njim ne-črka.
const RULES = WORDS.map(([from, to]) => ({
  re: new RegExp(`(^|[^\\p{L}\\p{N}])${esc(from)}(?![\\p{L}\\p{N}])`, 'gu'),
  to,
}));

// Glavni števnik z besedo (0–999): 15 → "petnajst", 31 → "enaintrideset".
const ENICE = ['nič', 'ena', 'dva', 'tri', 'štiri', 'pet', 'šest', 'sedem', 'osem', 'devet',
  'deset', 'enajst', 'dvanajst', 'trinajst', 'štirinajst', 'petnajst', 'šestnajst', 'sedemnajst',
  'osemnajst', 'devetnajst'];
const DESETICE = ['', '', 'dvajset', 'trideset', 'štirideset', 'petdeset', 'šestdeset', 'sedemdeset',
  'osemdeset', 'devetdeset'];
export function numWords(n: number): string {
  if (n < 20) return ENICE[n];
  if (n < 100) {
    const e = n % 10, d = Math.floor(n / 10);
    return e ? `${ENICE[e]}in${DESETICE[d]}` : DESETICE[d];
  }
  const st = Math.floor(n / 100), r = n % 100;
  const sto = st === 1 ? 'sto' : st === 2 ? 'dvesto' : `${ENICE[st]}sto`;
  return r ? `${sto} ${numWords(r)}` : sto;
}

// Število pred minutami ali urami z besedo. Petra ga sicer sklanja sama in se zmoti
// ("Pojdi peš 12 minut" → "dvanajstih minut"). Ženski spol: ena/eno, dve.
function timeCount(n: number, unit: string): string {
  const r = n % 100;
  const head = n - r;                      // stotice ("sto", "dvesto" …) ostanejo
  const pre = head ? numWords(head) + ' ' : '';
  if (r === 1) return pre + (unit.endsWith('o') ? 'eno' : 'ena');
  if (r === 2) return pre + 'dve';
  return numWords(n);
}

// Ura dneva je vrstilni števnik v rodilniku: "od devete do trinajste ure".
const URA = ['ničte', 'prve', 'druge', 'tretje', 'četrte', 'pete', 'šeste', 'sedme', 'osme', 'devete',
  'desete', 'enajste', 'dvanajste', 'trinajste', 'štirinajste', 'petnajste', 'šestnajste', 'sedemnajste',
  'osemnajste', 'devetnajste', 'dvajsete', 'enaindvajsete', 'dvaindvajsete', 'triindvajsete', 'štiriindvajsete'];
const ura = (h: string) => URA[Number(h)] ?? h;

// Slovenska oblika ob številu: 1 evro, 2 evra, 3 evri, 5 evrov.
function form(n: number, f: [string, string, string, string]): string {
  const r = Math.abs(n) % 100;
  return r === 1 ? f[0] : r === 2 ? f[1] : r === 3 || r === 4 ? f[2] : f[3];
}
const EVRO: [string, string, string, string] = ['evro', 'evra', 'evri', 'evrov'];
const CENT: [string, string, string, string] = ['cent', 'centa', 'centi', 'centov'];

function euros(whole: string, cents = '00'): string {
  const e = Number(whole), c = Number(cents);
  const ep = `${e} ${form(e, EVRO)}`;
  return c ? `${ep} in ${c} ${form(c, CENT)}` : ep;
}

// Številke, ki jih glas sicer prebere napačno: razpon "6–14" (prebran kot "šest
// ena štiri"), cene z vejico in znakom €, ura "13 h".
const NUMBER_RULES: [RegExp, (...m: string[]) => string][] = [
  // "49 / 39 €" → "49 ali 39 evrov"
  [/(\d+)\s*\/\s*(\d+)\s*€/g, (_m, a, b) => `${a} ali ${euros(b)}`],
  // "1,50 €" → "1 evro in 50 centov", "13,00 €" → "13 evrov"
  [/(\d+),(\d{2})\s*€/g, (_m, e, c) => euros(e, c)],
  // "3 €" → "3 evri"
  [/(\d+)\s*€/g, (_m, e) => euros(e)],
  // "9–13 h" → "od devete do trinajste ure" (pred splošnim razponom)
  [/(\d{1,2})\s*[–-]\s*(\d{1,2})\s*h(?![\p{L}])/gu, (_m, a, b) => `od ${ura(a)} do ${ura(b)} ure`],
  // "6–14" ali "9-13" (ne ura 14:35 in ne datum) → "od 6 do 14"
  [/(^|[^\d:.,])(\d{1,3})\s*[–-]\s*(\d{1,3})(?![\d:])/g, (_m, pre, a, b) => `${pre}od ${a} do ${b}`],
  // "od 17 h dalje" → "od sedemnajste ure dalje"
  [/(\d{1,2})\s*h(?![\p{L}])/gu, (_m, h) => `${ura(h)} ure`],
  // "12 minut" → "dvanajst minut", "1 minuto" → "eno minuto", "2 minuti" → "dve minuti"
  [/(^|[^\p{L}\p{N},.:])(\d{1,3}) (minuto|minuti|minute|minut|minuta|uro|uri|ure|ur|ura)(?![\p{L}])/gu,
    (_m, pre, n, unit) => `${pre}${timeCount(Number(n), unit)} ${unit}`],
  // Oznaka linije ali postaje: "P15" je Petra brala po števkah, "pe 15" kot vrstilni
  // števnik ("petnajsti"), "ge" pa je pokvarilo izgovor črke. Pravilno (Matej): črka
  // ostane črka, število z besedo — "G šest", "P petnajst", "S enaintrideset".
  [/(^|[^\p{L}\p{N}])([A-ZČŠŽ])(\d{1,3})(?![\p{L}\p{N}])/gu, (_m, pre, l, n) => `${pre}${l} ${numWords(Number(n))}`],
];

export function forSpeech(text: string): string {
  let s = text;
  for (const r of RULES) s = s.replace(r.re, (_m, pre: string) => pre + r.to);
  for (const [re, fn] of NUMBER_RULES) s = s.replace(re, fn as (...a: string[]) => string);
  // Slovenski glas "ć" ne pozna in "Vlahovića" prebere kot "Vlahovija" — v
  // slovenščini se izgovori kot č (Matej). Enako đ kot dž. Po slovarju, ker so
  // njegovi vnosi zapisani kot v voznem redu (s ć).
  return s.replace(/ć/g, 'č').replace(/Ć/g, 'Č').replace(/đ/g, 'dž').replace(/Đ/g, 'Dž');
}
