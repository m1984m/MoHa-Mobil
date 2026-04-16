# MoHa Mobil — Changelog

Vsi pomembnejši popravki in novosti, urejeno od najnovejšega proti najstarejšemu.
Različice sledijo [SemVer](https://semver.org/lang/sl/): `MAJOR.MINOR.PATCH`.

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
