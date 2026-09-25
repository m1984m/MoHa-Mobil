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
  ['Koš. dol', 'Koševski dol'],
  ['Mal. odc.', 'Malečnik odcep'],
  ['Pokop.', 'Pokopališče'],
  ['Energet.', 'Energetika'],
  ['Ljubljan.', 'Ljubljanska'],
  ['Gosp.', 'Gosposvetska'],
  ['Zg.', 'Zgornji'],
  ['Sp.', 'Spodnji'],
  ['Ul.', 'Ulica'],
  ['ul.', 'ulica'],
  ['E.Leclerc', 'Leklerk'],
  ["E'Leclerc", 'Leklerk'],
  ['E. Leclerc', 'Leklerk'],
  ['ŽP', 'železniška postaja'],
  ['Žp', 'železniška postaja'],
  ['AP', 'avtobusna postaja'],
  ['OŠ', 'osnovna šola'],
  ['MČ', 'mestna četrt'],
  ['TŠC', 'Tehniški šolski center'],
  ['TC', 'trgovski center'],
  ['ZD', 'zdravstveni dom'],
  ['GD', 'gasilski dom'],
  ['HE', 'hidroelektrarna'],
  ['CSD', 'center za socialno delo'],
  ['EPF', 'Ekonomsko-poslovna fakulteta'],
  ['TABOR', 'Tabor'],
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Meja besede brez lookbehind (starejši Safari ga ne pozna in bi ob nalaganju
// modula podrl aplikacijo): pred zapisom začetek ali ne-črka, za njim ne-črka.
const RULES = WORDS.map(([from, to]) => ({
  re: new RegExp(`(^|[^\\p{L}\\p{N}])${esc(from)}(?![\\p{L}\\p{N}])`, 'gu'),
  to,
}));

export function forSpeech(text: string): string {
  let s = text;
  for (const r of RULES) s = s.replace(r.re, (_m, pre: string) => pre + r.to);
  return s;
}
