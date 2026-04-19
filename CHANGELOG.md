# MoHa Mobil — Changelog

Vsi pomembnejši popravki in novosti, urejeno od najnovejšega proti najstarejšemu.
Različice sledijo [SemVer](https://semver.org/lang/sl/): `MAJOR.MINOR.PATCH`.

---

## 0.5.1 — 2026-04-19

### Popravki
- **Long-press na karti zdaj deluje na iOS Safari.** Prej je koda poslušala samo `mousedown`, ki ga Android Chrome sintetizira iz `touchstart`, iOS pa ga emuilira šele po `touchend` — 550 ms timer ni mogel steči. Dodan je `touchstart` + `touchmove` handler v MapLibre listenerje, z isto logiko kot mouse. Multi-touch (pinch) takoj prekliče long-press timer.
- **Callout meni na iOS ne prekinja več dolgega pritiska.** `-webkit-touch-callout: none` + `user-select: none` na map containerju in `.maplibregl-canvas` prepreči native iOS gesto za izbiro/kopiranje.

### Opomba za iPhone testerje
Za **full-screen PWA izkušnjo** (brez Safari toolbar-a) mora biti aplikacija dodana na začetni zaslon: Safari → Deli → "Dodaj na začetni zaslon" → odpri ikono. Meta `apple-mobile-web-app-capable` deluje samo v tem načinu; v Safari brskalniku toolbar ostane vidnj vedno (iOS omejitev).

---

## 0.5.0 — 2026-04-19

### Novosti
- **Gumb »Pot do postaje«** — v panelu izbrane postaje primaren (accent) gumb, ki takoj odpre planer z pred-izpolnjenim ciljem in `from = Moja lokacija`, nato **auto-run**. Iz 4+ tapov v 2-tap shortcut.
- **Dolg pritisk na mapo (≈550 ms) postavi cilj** — long-press na prazni točki propagira v planer kot destinacija; Nominatim reverse-geocode v ozadju zamenja `Izbrana lokacija (lat, lon)` z naslovom. `from` auto-filled + auto-run.
- **Tap na mapo zapre izbrano postajo** — prej samo X gumb; zdaj hitrejša navigacija med postajami.
- **Vrnitev na prejšnji pogled ob deselect postaje** — ob izbiri zapomni `{center, zoom}`, ob deselect flyTo nazaj. Ohranjeno pri preklopu med postajami (vedno vrne na izvirno stanje).
- **Pinch-zoom na mobilnih** — odstranjen `maximum-scale=1` iz viewport meta; end-user lahko povečuje zemljevid/UI.
- **Retry UI, če GTFS ne naloži** — namesto večne skeleton-ce uporabnik vidi polzaslonski overlay z gumbom "Poskusi ponovno".
- **Datum voznih redov v nastavitvah** — "Vozni redi: <datum>"; opozorilna barva, če so starejši od 30 dni (odhodi znani nadskritijo).

### Popravki
- **GTFS fetch retry deluje** — prej cache-an rejected Promise je blokiral vse naknadne poskuse; zdaj ob napaki počisti cache in dovoli nov poskus.

### Hitrost / interno
- **Planer indeksi precompute (WeakMap)** — Haversine O(n²) ≈ 206k izračunov za 454 postaj se naredi enkrat na GTFS objekt, ne ob vsakem klicu. `nearByStop` + `tripsByBoardStop` kešana po identiteti objekta.
- **Transfer penalty 180 s + Pareto prag 60 s** — prejšnji 120 s prag je včasih proglasil 2-linijske plane za "boljše", ker so prišli 90 s prej. Z penalizacijo prestopov in tesnejšim pragom prevladuje direktna povezava.
- **Service filter v RAPTOR inner loop** — preskoči trip-e nevaljavnih dnevov takoj, ne ob zbiranju rezultatov.
- **AbortController v planerju** — zapiranje modal-a / nov run prekine odprte `walkMatrix`/`walkRoute` fetche; stale rezultati se ne commit-ajo.
- **Auto-versioning SW** — `scripts/build-sw.mjs` generira `public/sw.js` iz template-a ob vsakem `predev`/`prebuild` z `VERSION = pkg.version-SHA`. Testerji dobijo sveže SW brez ročnega bumpanja; `public/sw.js` zdaj `.gitignore`-an.
- **`getCenter()` / `getZoom()` exposed v MapView** — za snapshot/restore logic.

### Varnost / infrastruktura
- **Nominatim User-Agent** bump na `MoHaMobil/0.5.0`.

---

## 0.4.0 — 2026-04-17

### Novosti
- **Velikost napisov na zemljevidu** — 3 stopnje (Manjši / Srednji / Večji) v Nastavitve → Karta.
- **Imena cest na satelitu** — CARTO Voyager symbol layers zmergeani prek Esri raster podlage, bel tekst s temnim obrisom za kontrast.
- **Napisi vidni prej** — `minzoom − 2` (min 2), da se imena ulic pojavijo pri nižjih zoom stopnjah.
- **Dostopnostni temi**:
  - **Visoki kontrast** (čisto bela podlaga, črn tekst, debele obrobe) — za slabovidne.
  - **Črno-belo / Monochrome** (grayscale `filter: grayscale(1)` na `#app`) — za uporabnike, ki ne razlikujejo barv.
  - Privzeta tema: **svetla** (prej auto).
- **Odhodi — izbira prikaza**: samo minute, samo ura, ali oboje (`DepartureDisplay` nastavitev + unified `DepartureTime.svelte` komponenta).
- **Kompakten seznam** — manjše višine vrstic, več vsebine na ekran (`compactLists` nastavitev).
- **Zvezdica ob izbrani postaji v LineTimetableModal** — hitro pripni kombinacijo `(postaja, linija, smer)` za dostop iz zavihka Priljubljeni.
- **Pripete linije vertikalno** — v priljubljenih postajah so chipi za pripete linije razporejeni navpično (namesto vodoravnega drsnega traku).

### Popravki
- Gumb »Omogoči lokacijo« — bela pisava na rdeči podlagi (prej črna, neberljiva).
- SW cache bump `v3 → v4` — osveži zastarele CARTO stile in GTFS po nadgradnji.

### Varnost / infrastruktura
- **Nominatim User-Agent** — dodan `MoHaMobil/0.4.0 (github.com/m1984m/MoHa-Mobil)` header; skladno z Nominatim usage policy, prepreči ban.

### Interno
- `MapView.extractLabelLayers()` — izlušči simbole iz Voyagerja, skipa POI/icon source-layers, skalira `text-size` z `['*', factor, val]` ekspresijo.
- `styleKey(dark, kind, lsize)` — trojni ključ, sproži `setStyle()` reload ob spremembi velikosti napisov.
- Nov `favLines.ts` store (`mm.favLines.v1`) za pripete `(stopId, routeId, dir)` kombinacije.
- `theme.ts` razširjen iz 3 → 5 tem, `THEME_CLASSES` array prepreči class leakage ob preklopu.

---

## 0.3.0 — april 2026

### Novosti
- Natančnejše animacije avtobusov (GTFS schedule + OBA GPS anchor hibrid) in pešpoti.
- Priljubljene postaje: swipe za izbris, pripete linije.
- Več nastavitev za osebno prilagoditev.

### Interno
- Hibridna interpolacija vozil: bus napreduje po voznem redu, OBA GPS služi kot anchor za offset.
- ORS (OpenRouteService) foot-walking matrix za pre-fetch realnih časov hoje v planerju.
- `startPolling()` — setInterval poll (8s) + `requestAnimationFrame` loop za smooth prikaz.

---

## 0.2.0 — marec 2026 (prvi javni deploy)

### Funkcionalnost
- Prva javna objava na GitHub Pages: https://m1984m.github.io/MoHa-Mobil/
- Zavihki: Dom, Vozni redi, Karta, Priljubljeni, Nastavitve.
- MapLibre GL vector/raster render; CARTO Voyager (light) in Dark Matter (dark) podlage.
- GTFS Marprom (stops/routes/trips/service) + OBA live prihodi.
- Planer poti (RAPTOR algoritem) z OSRM/ORS pešpotmi.
- PWA — manifest, service worker, offline cache (GTFS + tiles).
- Shranjene poti, priljubljene postaje.
- Vremenski modal (Open-Meteo).

### Popravki pred deploy-em
- `crypto.randomUUID()` fallback za starejše mobile brskalnike.
- Nested `<button>` napaka v priljubljenih (accessibility).
- Double-tap zoom privzeto onemogočen (prepreči zoom ob tap-ih).
- Deploy skript `npm run deploy` (GitHub Pages `gh-pages` branch).

---

## Referenca

- **Slog različic**: 0.x.y — `MAJOR` ostane 0 do stabilne prve izdaje; `MINOR` za nove funkcionalnosti; `PATCH` za popravke.
- **Format tega dokumenta**: ohranjaj obratno kronološki vrstni red, vsaka različica ima ISO datum + sekcije `Novosti / Popravki / Varnost / Interno` (uporabi samo tiste, ki so relevantne).
- **UI Novosti sekcija** (`SettingsScreen.svelte → Novosti`): prikaže le **zadnjo različico**, **največ 4 bullete**. Zgodovina živi tukaj.
