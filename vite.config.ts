import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  base: process.env.NODE_ENV === 'production' ? '/MoHa-Mobil/' : '/',
  server: { port: 9125, host: true },
})
