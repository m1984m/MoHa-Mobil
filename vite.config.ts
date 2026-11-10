import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
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

// Različica voznega reda (meta.json `built`) — gtfs.ts z njo naslavlja podatke
// (`trips.json?v=…`), da paket aplikacije in vozni red ne moreta biti iz različnih
// objav. V razvoju je treba strežnik po `npm run gtfs*` znova zagnati.
let gtfsVer = ''
try {
  gtfsVer = JSON.parse(readFileSync(new URL('./public/gtfs/meta.json', import.meta.url), 'utf8')).built ?? ''
} catch {
  // meta.json še ni zgrajen — podatki brez različice (stari naslovi)
}

// Jedro = vse, kar zacetna stran uvozi staticno. Brez te skupine Rolldown vsak modul, ki si
// ga jedro deli z odlozenim zaslonom (ikone, shrambe, majhne komponente), izloci v svojo
// datoteko: po odlogu Nastavitev, Opomnikov in Priljubljenih je zacetna stran prednalagala
// 35 datotek namesto 8 in prvi obisk je bil pocasnejsi (meritev 10.11.2026).
// Vtičnik po koncu gradnje grafa zbere staticno dosegljive module, skupina jih zlije v en kos.
const jedro = new Set<string>()
function jedroPlugin(): Plugin {
  return {
    name: 'mm-jedro',
    apply: 'build',
    buildStart() { jedro.clear() },
    buildEnd() {
      const vrsta: string[] = []
      for (const id of this.getModuleIds()) if (this.getModuleInfo(id)?.isEntry) vrsta.push(id)
      const videno = new Set(vrsta)
      while (vrsta.length) {
        for (const dep of this.getModuleInfo(vrsta.pop()!)?.importedIds ?? []) {
          if (videno.has(dep)) continue
          videno.add(dep); vrsta.push(dep)
          if (!/\.css($|\?)/.test(dep)) jedro.add(dep)
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [svelte(), tailwindcss(), jedroPlugin()],
  build: { rolldownOptions: { output: { codeSplitting: { groups: [{ name: 'jedro', test: (id: string) => jedro.has(id) }] } } } },
  base: process.env.NODE_ENV === 'production' ? '/MoHa-Mobil/' : '/',
  // .omc/ piše vtičnik oh-my-claudecode (project-memory.json.lock) večkrat na minuto;
  // brez izključitve je vsak zapis sprožil ponovno nalaganje strani v razvoju.
  server: { port: 9125, host: true, watch: { ignored: ['**/.omc/**'] } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_SHA__: JSON.stringify(sha), __GTFS_VER__: JSON.stringify(gtfsVer) },
})
