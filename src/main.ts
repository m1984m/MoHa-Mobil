import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { updateAvailable } from './lib/update'

const app = mount(App, {
  target: document.getElementById('app')!,
})

// Poskus zaklepa orientacije na pokončno (deluje v PWA/fullscreen; ostali brskalniki tiho odpovejo).
try {
  const so: any = (screen as any).orientation;
  if (so && typeof so.lock === 'function') so.lock('portrait').catch(() => {});
} catch {}

// PWA service worker registration (production only).
// Ob zaznani novi različici pokažemo UpdateToast (bullet lista sprememb + Osveži zdaj).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/')
    try {
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })

      // Če je nov SW že waiting (npr. v prejšnji seji), javi takoj — a le če trenutna
      // stran kontroliran z nekim SW-jem (sicer ni prejšnje različice za nadomestiti).
      if (reg.waiting && navigator.serviceWorker.controller) {
        updateAvailable.set(reg.waiting)
      }

      reg.addEventListener('updatefound', () => {
        const nw = reg.installing
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            updateAvailable.set(nw)
          }
        })
      })

      // Po skipWaiting novi SW prevzame kontrolo — takrat reloadamo, da se nov bundle
      // in cache dejansko pokažeta. Guard prepreči zanko pri razvojnem menjavanju.
      let reloading = false
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return
        reloading = true
        location.reload()
      })
    } catch {}
  })
}

export default app
