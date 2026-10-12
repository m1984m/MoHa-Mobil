/// <reference types="svelte" />
/// <reference types="vite/client" />

// Iz vite.config.ts define — verzija aplikacije iz package.json.
declare const __APP_VERSION__: string;

// Kratek SHA gradnje (vite define) — glej vite.config.ts.
declare const __BUILD_SHA__: string;

// Različica voznega reda (meta.json `built`, vite define) — glej gtfs.ts.
declare const __GTFS_VER__: string;
