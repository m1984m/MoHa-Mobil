import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { updateAvailable } from './lib/update'

// iOS PWA viewport bug: na prvem zagonu 100dvh včasih vrne staro/pre-safe-area višino,
// zato se pojavi "prazna lisa" spodaj pod TabBar-om. Uporabniku pomaga šele rotacija
// landscape→portrait, ki prisili iOS v recompute. Fix: beleži pravo višino v CSS var
// `--app-height` iz visualViewport / innerHeight in jo uporabi kot primary height.
function setAppHeight() {
  const h = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${h}px`)
}
setAppHeight()
// Double-rAF + timeout za iOS, kjer se viewport stabilizira šele po prvem paint-u.
requestAnimationFrame(() => {
  requestAnimationFrame(setAppHeight)
  setTimeout(setAppHeight, 200)
  setTimeout(setAppHeight, 600)
})
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', () => setTimeout(setAppHeight, 300))
window.visualViewport?.addEventListener('resize', setAppHeight)
window.addEventListener('pageshow', setAppHeight)

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
    // Ali je stran že pod nadzorom SW. Ob prvem obisku clients.claim() sproži
    // controllerchange, ki je stran osvežil sredi vodiča (dotik se je izgubil, zagon se je
    // štel dvakrat; pregled 12.10.2026). Osvežitev je potrebna le ob ZAMENJAVI SW.
    let hadController = !!navigator.serviceWorker.controller
    // Poslušalec pred register(): prvi prevzem (clients.claim) lahko pride, še preden se
    // register() razreši — potem bi hadController ostal false in prva prava posodobitev
    // ne bi osvežila strani (pregled 12.10.2026).
    let reloading = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        // Prvi prevzem — nič ni zastarelo. Paket in vozni red sta se naložila mimo SW,
        // zato mu jih pošljemo v predpomnilnik (sicer drugi zagon brez povezave ne dela).
        hadController = true
        try {
          const urls = performance.getEntriesByType('resource')
            .map(e => e.name).filter(u => u.startsWith(location.origin))
          navigator.serviceWorker.controller?.postMessage({ type: 'CACHE_URLS', urls })
        } catch {}
        return
      }
      if (reloading) return
      reloading = true
      location.reload()
    })
    try {
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base })

      // Če je nov SW že waiting (npr. v prejšnji seji), javi takoj — a le če trenutna
      // stran kontroliran z nekim SW-jem (sicer ni prejšnje različice za nadomestiti).
      if (reg.waiting && navigator.serviceWorker.controller) {
        updateAvailable.set(reg.waiting)
      }

      const watch = (nw: ServiceWorker | null) => {
        if (!nw) return
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            updateAvailable.set(nw)
          }
        })
      }
      // Posodobitev, ki se je začela nameščati že pred koncem register() (updatefound je
      // takrat že mimo), prej v tej seji ni pokazala obvestila.
      watch(reg.installing)
      reg.addEventListener('updatefound', () => watch(reg.installing))

      // Po skipWaiting novi SW prevzame kontrolo — takrat poslušalec zgoraj osveži stran,
      // da se nov paket in predpomnilnik dejansko pokažeta.
    } catch {}
  })
}

export default app
