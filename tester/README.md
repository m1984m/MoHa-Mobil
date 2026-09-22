# Tester — obhod aplikacije na napravi Android

Aplikacijo prehodi **pravi Chrome na pravem Androidu** (emulator), ne posnema
telefona na namizju. Na vsakem zaslonu naredi posnetek in izlušči besedilo, pri
tem pa lahko **ponaredi odgovore zaledja** — zamudo, izpad, zasilni odgovor —
torej stanja, ki jih z ročnim klikanjem skoraj ne ujameš.

Dvoje dela hkrati:

- **stroj** preveri, kar je merljivo: besedilo, ki sega čez rob zaslona ali je
  tiho odrezano, napake v konzoli, `undefined`/`NaN` na zaslonu;
- **človek ali agent** pogleda posnetke in presodi, kar merljivo ni: ali je
  stavek v slovenščini pravilen, ali je oznaka dvoumna, ali si dva podatka na
  istem zaslonu nasprotujeta.

## Zagon

```bash
node obhod.mjs                                   # živo zaledje, svetla tema, 411 px
node obhod.mjs --scenarij zamuda --tema dark --starejsi --sirina 320
node obhod.mjs --vse                             # vsi scenariji zapored
```

Emulator se zažene sam, če ne teče (`medium_phone`, Android 16). Prvi zagon
traja okoli minuto, vsak nadaljnji obhod približno enako.

Rezultat pristane v `posnetki/<scenarij>-<tema>[-starejsi]-<širina>/`:
posnetki `01-home.png` … in `izpis.json` z besedilom vsakega zaslona, najdbami
o postavitvi in napakami iz konzole. Mapa ni pod gitom.

## Scenariji

| Ime | Kaj ponaredi |
|---|---|
| `zivo` | nič — kar vrne pravo zaledje |
| `zamuda` | en avtobus zamuja 12 min, eden prehiteva, dvema vozilo ni dodeljeno |
| `brezZivih` | zaledje ne odgovarja; aplikacija mora pasti na vozni red in to povedati |
| `zasilni` | Worker postreže 95 s star odgovor (`X-Proxy-Cache: STALE`) |
| `prazno` | postajališče brez odhodov |
| `dolgaImena` | najdaljši resnični opisi linij — lovi besedilo, ki uide iz okvirja |

Odgovori v `vzorci/` so **pravi** odgovori Marproma, zajeti 22.09.2026.
Scenariji jih samo spremenijo, zato oblika ostane taka, kot jo zna vrniti izvor
— vključno s čudaškostmi, kot je `Description` s tremi presledki na koncu.

## Kako je povezano

Chrome na napravi odpre vtič `chrome_devtools_remote`, `adb forward` ga prestavi
na vrata 9222 tega računalnika, Playwright pa se nanj priklopi prek CDP. S tem
imamo na pravi napravi vse, kar sicer znamo v Playwrightu: branje besedila,
prestrezanje omrežja in posnetke zaslona.

### Pasti, ki so nas že ujele

- **Vtič se pojavi šele nekaj sekund po zagonu Chroma.** Prvi klic na 9222 pade;
  zato `pocakajNaVtic()` in ne takojšen poskus.
- **Slika sistema je produkcijska** (`google_apis_playstore`): `adb root` ne dela
  in `ro.debuggable` je 0. To ni ovira — vtič Chroma je na voljo tudi tam.
- **`page.screenshot()` iz Playwrighta obvisi**, ker si pred posnetkom nastavi
  lastne mere zaslona in se to bije z našim `Emulation.setDeviceMetricsOverride`
  na ločeni seji. Posnetek zato delamo s `Page.captureScreenshot` po isti seji.
- **Service worker postreže staro različico.** Pred vsakim obhodom ga odjavimo in
  počistimo predpomnilnike, sicer preizkušaš kodo izpred nekaj objav.
- **Nastavitve pišemo naravnost v `localStorage`**, ne klikamo skozi zaslon
  Nastavitve. Sicer bi obhod preizkušal nastavitve namesto zaslonov in bi ob
  vsaki spremembi vmesnika odpovedal.
- **Odrezano besedilo je napaka samo, kadar je odrezano tiho.** Vrstica s tremi
  pikicami je namerna. Brez te ločnice obhod javi vsako skrajšano ime postaje in
  postane neuporaben.

## Česar ta obhod ne preveri

- Namestitve PWA in potisnih obvestil (gre skozi sistemska pogovorna okna).
- Dotika s prstom — klikamo prek CDP, ne prek zaslona na dotik.
- Pravega omrežja: zaledje je ponarejeno povsod, razen v scenariju `zivo`.
