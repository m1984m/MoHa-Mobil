// Krožna linija: smer je »Krožna prek <kraj>« (gtfs.ts, splitHeadsign). Predlog
// »prek« zahteva rodilnik: »prek Tezna«, ne »prek Tezno«. Ime pride iz opisa
// vožnje v voznem redu v imenovalniku.
//
// Pravila za sklanjanje vseh imen ni (Tezno → Tezna, Gosposvetska → Gosposvetske,
// Pobrežje → Pobrežja, Studenci → Studencev), zato je tu slovar imen, ki se v opisih
// krožnih linij res pojavijo. Za ime, ki ga v slovarju ni, klicatelj sestavi smer
// brez sklona (»Krožna, prek postajališča …«) — raje daljše kot slovnično napačno.
//
// Brez uvozov, da modul bere tudi preverba v Node (scripts/test-krozna.mjs), ki
// primerja slovar z voznim redom in pade, ko nov vozni red prinese novo ime.
const RODILNIK: Record<string, string> = {
  // drugi del opisov krožne G3 (vozni red oktober 2026)
  'gosposvetska': 'Gosposvetske',
  'ptujska': 'Ptujske',
  'tezno': 'Tezna',
  // ostali deli istih opisov: če se vrstni red v opisu kdaj spremeni
  'jadranska': 'Jadranske',
  'pobrežje': 'Pobrežja',
  'prlek': 'Prleka',
  'tabor': 'Tabora',
};

/** Ime za »prek« v rodilniku ali null, kadar imena ne poznamo. */
export function prekRodilnik(kraj: string): string | null {
  const k = String(kraj ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('sl');
  return RODILNIK[k] ?? null;
}
