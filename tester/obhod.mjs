/**
 * Obhod aplikacije na pravi napravi Android.
 *
 * Kaj naredi: nastavi izbrano stanje (tema, način za starejše, širina zaslona,
 * ponarejeni odgovori zaledja), prehodi vse zavihke, na vsakem naredi posnetek
 * in izlušči besedilo, na koncu pa zapiše `izpis.json`.
 *
 * Dvoje dela hkrati:
 *   - **trde preveritve**, ki jih zna stroj: besedilo, ki uhaja iz okvirja,
 *     napake v konzoli, `undefined`/`NaN` na zaslonu, prazni zasloni;
 *   - **posnetke za presojo**, ker ali je stavek dober, stroj ne ve.
 *
 * Uporaba:
 *   node obhod.mjs --scenarij zamuda --tema dark --starejsi --sirina 320
 *   node obhod.mjs --vse                # vsi scenariji v privzeti različici
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { odpri, nastaviSirino, pocakaj } from './naprava.mjs';
import { prestrezi, SCENARIJI } from './scenariji.mjs';

const tu = dirname(fileURLToPath(import.meta.url));
const URL_APP = process.env.MM_URL || 'https://m1984m.github.io/MoHa-Mobil/';

const ZAVIHKI = [
  { id: 'home',       label: 'Dom' },
  { id: 'timetables', label: 'Vozni redi' },
  { id: 'map',        label: 'Karta' },
  { id: 'fav',        label: 'Priljub.' },
  { id: 'settings',   label: 'Nastav.' },
];

// Maribor, Glavni trg — da »najbližja postajališča« sploh kaj vrnejo.
const LOKACIJA = { latitude: 46.5580, longitude: 15.6455, accuracy: 20 };

function argumenti() {
  const a = process.argv.slice(2);
  const vzemi = (ime, privzeto) => {
    const i = a.indexOf('--' + ime);
    return i === -1 ? privzeto : a[i + 1];
  };
  return {
    scenarij: vzemi('scenarij', 'zivo'),
    tema: vzemi('tema', 'light'),
    starejsi: a.includes('--starejsi'),
    sirina: Number(vzemi('sirina', 411)),
    vse: a.includes('--vse'),
  };
}

/**
 * Nastavitve zapišemo naravnost v localStorage in stran znova naložimo.
 * Klikanje skozi Nastavitve bi preizkušalo nastavitve, ne zaslonov, in bi ob
 * vsaki spremembi vmesnika odpovedalo.
 */
async function nastavi(stran, { tema, starejsi }) {
  await stran.evaluate(([t, s]) => {
    localStorage.setItem('mmob-theme', t);
    localStorage.setItem('mm.seniorMode.v1', JSON.stringify(s));
    localStorage.setItem('mm.analytics.v1', 'false');   // obhod ne sme šteti kot uporaba
  }, [tema, starejsi]);
  await stran.reload({ waitUntil: 'domcontentloaded' });
  await pocakaj(2500);
}

/** Besedilo zaslona, brez skritih vozlišč — to je tisto, kar uporabnik res vidi. */
async function besedilo(stran) {
  return stran.evaluate(() => {
    const ven = [];
    const hodi = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return;
      for (const o of el.childNodes) {
        if (o.nodeType === 3) {
          const t = o.textContent.trim();
          if (t) ven.push(t);
        } else if (o.nodeType === 1) hodi(o);
      }
    };
    hodi(document.body);
    return ven;
  });
}

/** Elementi, ki segajo čez širino zaslona ali jim vsebina uhaja iz okvirja. */
async function uhajanje(stran) {
  return stran.evaluate(() => {
    const sirina = document.documentElement.clientWidth;
    const najdbe = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cez = Math.round(r.right - sirina);
      const levo = Math.round(-r.left);
      // Odrezano besedilo je napaka samo, kadar je odrezano TIHO. Vrstica s
      // tremi pikicami (`text-overflow: ellipsis`) je namerna in uporabniku
      // pove, da je besedila več; drsni element (`overflow-x: auto`) tudi.
      // Brez te ločnice obhod javi vsako skrajšano ime postaje in je neuporaben.
      const tihoOdrezano = el.scrollWidth - el.clientWidth > 2
        && s.overflowX === 'hidden'
        && s.textOverflow !== 'ellipsis'
        && (el.textContent || '').trim().length > 0;
      if (cez > 2 || levo > 2 || tihoOdrezano) {
        const razred = (el.className && typeof el.className === 'string')
          ? '.' + el.className.split(/\s+/).slice(0, 2).join('.')
          : '';
        najdbe.push({
          kaj: el.tagName.toLowerCase() + razred,
          cezDesno: cez > 2 ? cez : 0,
          cezLevo: levo > 2 ? levo : 0,
          tihoOdrezano,
          besedilo: (el.textContent || '').trim().slice(0, 60),
        });
      }
    }
    return najdbe;
  });
}

const SUMLJIVO = /\b(undefined|null|NaN|Infinity)\b|\[object Object\]/;

/**
 * Posnetek delamo prek CDP in ne s `page.screenshot()`.
 *
 * Playwright si pred svojim posnetkom nastavi lastne mere zaslona, kar se bije
 * z našim `Emulation.setDeviceMetricsOverride` na ločeni seji — posnetek se
 * takrat ne konča nikoli in odpove po tridesetih sekundah. Klic `captureScreenshot`
 * po isti seji, ki je mere nastavila, tega spora nima.
 */
async function posnemi(seja, pot) {
  const { data } = await seja.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(pot, Buffer.from(data, 'base64'));
}

async function obisci(stran, seja, mapa, zap, ime) {
  await pocakaj(1200);
  const datoteka = String(zap).padStart(2, '0') + '-' + ime + '.png';
  await posnemi(seja, resolve(mapa, datoteka));
  const t = await besedilo(stran);
  return {
    zaslon: ime,
    posnetek: datoteka,
    besedilo: t,
    sumljivo: t.filter(x => SUMLJIVO.test(x)),
    uhajanje: await uhajanje(stran),
  };
}

async function enObhod(nastavitve) {
  const { scenarij, tema, starejsi, sirina } = nastavitve;
  const oznaka = scenarij + '-' + tema + (starejsi ? '-starejsi' : '') + '-' + sirina;
  const mapa = resolve(tu, 'posnetki', oznaka);
  rmSync(mapa, { recursive: true, force: true });
  mkdirSync(mapa, { recursive: true });

  const { brskalnik, stran } = await odpri(URL_APP);
  const napakeKonzole = [];
  stran.on('console', m => { if (m.type() === 'error') napakeKonzole.push(m.text()); });
  stran.on('pageerror', e => napakeKonzole.push('pageerror: ' + e.message));

  const seja = await nastaviSirino(stran, sirina);
  try {
    await seja.send('Browser.grantPermissions', {
      permissions: ['geolocation'],
      origin: new URL(URL_APP).origin,
    });
    await seja.send('Emulation.setGeolocationOverride', LOKACIJA);
  } catch { /* brez lokacije je tudi stanje, ki ga je vredno videti */ }

  const stevec = await prestrezi(stran, scenarij);
  await nastavi(stran, nastavitve);

  const zasloni = [];
  let zap = 1;
  for (const z of ZAVIHKI) {
    try {
      await stran.locator('[aria-label="' + z.label + '"]').first().click({ timeout: 8000 });
    } catch (e) {
      zasloni.push({ zaslon: z.id, napaka: 'zavihka ni bilo mogoce klikniti: ' + e.message.split('\n')[0] });
      continue;
    }
    zasloni.push(await obisci(stran, seja, mapa, zap++, z.id));
  }

  // Nazaj na Dom in odpri prvo postajališče — list postaje je zaslon, kjer se
  // zamuda in zasilni odgovor sploh pokažeta.
  try {
    await stran.locator('[aria-label="Dom"]').first().click({ timeout: 8000 });
    await pocakaj(1500);
    const vrstica = stran.locator('button, [role="button"]')
      .filter({ hasText: /\d{1,2}:\d{2}|min/ }).first();
    await vrstica.click({ timeout: 8000 });
    zasloni.push(await obisci(stran, seja, mapa, zap++, 'postajalisce'));
  } catch (e) {
    zasloni.push({ zaslon: 'postajalisce', napaka: 'ni bilo mogoce odpreti: ' + e.message.split('\n')[0] });
  }

  const izpis = {
    oznaka,
    naslov: URL_APP,
    ob: new Date().toISOString(),
    nastavitve,
    scenarij: { ime: scenarij, opis: SCENARIJI[scenarij].opis, prestrezenihKlicev: stevec.n },
    napakeKonzole,
    zasloni,
  };
  writeFileSync(resolve(mapa, 'izpis.json'), JSON.stringify(izpis, null, 2), 'utf8');
  await brskalnik.close();

  const uh = zasloni.reduce((n, z) => n + (z.uhajanje?.length ?? 0), 0);
  const su = zasloni.reduce((n, z) => n + (z.sumljivo?.length ?? 0), 0);
  console.log(oznaka + ': zaslonov ' + zasloni.length + ', uhajanj ' + uh
    + ', sumljivih nizov ' + su + ', napak v konzoli ' + napakeKonzole.length);
  return izpis;
}

const n = argumenti();
if (n.vse) {
  for (const s of Object.keys(SCENARIJI)) await enObhod({ ...n, scenarij: s });
} else {
  await enObhod(n);
}
