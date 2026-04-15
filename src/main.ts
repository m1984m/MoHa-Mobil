import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

// Poskus zaklepa orientacije na pokončno (deluje v PWA/fullscreen; ostali brskalniki tiho odpovejo).
try {
  const so: any = (screen as any).orientation;
  if (so && typeof so.lock === 'function') so.lock('portrait').catch(() => {});
} catch {}

// PWA service worker registration (production only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/')
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
  })
}

export default app
