<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import maplibregl, { Map } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import type { Stop, Shape } from './gtfs';
  import { MARIBOR } from './geo';

  export let stops: Stop[] = [];
  export let user: { lat: number; lon: number } | null = null;
  export let selectedId: number | null = null;
  export let nearbyIds: number[] = [];
  export let shapes: (Shape & { color: string })[] = [];
  export let planLegs: { kind: 'walk' | 'bus'; coords: [number, number][]; color: string }[] = [];
  export let planEndpoints: { lat: number; lon: number; kind: 'origin' | 'dest' }[] = [];
  export let vehicles: { lat: number; lon: number; color: string; routeShort: string; bearing: number }[] = [];
  export let mapStyle: 'map' | 'satellite' = 'map';
  export let onStopTap: (s: Stop) => void = () => {};
  export let onMapTap: (lat: number, lon: number) => void = () => {};
  export let onMapLongPress: (lat: number, lon: number) => void = () => {};
  export let onVehicleTap: (idx: number) => void = () => {};

  let el: HTMLDivElement;
  let map: Map;
  let styleReady = false;
  let lastDark: boolean | null = null;
  let lastStyleKey: string | null = null;

  function darkNow() { return document.documentElement.classList.contains('dark'); }
  function styleSpec(dark: boolean, kind: 'map' | 'satellite'): any {
    if (kind === 'satellite') {
      return {
        version: 8,
        sources: {
          sat: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Tiles © Esri',
          },
        },
        glyphs: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/{fontstack}/{range}.pbf',
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      };
    }
    // CARTO Voyager daje večji kontrast v svetlem načinu; Dark Matter za temo.
    return dark
      ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
      : 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  }
  function styleKey(dark: boolean, kind: 'map' | 'satellite') {
    return `${kind}:${dark ? 'd' : 'l'}`;
  }

  function stopsFC(s: Stop[]): any {
    return {
      type: 'FeatureCollection',
      features: s.map(x => ({
        type: 'Feature',
        id: x.id,
        properties: { id: x.id, name: x.name },
        geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
      })),
    };
  }

  function shapesFC(arr: (Shape & { color: string })[]): any {
    return {
      type: 'FeatureCollection',
      features: arr.map(s => ({
        type: 'Feature',
        properties: { id: s.id, color: s.color },
        geometry: { type: 'LineString', coordinates: s.pts.map(([lat, lon]) => [lon, lat]) },
      })),
    };
  }

  function nearbyFC(s: Stop[], ids: number[], selId: number | null): any {
    const set = new Set(ids);
    if (selId != null) set.delete(selId); // selected handled by its own layer
    return {
      type: 'FeatureCollection',
      features: s.filter(x => set.has(x.id)).map(x => ({
        type: 'Feature',
        properties: { id: x.id, name: x.name },
        geometry: { type: 'Point', coordinates: [x.lon, x.lat] },
      })),
    };
  }

  function selectedFC(s: Stop[], sel: number | null): any {
    const stop = sel != null ? s.find(x => x.id === sel) : null;
    return {
      type: 'FeatureCollection',
      features: stop ? [{
        type: 'Feature',
        properties: { id: stop.id },
        geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
      }] : [],
    };
  }

  function planFC(legs: { kind: 'walk' | 'bus'; coords: [number, number][]; color: string }[]): any {
    return {
      type: 'FeatureCollection',
      features: legs.map((l, i) => ({
        type: 'Feature',
        properties: { i, kind: l.kind, color: l.color },
        geometry: { type: 'LineString', coordinates: l.coords },
      })),
    };
  }

  function endpointsFC(eps: { lat: number; lon: number; kind: 'origin' | 'dest' }[]): any {
    return {
      type: 'FeatureCollection',
      features: eps.map(e => ({
        type: 'Feature',
        properties: { kind: e.kind },
        geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      })),
    };
  }

  function vehiclesFC(vs: { lat: number; lon: number; color: string; routeShort: string; bearing: number }[]): any {
    return {
      type: 'FeatureCollection',
      features: vs.map((v, i) => ({
        type: 'Feature',
        properties: { i, color: v.color, label: v.routeShort, bearing: v.bearing },
        geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
      })),
    };
  }

  function userFC(u: { lat: number; lon: number } | null): any {
    return {
      type: 'FeatureCollection',
      features: u ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [u.lon, u.lat] } }] : [],
    };
  }

  function addLayers() {
    if (!map || !map.isStyleLoaded()) return;
    const dark = darkNow();

    // Shapes (below stops)
    if (!map.getSource('shapes')) {
      map.addSource('shapes', { type: 'geojson', data: shapesFC(shapes) });
      map.addLayer({
        id: 'shapes-line-casing',
        type: 'line',
        source: 'shapes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': dark ? '#0b1220' : '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 7, 17, 10],
          'line-opacity': 0.9,
        },
      });
      map.addLayer({
        id: 'shapes-line',
        type: 'line',
        source: 'shapes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 4.5, 17, 7],
          'line-opacity': 0.95,
        },
      });
    }

    // Stops
    if (!map.getSource('stops')) {
      map.addSource('stops', { type: 'geojson', data: stopsFC(stops) });
      map.addLayer({
        id: 'stops-hit',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 14, 14, 18, 17, 22],
          'circle-color': '#000',
          'circle-opacity': 0,
        },
      });
      map.addLayer({
        id: 'stops-circle',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 14, 5, 17, 9],
          'circle-color': '#D32027',
          'circle-stroke-color': dark ? '#0b1220' : '#ffffff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.95,
        },
      });
    }

    // Nearby highlighted stops (below selected, above regular)
    if (!map.getSource('nearby')) {
      map.addSource('nearby', { type: 'geojson', data: nearbyFC(stops, nearbyIds, selectedId) });
      map.addLayer({
        id: 'nearby-hit',
        type: 'circle',
        source: 'nearby',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 16, 14, 20, 17, 24],
          'circle-color': '#000',
          'circle-opacity': 0,
        },
      });
      map.addLayer({
        id: 'nearby-circle',
        type: 'circle',
        source: 'nearby',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 7, 17, 11],
          'circle-color': '#ef4444',
          'circle-stroke-color': dark ? '#0b1220' : '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': 0.95,
        },
      });
    }

    // Selected stop (dedicated layer — always on top)
    if (!map.getSource('selected-stop')) {
      map.addSource('selected-stop', { type: 'geojson', data: selectedFC(stops, selectedId) });
      map.addLayer({
        id: 'selected-stop-halo',
        type: 'circle',
        source: 'selected-stop',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 14, 14, 20, 17, 26],
          'circle-color': '#ef4444',
          'circle-opacity': 0.22,
          'circle-blur': 0.3,
        },
      });
      map.addLayer({
        id: 'selected-stop-dot',
        type: 'circle',
        source: 'selected-stop',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 14, 11, 17, 15],
          'circle-color': '#ef4444',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });
    }

    // Plan overlay (above stops, below endpoints/user)
    if (!map.getSource('plan')) {
      map.addSource('plan', { type: 'geojson', data: planFC(planLegs) });
      map.addLayer({
        id: 'plan-casing',
        type: 'line',
        source: 'plan',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': dark ? '#0b1220' : '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 6, 14, 10, 17, 14],
          'line-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'plan-walk',
        type: 'line',
        source: 'plan',
        filter: ['==', ['get', 'kind'], 'walk'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': dark ? '#9ca3af' : '#4b5563',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 14, 5, 17, 7],
          'line-dasharray': [1.6, 1.4],
          'line-opacity': 0.95,
        },
      });
      map.addLayer({
        id: 'plan-bus',
        type: 'line',
        source: 'plan',
        filter: ['==', ['get', 'kind'], 'bus'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 4, 14, 6, 17, 9],
          'line-opacity': 0.98,
        },
      });
    }

    // Endpoints (origin / destination pins)
    if (!map.getSource('endpoints')) {
      map.addSource('endpoints', { type: 'geojson', data: endpointsFC(planEndpoints) });
      map.addLayer({
        id: 'endpoints-halo',
        type: 'circle',
        source: 'endpoints',
        paint: {
          'circle-radius': 18,
          'circle-color': ['case', ['==', ['get', 'kind'], 'origin'], '#10b981', '#e11d48'],
          'circle-opacity': 0.22,
          'circle-blur': 0.3,
        },
      });
      map.addLayer({
        id: 'endpoints-dot',
        type: 'circle',
        source: 'endpoints',
        paint: {
          'circle-radius': 9,
          'circle-color': ['case', ['==', ['get', 'kind'], 'origin'], '#10b981', '#e11d48'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });
    }

    // Vehicles (above stops/plan, below user)
    if (!map.getSource('vehicles')) {
      map.addSource('vehicles', { type: 'geojson', data: vehiclesFC(vehicles) });
      map.addLayer({
        id: 'vehicles-halo',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 8, 14, 13, 17, 18],
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.25,
          'circle-blur': 0.3,
        },
      });
      map.addLayer({
        id: 'vehicles-dot',
        type: 'circle',
        source: 'vehicles',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 7, 14, 11, 17, 15],
          'circle-color': ['get', 'color'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      });
      map.addLayer({
        id: 'vehicles-label',
        type: 'symbol',
        source: 'vehicles',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 14, 11, 17, 13],
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': ['get', 'color'],
          'text-halo-width': 1.2,
        },
        minzoom: 12,
      });
    }

    // User location (pulse + dot)
    if (!map.getSource('user')) {
      map.addSource('user', { type: 'geojson', data: userFC(user) });
      map.addLayer({
        id: 'user-pulse',
        type: 'circle',
        source: 'user',
        paint: {
          'circle-radius': 22,
          'circle-color': '#2563eb',
          'circle-opacity': 0.18,
          'circle-blur': 0.4,
        },
      });
      map.addLayer({
        id: 'user-dot',
        type: 'circle',
        source: 'user',
        paint: {
          'circle-radius': 7,
          'circle-color': '#2563eb',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
        },
      });
    }
  }

  onMount(() => {
    lastDark = darkNow();
    lastStyleKey = styleKey(lastDark, mapStyle);
    map = new maplibregl.Map({
      container: el,
      style: styleSpec(lastDark, mapStyle),
      center: [user?.lon ?? MARIBOR.lon, user?.lat ?? MARIBOR.lat],
      zoom: 13,
      attributionControl: { compact: true },
    });

    map.on('load', () => {
      styleReady = true;
      addLayers();
    });

    const stopClick = (e: any) => {
      const f = e.features?.[0];
      if (!f) return;
      const id = f.properties!.id as number;
      const s = stops.find(x => x.id === id);
      if (s) { e.originalEvent._stopConsumed = true; onStopTap(s); }
    };
    map.on('click', 'stops-hit', stopClick);
    map.on('click', 'stops-circle', stopClick);
    map.on('click', 'nearby-hit', stopClick);
    map.on('click', 'nearby-circle', stopClick);
    map.on('click', 'selected-stop-dot', stopClick);
    map.on('mouseenter', 'stops-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'stops-hit', () => (map.getCanvas().style.cursor = ''));
    map.on('mouseenter', 'nearby-hit', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'nearby-hit', () => (map.getCanvas().style.cursor = ''));

    // Base-map click (no stop under cursor) → emit lat/lon for origin update
    map.on('click', (e) => {
      if ((e.originalEvent as any)._stopConsumed) return;
      const hits = map.queryRenderedFeatures(e.point, { layers: ['stops-hit', 'nearby-hit', 'stops-circle', 'nearby-circle', 'selected-stop-dot'] });
      if (hits.length) return;
      onMapTap(e.lngLat.lat, e.lngLat.lng);
    });
    // Dvojni klik prepreči, da bi se ob zoomu sprožil še origin update.
    map.on('dblclick', (e) => { (e.originalEvent as any)._stopConsumed = true; });

    // Vehicle tap
    map.on('click', 'vehicles-dot', (e: any) => {
      const f = e.features?.[0];
      if (!f) return;
      e.originalEvent._stopConsumed = true;
      onVehicleTap(f.properties.i as number);
    });
    map.on('mouseenter', 'vehicles-dot', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'vehicles-dot', () => (map.getCanvas().style.cursor = ''));

    // Long-press (touch + mouse) on empty map → destination
    let lpTimer: any = null;
    let lpStart: { x: number; y: number } | null = null;
    const clearLP = () => { if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; } lpStart = null; };
    map.on('mousedown', (e) => {
      lpStart = { x: e.point.x, y: e.point.y };
      lpTimer = setTimeout(() => {
        if (!lpStart) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: ['stops-hit', 'nearby-hit', 'stops-circle', 'nearby-circle', 'selected-stop-dot', 'vehicles-dot'] });
        if (!hits.length) onMapLongPress(e.lngLat.lat, e.lngLat.lng);
        lpTimer = null;
      }, 550);
    });
    map.on('mousemove', (e) => {
      if (!lpStart) return;
      if (Math.hypot(e.point.x - lpStart.x, e.point.y - lpStart.y) > 8) clearLP();
    });
    map.on('mouseup', clearLP);
    map.on('touchend', clearLP);
    map.on('touchcancel', clearLP);
    map.on('dragstart', clearLP);

    const observer = new MutationObserver(() => {
      const nowDark = darkNow();
      if (nowDark === lastDark) return;
      lastDark = nowDark;
      swapStyle();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  });

  function swapStyle() {
    if (!map) return;
    const key = styleKey(lastDark ?? darkNow(), mapStyle);
    if (key === lastStyleKey) return;
    lastStyleKey = key;
    styleReady = false;
    map.setStyle(styleSpec(lastDark ?? darkNow(), mapStyle) as any);
    map.once('styledata', () => { styleReady = true; addLayers(); });
  }
  $: if (map && mapStyle && styleKey(lastDark ?? darkNow(), mapStyle) !== lastStyleKey) swapStyle();

  onDestroy(() => map?.remove());

  $: if (map && styleReady && map.getSource('stops')) {
    (map.getSource('stops') as any).setData(stopsFC(stops));
  }
  $: if (map && styleReady && map.getSource('selected-stop')) {
    (map.getSource('selected-stop') as any).setData(selectedFC(stops, selectedId));
  }
  $: if (map && styleReady && map.getSource('nearby')) {
    (map.getSource('nearby') as any).setData(nearbyFC(stops, nearbyIds, selectedId));
  }
  $: if (map && styleReady && map.getSource('shapes')) {
    (map.getSource('shapes') as any).setData(shapesFC(shapes));
  }
  $: if (map && styleReady && map.getSource('user')) {
    (map.getSource('user') as any).setData(userFC(user));
  }
  $: if (map && styleReady && map.getSource('plan')) {
    (map.getSource('plan') as any).setData(planFC(planLegs));
  }
  $: if (map && styleReady && map.getSource('endpoints')) {
    (map.getSource('endpoints') as any).setData(endpointsFC(planEndpoints));
  }
  $: if (map && styleReady && map.getSource('vehicles')) {
    (map.getSource('vehicles') as any).setData(vehiclesFC(vehicles));
  }

  export function fitBounds(coords: [number, number][]) {
    if (!map || coords.length === 0) return;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const [lon, lat] of coords) {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    const h = map.getContainer().clientHeight ?? 0;
    map.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
      padding: { top: 80, bottom: Math.round(h * 0.15), left: 40, right: 40 },
      duration: 700, maxZoom: 16,
    });
  }

  export function flyTo(lat: number, lon: number, zoom = 15) {
    const h = map?.getContainer().clientHeight ?? 0;
    // Account for bottom sheet covering ~45% of viewport: shift visible center upward.
    const padding = { top: 60, bottom: Math.round(h * 0.5), left: 20, right: 20 };
    map?.flyTo({ center: [lon, lat], zoom, duration: 600, padding });
  }
</script>

<div
  bind:this={el}
  style="position:absolute; inset:0; width:100%; height:100%; background: linear-gradient(135deg, var(--surface-2), var(--bg));">
</div>

<style>
  :global(.maplibregl-ctrl-attrib) { font-size: 10px; opacity: 0.7; }
  :global(.maplibregl-ctrl-top-right) { top: 4rem !important; }
</style>
