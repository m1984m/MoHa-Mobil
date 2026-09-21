import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// Verzija iz package.json — release.ts jo bere prek __APP_VERSION__, da se
// "Različica" v Nastavitvah in UpdateToast ne razideta s package.json.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// Kratek SHA gradnje — isti, kot ga build-sw.mjs vzidava v sw.js. Analitika ga
// javi ob zagonu, zato se vidi, katera gradnja pri ljudeh res tece (service
// worker zna postreci staro se dolgo po objavi).
let sha = 'dev'
try {
  sha = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
} catch {
  // ni gita ali ni repozitorija — ostane 'dev'
}

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  base: process.env.NODE_ENV === 'production' ? '/MoHa-Mobil/' : '/',
  server: { port: 9125, host: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_SHA__: JSON.stringify(sha) },
})
