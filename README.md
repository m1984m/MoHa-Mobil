# MoHa Mobil

PWA za javni potniški promet Maribor (Marprom). Svelte 5 + Vite + MapLibre GL.

**Live:** https://m1984m.github.io/MoHa-Mobil/

## Razvoj

```bash
npm install
npm run dev        # http://localhost:9125
npm run check      # svelte-check + tsc
npm run build      # produkcijski build
npm run deploy     # build + push na gh-pages branch
```

## Viri podatkov

- **GTFS Marprom** — vozni redi in postajališča (lokalno preprocesirano v `public/gtfs/`)
- **Poligram** — realno-časovne pozicije avtobusov (prek Marprom OBA API)
- **OSRM** — peš routing (router.project-osrm.org)
- **Nominatim** — geokodiranje (OpenStreetMap)
- **Open-Meteo** — vreme
- **Carto / Esri** — mapne plasti

## Deploy

Deploy na GitHub Pages iz `gh-pages` branch-a. V repo Settings → Pages nastaviš Source na `gh-pages` / `/ (root)`.

## Licenca

Zasebni projekt. Vsi kartni podatki in GTFS feed so last ustreznih avtorjev.
