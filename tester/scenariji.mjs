/**
 * Stanja, ki jih z ročnim klikanjem skoraj ne ujameš.
 *
 * Živih podatkov ne moreš naročiti: avtobus ali zamuja ali ne. Prav zamuda,
 * izpad in zasilni odgovor pa so tista stanja, v katerih se aplikacija najlaže
 * zlaže — zato jih tu ponaredimo in pogledamo, kaj piše na zaslonu.
 *
 * Odgovori v `vzorci/` so PRAVI odgovori Marproma, zajeti 22.09.2026, ne
 * izmišljeni. Scenariji jih samo spremenijo, zato oblika ostane taka, kot jo
 * zna vrniti izvor — vključno s čudaškostmi, kot je `Description` s tremi
 * presledki na koncu.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const tu = dirname(fileURLToPath(import.meta.url));
const vzorec = (ime) => JSON.parse(readFileSync(resolve(tu, 'vzorci', ime), 'utf8'));

const LINIJE = vzorec('GetLines.json');
const VOZILA = vzorec('GetActiveDeviceDetails.json');
const PRIHODI = vzorec('Arrivals-406.json');

/**
 * Zgradi seznam odhodov iz enega pravega zapisa. Zvečer vrne Marprom po en sam
 * odhod na postajališče, za pregled postavitve pa je treba videti poln seznam —
 * in prav tako dolge opise linij, ki so najpogostejši vzrok, da besedilo uide.
 */
function odhodi(opisi) {
  const p = PRIHODI.ArrivalsForStopPoints[0];
  const zdaj = new Date();
  return opisi.map((o, i) => {
    const cas = new Date(zdaj.getTime() + (o.cez + (o.zamuda ?? 0)) * 60000);
    return {
      ...p,
      Description: `${o.koda} ${o.smer}`,
      LineId: 70 + i,
      LineCode: o.koda,
      LineDescription: o.smer,
      ArrivalTime: `${String(cas.getHours()).padStart(2, '0')}:${String(cas.getMinutes()).padStart(2, '0')}`,
      ETAMin: o.cez,
      ...(o.zamuda === undefined ? {} : { DelayMin: o.zamuda }),
      BusCode: o.vozilo === false ? '' : String(100 + i),
    };
  });
}

const OVOJ = (seznam) => ({ Response: { Date: new Date().toISOString(), Status: 1, Message: 'OK' }, ArrivalsForStopPoints: seznam });

/**
 * Isti odgovor za vsa postajališča bi bil zavajajoč: na zaslonu bi se pokazali
 * dve enaki kartici in človek bi mislil, da aplikacija podvaja. Zato seznam
 * zavrtimo in čase zamaknemo glede na številko postajališča.
 */
function poPostaji(seznam, url) {
  const id = Number(url?.searchParams?.get('stopPointId') ?? 0) || 0;
  const zamik = id % seznam.length;
  const zavrten = [...seznam.slice(zamik), ...seznam.slice(0, zamik)];
  return zavrten.map((o, i) => ({ ...o, ETAMin: o.ETAMin + (id % 4) + i }));
}

const MESANO = odhodi([
  { koda: '6',   smer: 'Razvanje - Pobrežje', cez: 2,  zamuda: 0 },
  { koda: '3',   smer: 'Center - Studenci - Limbuš - Pekre', cez: 7, zamuda: 12 },
  { koda: 'P13', smer: 'Poštni center Tezno - Avtobusna postaja', cez: 14, zamuda: -3 },
  { koda: '20',  smer: 'Vinarje - Melje - Center - Nova vas', cez: 23, vozilo: false },
  { koda: '2',   smer: 'Dogoše - Center - Tabor', cez: 41, vozilo: false },
]);

/**
 * Vsak scenarij pove, kako naj Worker odgovori. `null` pomeni, da se ne
 * vmešavamo in gre klic na pravo zaledje.
 */
export const SCENARIJI = {
  zivo: {
    opis: 'brez vmešavanja — kar vrne pravo zaledje',
    odgovori: null,
  },

  zamuda: {
    opis: 'en avtobus zamuja 12 minut, eden prehiteva, dvema vozilo ni dodeljeno',
    odgovori: {
      GetArrivalsForStopPoint: (url) => ({ status: 200, telo: OVOJ(poPostaji(MESANO, url)) }),
    },
  },

  brezZivih: {
    opis: 'zaledje ne odgovarja — aplikacija mora pasti na vozni red in to povedati',
    odgovori: {
      GetArrivalsForStopPoint: () => ({ status: 502, telo: { error: 'upstream unreachable', via: 'direct' } }),
      GetActiveDeviceDetails:  () => ({ status: 502, telo: { error: 'upstream unreachable', via: 'direct' } }),
    },
  },

  zasilni: {
    opis: 'Worker postreže 95 sekund star odgovor (X-Proxy-Cache: STALE)',
    odgovori: {
      GetArrivalsForStopPoint: (url) => ({
        status: 200,
        telo: OVOJ(poPostaji(MESANO, url)),
        glave: { 'X-Proxy-Cache': 'STALE', 'X-Proxy-Age': '95' },
      }),
    },
  },

  prazno: {
    opis: 'postajališče brez odhodov — pozno ponoči ali konec proge',
    odgovori: {
      GetArrivalsForStopPoint: () => ({ status: 200, telo: OVOJ([]) }),
    },
  },

  dolgaImena: {
    opis: 'najdaljši resnični opisi linij — lovi besedilo, ki uide iz okvirja',
    odgovori: {
      GetArrivalsForStopPoint: (url) => ({
        status: 200,
        telo: OVOJ(poPostaji(odhodi([
          { koda: 'P13', smer: 'Poštni center Tezno - Ptujska - Titova - Partizanska - Avtobusna postaja', cez: 3, zamuda: 17 },
          { koda: '21',  smer: 'Zgornje Radvanje - Studenci - Center - Pobrežje - Dogoše - Malečnik', cez: 11, zamuda: 0 },
        ]), url)),
      }),
    },
  },
};

/** Priklopi prestrezanje na stran. Vrne število prestreženih klicev. */
export async function prestrezi(stran, imeScenarija) {
  const s = SCENARIJI[imeScenarija];
  if (!s) throw new Error('neznan scenarij: ' + imeScenarija);
  const stevec = { n: 0 };
  if (!s.odgovori) return stevec;

  await stran.route('**/oba/**', async (pot) => {
    const url = new URL(pot.request().url());
    const metoda = url.pathname.split('/').pop();
    const pravilo = s.odgovori[metoda];
    if (!pravilo) return pot.continue();

    const { status, telo, glave = {} } = pravilo(url);
    stevec.n++;
    await pot.fulfill({
      status,
      contentType: 'application/json; charset=utf-8',
      headers: { 'Access-Control-Allow-Origin': '*', ...glave },
      body: JSON.stringify(telo),
    });
  });

  return stevec;
}

export { LINIJE, VOZILA };
