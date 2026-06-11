import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

// Verzija iz package.json — release.ts jo bere prek __APP_VERSION__, da se
// "Različica" v Nastavitvah in UpdateToast ne razideta s package.json.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  base: process.env.NODE_ENV === 'production' ? '/MoHa-Mobil/' : '/',
  server: { port: 9125, host: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})
