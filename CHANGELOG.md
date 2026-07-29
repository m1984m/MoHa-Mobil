# MoHa Mobil — Changelog

Vsi pomembnejši popravki in novosti, urejeno od najnovejšega proti najstarejšemu.
Različice sledijo [SemVer](https://semver.org/lang/sl/): `MAJOR.MINOR.PATCH`.

---

## 0.9.0 — 2026-07-30

Revizija UX/UI po celovitem pregledu (koda + živ test v brskalniku). Poudarek: berljivost časov, dostopnost in povratna sporočila uporabniku.

### Prikaz časov (enoten sistem, `src/lib/time.ts`)
- **Čas do odhoda se pretvori v ure oz. uro odhoda.** Prej je seznam odhodov izpisoval surove minute — ponoči je pisalo »296 min« namesto »05:11«. Pravilo: < 60 min → minute, 60–180 min → »2 h 15«, ≥ 180 min → ura odhoda. Velja na Domu, v Priljubljenih in v postajnem pogledu na Karti.
- **Odštevalnik »Kreni«** se skrije, ko je do odhoda več kot 30 minut (prej je pisalo »Kreni 277 min« v zeleni barvi, kar ni imelo vsebine).
- **»Danes ni več odhodov« ni več slepa ulica** — poišče se prvi odhod naslednjega dne s prometom (do 7 dni naprej, pokrije praznike in nedelje) in se prikaže z uro, linijo in smerjo.
- Vse pretvorbe časa so v enem modulu; prej so v isti kartici obstajali trije neodvisni formati.

### Napake in nedoslednosti
- **Privzeta tema je zdaj »Samodejno«** (prej trdo »Svetla«) — telefon v nočnem načinu je ponoči na postaji dobil bel zaslon.
- **Escape zapre vozne rede.** Poslušalec je bil na `div`-u, ki ni nikoli dobil fokusa; prestavljen na `<svelte:window>` (postajni in linijski vozni red, izbirnik linij).
- **Sistemski gumb »nazaj« na zavihku Vozni redi** zapre vozni red namesto aplikacije — ta zaslon je bil edini brez vezave na `backstack`.
- Slovnica: »Velja od **julija** 2026« (prej imenovalnik »julij« iz `Intl`).
- Popravljen manjkajoč presledek v »67 m stran · s227«.
- **»Počisti vse podatke« zdaj ponastavi tudi temo** — ključ `mmob-theme` se ne drži predpone `mm.` in je bil spregledan.
- Odstranjen diagnostični `console.log` ob vsakem pollu živih vozil.

### Povratna sporočila in nadzor
- **Razveljavitev brisanja** (skupen toast z gumbom »Razveljavi«): poteg v stran na priljubljeni postaji (vrne tudi pripete linije), brisanje shranjene poti, »Počisti« vse priljubljene.
- **Domači `confirm()` zamenjan** z lastnim potrditvenim oknom (priljubljene, brisanje podatkov).
- **Shranjene poti je mogoče preimenovati** (»Dom → Služba«) — funkcija je obstajala v shrambi, a je ni klical noben zaslon.
- **Opozorilo, ko pešpoti niso na voljo** — ob izpadu/kvoti ORS so časi hoje ocenjeni po zračni razdalji; načrt poti to zdaj pove namesto tihega podcenjevanja.

### Načrtovalec in karta
- **Predlogi v načrtovalcu se ne odrežejo več** — spustni seznam je bil absolutno pozicioniran znotraj vsebnika z `overflow-y: auto`, zato je bilo od 6 zadetkov vidnih 2,5.
- **Iskanje postaje po imenu na Karti** (lupa zgoraj desno) — prej je bil edini vstop tap po pikici na zemljevidu.
- Postajališči z istim imenom (par čez cesto) sta na Domu ločeni z namigom o smeri.
- Utripajoča zelena »živa« pika miruje in posivi, kadar podatki niso živi (prej je utripala tudi ob napisu »Po voznem redu«).

### Dostopnost
- Kartica postaje na Domu je razbita na naslovni gumb + gumbe po vrsticah; prej je bila en sam `<button>`, ki ga je bralnik zaslona prebral kot eno nerazumljivo oznako.
- Ujetje fokusa v modalih (`use:focusTrap`) + vračanje fokusa na element, ki je modal odprl.
- `aria-live` na kartici »Čakanje«, da bralnik javi osvežen čas.
- Vse okrogle tarče dotika povečane na 44 px (prej 36–40 px); naslov postaje in akcije v svojih vrsticah, da se dolga imena ne obrezujejo.
- Odseki dobili prave naslove (`<h2>`), pripis © Esri za satelitsko podlago, povezava na izvorno kodo.

### Notranje
- Nova skupna komponenta `StopBoard.svelte` — Dom je prej imel dva identična bloka za bližnje in priljubljene postaje (~35 vrstic podvojene predloge).
- Nova modula `lib/time.ts`, `lib/toast.ts`, `lib/focusTrap.ts`; novi komponenti `ui/Toast.svelte`, `ui/ConfirmDialog.svelte`.

## 0.8.1 — 2026-07-23

Posodobitev voznega reda + orodje za samodejni prevzem GTFS.

### Podatki
- **Nov GTFS feed Marprom (velja 06.07.2026 – 31.12.2026).** Prejšnji feed je potekel 25.06.2026, aplikacija je torej ~4 tedne prikazovala zastarele vozne rede.
- Poletni vozni red: 454 → **457 postaj**, 2.067 → **1.833 voženj**, 39.714 → **35.397 postankov**; linije (G1–G6, P7–P19) nespremenjene.
- ⚠️ Delovni servis v tem feedu velja **samo do 31.08.2026** (sobota/nedelja do 31.12.). Šolski vozni red Marprom objavi konec avgusta — takrat je nujen nov prevzem.

### Orodja
- Nov `scripts/fetch-gtfs.mjs`: prenese `vozniredi.marprom.si/gtfs/gtfs.zip`, razpakira (lasten minimalni ZIP reader, brez odvisnosti), naredi varnostno kopijo prejšnjega feeda in namesti novega. `npm run gtfs` = prevzem + build, `npm run gtfs:check` = samo preverjanje.
- Opozorilo pred potekom se računa **po dnevih v tednu iz `calendar.txt`**, ne iz `feed_end_date` — sicer bi trenutni feed izgledal veljaven do 31.12., čeprav delavniki potečejo 31.08.

## 0.8.0 — 2026-06-12

Celovita revizija (analiza: design / UX tokovi / podatkovni tokovi / točnost podatkov / PWA) + popravki.

### Točnost podatkov
- **Indikator svežine živih podatkov zdaj dejansko deluje.** `liveStaleSec` se je prej nastavil samo ob uspešnem pollu (vedno ~0) — dodan sekundni ticker; "pred X s" v živo raste, ob izpadu OBA pa se po 90 s vozila samodejno preklopijo iz zamrznjenih GPS pozicij na sintetične (vozni red).
- **Krožne linije:** trip, ki gre skozi isto postajo dvakrat, je prej v odhodih/voznih redih pokazal samo prvi obisk (`upcomingDepartures`, `allDeparturesForStop`, `LineTimetableModal`) — zdaj se upoštevajo vsi obiski (158 tripov v feedu).
- **Bus detail se osvežuje v živo:** `selectedLive`/`selectedVehicle` se sinhronizirata z vsakim pollom (prej zamrznjena na stanju ob tapu), odštevalnik v "Naslednje postaje" in trip-match se osvežujeta s 30 s tickom.
- **Stari živi prihodi na Domu** veljajo 2 min od zadnjega uspešnega fetcha, potem fallback na GTFS (prej so ob izpadu večno prekrivali sveže podatke).
- "Velja od februar 2026" zamenjan z datumom iz `meta.json` + opozorilo, ko service obdobja v feedu potečejo (trenutni feed se izteče 2026-06-25!).
- Polnočna normalizacija delayMin fallbacka; vremenski urni graf med 00:00–01:59 ni več prazen (UTC/lokalni datum); "Kreni" uporablja nastavitev hitrosti hoje (prej hardkodiranih 1,3 m/s).
- Klik na živ prihod odpre vozni red linije v pravi smeri (prej vedno smer 0); opomba pod bus pogledom loči GPS bus od sintetičnega.

### UX
- **Sistemski "nazaj" (Android/brskalnik) zapira modale in izbire namesto izhoda iz aplikacije** — nov `backstack.ts`, ožičeno: planer, vreme, postaja, plan, bus, vozni redi, share, pripni linijo.
- Tap na shranjeno pot / deep link: indikator "Iščem pot…" + ob neuspehu se odpre planer s prednastavljenim ciljem (prej tiho nič).
- Razčlenjena sporočila planerja (čas v preteklosti / predaleč od postaj / ni povezave ob času); pike na gumbu se animirajo.
- Tap v polje planerja ne razveljavi več izbranega kraja (razveljavi šele sprememba besedila); geocode predlogi imajo seq-token (out-of-order odgovori).
- Tap na karto zapre tudi izbran bus (prej samo postajo); dvojina "čez 2 minuti".

### Stabilnost
- `MapView`: async `onMount` je vračal cleanup, ki ga Svelte ignorira → MutationObserver leak + `setStyle` na uničeni mapi; mapa se ni smela ustvariti po unmountu (WebGL leak); kamera ukazi pred pripravljeno mapo se zdaj uvrstijo namesto izgubijo; po menjavi stila se overlay plasti dodajo z retry (prej so lahko trajno izginile).
- `MapScreen`: napaka shapes.json ne ugasne več živega pollinga; seq-guard za hitri preklop postaj; identity-guard za shape izbranega busa; RAF guard za `activePlan`; odстranjeni non-null asserti na GTFS poteh.
- Schema validacija `savedRoutes` + sanacija `walkSpeedKmh` iz localStorage; `decodeURIComponent` guard za pokvarjene share linke.
- Polling se ustavi, ko gre app v ozadje (`visibilitychange` v realtime.ts + guardi v Home/MapScreen) — baterija, podatki, proxy kvota.

### PWA / verzije / deploy
- **`npm run deploy` je obšel `build-sw.mjs`** (gh-pages je dobival zastarel `sw.js` — na produkciji `0.7.9-a2fcb4e` ob HEAD `7898646`) → `predeploy: npm run build`.
- **En vir verzije:** `release.ts` bere `__APP_VERSION__` iz package.json (prej: package.json 0.7.9, release.ts 0.7.4, sw.js tretja).
- SW: hashirani `/assets/` cache-first (prej SWR re-prenos ~430 KB gzip ob vsakem zagonu); glyph fonti pokriti za offline; tiles cache omejen na 500 vnosov.
- `theme-color` in `color-scheme` sledita temi (status bar v temni temi ni več rdeč; native elementi tematski).

### Design / dostopnost
- LineBadge: barva teksta po luminanci ozadja (bel tekst na lime/oranžni < 2:1); svetla tema: temnejši `--status-*` in `--text-muted` (WCAG kontrast za "zdaj"/zamude/footnote).
- Globalni `:focus-visible` indikator; modali: Escape + `role=dialog`/`tabindex` (PlannerModal prej brez role); UpdateToast upošteva safe-area (notch); popravljen `t-largetitle` typo (vreme); seznami v karticah Doma brez `<ul>` v `<button>` (neveljaven HTML).
- Počiščeno: mrtva `SearchScreen.svelte`, neuporabljen `public/icons.svg`, mrtvi design tokeni (modra brand paleta).

## 0.7.4 — 2026-04-21

### Novosti
- **Krožna navigacija med prikazi.** Uporabnik lahko zdaj brez slepih ulic kroži: Dom → postaja → linija → postaja → linija → … Konkretno:
  - **Bus detail → klik na vrstico v "Naslednje postaje"** zapre bus detail in odpre postajni pogled za tisto postajo (flyTo, žive prihode, filter linij) — prej je bila lista zgolj informativna, tap ni naredil ničesar.
  - **Vozni red linije → "Odpri postajo" ikona** (ExternalLink) ob izbrani postaji v `LineTimetableModal`. Zapre modal in odpre Karto → postaja. Deluje tako iz Karte (bus detail) kot iz zavihka Vozni redi.
  - **Vozni red postaje → klik na LineBadge chip v uri** (`StopTimetableModal`) zapre stop modal in odpre vozni red tiste linije (s pravo smerjo `trip.dir`). Deluje v obeh kontekstih (Karta, Vozni redi).
- **Zavihek Vozni redi — klik na postajo po imenu** zdaj poleg `StopTimetableModal` odpre tudi Karta → postaja skozi `onOpenStop` pot iz `LineTimetableModal`, tako da je izhodišče iz obeh zavihkov usklajeno.

### Tehnično
- `LineTimetableModal`: nov opcijski `onOpenStop: (stopId) => void` prop. Ko je podan, se v selected-stop headerju prikaže ExternalLink ikona (accent barva, poleg Star fav gumba).
- `StopTimetableModal`: nov opcijski `onOpenLine: (routeId, dir) => void` prop. Ko je podan, se LineBadge chip-i v urnem pregledu rendirajo kot `<button>` namesto `<div>`, s pravilnim `trip.dir` iz `grouped`.
- `MapScreen`: nova helper funkcija `jumpToStopFromBus(s)` počisti `selectedLive/followBus` in delegira `handleStopChange` preko `onStopChange(s)` (ki že počisti `selectedVehicle` in sproži flyTo/refreshArrivals/fitBounds).
- `TimetablesScreen`: nov `onStopSelect: (s: Stop) => void` prop (routed iz App.svelte → `handleStopSelect` → activeTab='map' + selectedStop), hrani `lineDir` state za `initialDir` propagation.
- App.svelte prop threadanje: `<TimetablesScreen onStopSelect={handleStopSelect} />`. Brez `handleStopSelect` v TimetablesScreen-u je bilo onemogočeno jumpanje iz Linije → postaja iz tega zavihka.

## 0.7.9 — 2026-04-20

### Popravki (kritični)
- **Enoten vir ETA za avtobusne podrobnosti.** Prej je top card v bus detail-u kazal `selectedLive.etaMin` iz `/GetActiveDeviceDetails`, postajni pogled pa `a.ETAMin` iz `/GetArrivalsForStopPoint` — dva neodvisna OBA endpointa lahko vrneta različni vrednosti (npr. bus #161 P8: "prihaja zdaj" v linijskem, "čez 72 min" v postajnem). Zdaj bus detail ob izbiri kliče `fetchArrivalsForStopPoint(nextStopPointId)` in filtrira po `busCode` → uporabi **isto** vrstico kot postajni view. Auto-refresh 15 s. Poleg ETA zdaj prikaže tudi `delayMin` (+zamuda zelena/rdeča).
- **Dom zavihek zdaj v živo.** Prej je `HomeScreen` za vsako postajo klical GTFS `upcomingDepartures()` — čist vozni red brez zamud, ne-ujema se z OBA podatki v postajnem pogledu (ista postaja: Dom kaže 14 min, Postaja 9 min). Zdaj ob mount-u in vsakih 30 s paralelno fetcha `fetchArrivalsForStopPoint` za vse vidne postaje (bližnja ∪ priljubljena), dedup po stopId. Ko OBA vrne podatke → Dom kaže iste etaMin kot postajni view. GTFS scheduled ostane fallback (OBA fail ali ni več živih prihodov). Reactive watcher na `stopIdsKey` sproži nov fetch tudi ob premiku uporabnika ali spremembi priljubljenih.
- **Ikona busa sledi zadnjemu OBA GPS.** Odstranjena GTFS schedule + anchor hibridna interpolacija v `realtime.ts` (`interpolate()`, `rafLoop`, `vehiclePaths`, `anchors`, `scheduleS`, `projectToPoly`, `pointAtS`, `setVehiclePaths`, `setVehicleShapes` → vse zbrisano). Ikona se zdaj postavi direktno na `v.lat/v.lon` iz zadnjega polla. Bearing se računa iz `prev→cur` GPS premika v metrih (cache ob mirovanju, da ikona ne skače). Povzročitelj drift-a (schedule "napredovanje" kljub stoječemu GPS-u) odstranjen.
- **Odstranjena eksperimentalna gladka animacija.** `smoothVehicleMotion` setting, stikalo v Nastavitvah in povezan RAF loop zbrisani. Vrnemo se, ko bo Marprom GPS cadence boljši.
- **Odstranjen `findTripBatch` batch per poll.** Prej po vsakem polle MapScreen matchal vse žive buse → GTFS trip → shape + stopSeq, pošiljal v realtime za schedule interpolation. Ni več potrebno; `findTripForLiveBus` ostane, kliče se samo ob izbiri busa (za `vehTrip` / prikaz trase).

### Drobni popravki
- **Statična oznaka voznega reda na Domu.** "Vozni red velja od: {datum}" (dinamično iz meta.json, sl-SI format) → "Velja od februar 2026". Datum se ne spreminja dovolj pogosto, da bi bil dinamičen prikaz smiseln; uvoz `GtfsMeta` + `loadMeta` + `Intl.DateTimeFormat` iz `HomeScreen` odstranjen.

## 0.7.0 — 2026-04-20

### Novosti
- **Sledenje lokaciji v živo (`watchLocation`).** Moder pin uporabnika se zdaj avtomatsko posodablja med gibanjem (high-accuracy GPS, cache 5 s). Stikalo v Nastavitvah (privzeto ON). Ob preklicu pravic (`err.code === 1`) watch avtomatsko odjavi, da ne vrtimo prazen zahtevek.
- **Gladko premikanje busov — beta, privzeto OFF.** Nova nastavitev `smoothVehicleMotion` (v Nastavitvah pod Karto, oznaka "beta"). Ko je OFF, bus "skoči" vsakih 30 s na novo GPS pozicijo (poceni, deterministično). Ko je ON, animacija teče po voznem redu + OBA anchor offset (RAF). Razlog za OFF privzet: interpolacija pri dolgi razliki med poll-om in GPS fresh-om občasno "prehiteva", kar je pri beta testu večje motenje kot suhi preskoki.
- **Datum veljavnosti voznega reda na Domačem zaslonu.** Pod pozdravom je nova vrstica "Vozni redi: DD. MMM YYYY" (iz `meta.json`, sl-SI format). Uporabniki pogosto ne vedo, ali delajo s svežimi ali starimi GTFS podatki; zdaj je to eksplicitno.

### Popravki
- **Poll interval 30 s (prej 8 s).** Marprom GPS posodobitve so v praksi ~60 s. 8 s je bil wasteful — isti GPS se je vračal 7× zapored. 30 s ujame prvo svežo pozicijo v povprečju 15 s po Marprom update-u. Manj bandwidth-a, manj pritiska na proxy-je.
- **OBA proxy fallback chain.** Če `corsproxy.io` odpove (429/5xx/timeout), se zahteva avtomatsko rotira na `api.allorigins.win` (in obratno). Sticky izbira — uspešen proxy ostane trenutni. 4 s timeout per proxy. Custom proxy (`VITE_OBA_PROXY`) obdrži no-fallback obnašanje (uporabnik ima svoj nadzor, ne želi, da gre zahteva mimo njegovega endpointa).
- **Hitrejši prvi render karte — paralelni prefetch `shapes.json` (~800 KB).** Prej se je shapes.json fetchal šele ob prvem klicu `loadShapes()`, ki ga MapScreen sproži po mount-u → dodaten round-trip. Zdaj gre v ozadje hkrati z ostalimi GTFS fetch-i v `loadGTFS()`. Swallow-catch: GTFS uspeh ni odvisen od shapes. Odreže ~300–800 ms na 4G.
- **Retry za `loadShapes()` ob transientni napaki.** Ob network fail se `shapesLoading` promise zdaj počisti, tako da naslednji klic požene nov fetch (prej so vsi dobili isti rejected promise → zemljevid trajno brez tras). Isti vzorec kot že obstoječi `loadGTFS`.
- **≥60 % hitrejši match vozil z GTFS trip-i.** Nov `precomputeVehiclesIndexes(gtfs, when)` vrne `{ stopById, tripsByRoute, activeServices, routeIdByShort, dayKey }` v WeakMap<GTFS> cache-u. Prej je vsak klic `findTripForLiveBus` linearno skeniral 14k+ trip-ov in rebuildal `stopById` Map — pri 15+ vozilih preko 5 ms per klic. Zdaj razrez po routeId je O(#trip-ov na linijo) ≈ 50–200. Day-key check sproži rebuild ob polnoči (drugačen aktivni servis).

---

## 0.6.2 — 2026-04-19

### Popravki
- **Krožna linija G3: odpravljen "preskok" ikone busa mimo postaj, ki v ETA še ni prikazan.** Uporabnik je opazil: bus na karti pelje skozi postajo, a če tapne postajo, pove "20 min". Razlog so bili štirje medsebojno povezani bugi, aktivni samo na tripih, kjer sta prva in zadnja postaja isti fizični stop (pts[0] koordinate = pts[N-1] koordinate na shape polyline):
  1. **`projectToPoly` dvoumnost pri zaključku zanke.** GPS blizu depoja se je projeciral na s ≈ 0 (prvi segment zmaga pri strict `<` primerjavi), čeprav bus dejansko zaključuje zanko pri s ≈ totalM. Posledica: `anchor.s` je teleportiral z ~5000 m na 0, `scheduleS()` je vrnil freeze-vrednost na začetku urnika, čas bus-a se je zamrznil → ikona je "pobegnila" v linearni ekstrapolaciji od schedule-a.
  2. **Monotonicity clamp je stisnil zadnjo postajo.** `const sMono = Math.max(s, lastS);` je zadnjo postajo (iste koordinate kot prva) prisilil na `sMono ≈ lastS` namesto na `totalM`. `scheduleS()` je zato zadnji segment trip-a zmrznil na napačnem s.
  3. **`findTripForLiveBus` ni razločeval prekrivajočih trip-ov.** Krožne linije imajo dva zaporedna trip-a, ki se prekrivata v 2-min buffer oknu. Headsign filter in nearest-stop heuristika nista razlikovala, zato se je lahko bus pripisal napačnemu trip-u.
  4. **`cropShape` je na loop-closure segmentu vrnil reverse čez celo pot.** Ker sta iFrom in iTo oba bila na duplicate-coord točkah (~začetek in ~konec), je `iFrom > iTo` sprožil `reverse()` → bus je v zadnjem segmentu izrisal nazaj skozi celo zanko.

  Popravki: `projectToPoly` ima zdaj neobvezen `preferNearS` parameter — pri skoraj-enako-oddaljenih projekcijah (znotraj 15 m) izbere tisto, ki je bližje prejšnjemu anchor-ju/progresu. V `setVehiclePaths` se `preferNearS = lastS` zagotovi, da zadnja postaja krožne linije pristane pri `s ≈ totalM`. V `snapshot()` `preferNearS = prevAnchor.s` prepreči teleport. `findTripForLiveBus` zdaj najprej filtrira strogo v-teku trip-e in šele kot fallback uporabi 2-min buffer. `cropShape` na zaprtih shape-ih (prva = zadnja točka) ne reverse-a, ampak naredi forward wrap `iFrom → konec + začetek → iTo`.

### Vpliv na druge linije
- **Linearne (1, 2, 6, 7...):** projectToPoly tiebreaker nima alternativ znotraj 15 m → obnašanje identično. Monotonicity clamp ostane. Closed-shape branch v cropShape false → identično.
- **V-teku filter:** Pozitivno tudi na linearnih — pri trip transition (prejšnji trip konča 12:00, novi začne 12:00) preprečuje flip-flop med overlapning trip-i. Če nobeden ni "v teku" (bus zamuja več kot 2 min), fallback na buffer ohrani staro vedenje.

---

## 0.6.1 — 2026-04-19

### Popravki
- **Pin mode je zdaj dvostopenjski, kot v Uber/Bolt.** v0.6.0 je križ stalno visel na sredini karte, kar je bilo moteče pri normalnem brskanju. Zdaj je skrit, dokler uporabnik ne tapne pin FAB-a (levo, MapPin ikona). Tap FAB → križ se pojavi, Načrtuj pill (desno) se spremeni v **"Potrdi tukaj"** (Check ikona), pin FAB pa v **"Prekliči"** (X). Drugi tap na Potrdi zabije pin na točno sredino karte in odpre planer. Prekliči ali izbira postaje/vozila pin mode avtomatsko zapustita.
- **Pin gre natanko na izbrano lokacijo, brez snap-a na najbližjo postajo.** v0.6.0 je `dropPinAtCenter()` najprej preveril, ali je pod križem postaja in v tem primeru raje izbral njo. To je bilo v nasprotju z uporabniškim namenom — če je želel postajo, bi jo tapnil direktno. Zdaj pin vedno emitira natančne lat/lon koordinate trenutnega centra karte → planer kot cilj uporabi točno to točko (reverse-geocode naknadno).

---

## 0.6.0 — 2026-04-19

### Novosti
- **Nov način izbire cilja na karti: "crosshair + FAB" vzorec (kot Uber/Bolt).** Long-press smo opustili po 3 neuspešnih iteracijah na iOS PWA (v0.5.1–v0.5.3) — MapLibre na iPhonu touch evente prestreza, zamuja ali preimenuje, kar je onemogočilo zanesljivo detekcijo 500 ms pritiska. Zamenjava: na sredini karte je zdaj ves čas viden rdeč pin + ground dot (natančna pixel pozicija), poleg rekapitulacijskega gumba pa **pin FAB** (levo spodaj, nad gumb "Moja lokacija"). Uporabnik premakne karto, da je križ točno kjer hoče, nato tapne FAB → cilj je postavljen. Če je pod križem postaja, raje izberemo njo. Deluje enako na iOS in Androidu, brez timerjev in gesture-race pogojev.
- **Imena postaj na karti (zoom 15+).** Vsaka postaja ima zdaj poleg rdeče pike tudi ime, izpisano v stilu CARTO Voyager/Dark Matter (Open Sans Regular), z belo/črno halo obrobo za berljivost. Font-size se interpolira od 10 px (zoom 15) do 13 px (zoom 19). Prepovedano prekrivanje (`text-allow-overlap: false`) + `text-optional: true` pomeni, da se pri gosto posejanih postajah nekatera imena skrijejo, namesto da bi se vsa napisna plast izgubila.

### Popravki
- **iPhone PWA "prazna lisa spodaj" ob prvem zagonu — odpravljena brez potrebe po rotaciji.** iOS je na prvi zagon PWA-ja v0.5.x vračal `100dvh` pred safe-area stabilizacijo, zato je aplikacija zgrešila home-indicator pas. Uporabniku je pomagalo šele landscape→portrait, ki je sprožil reflow. Fix: `main.ts` zdaj iz `visualViewport.height` / `window.innerHeight` postavi CSS var `--app-height`, jo uporabi kot primary vrednost v `html/body/#app` (fallback `100dvh`), in jo recomputa na `resize`, `orientationchange`, `visualViewport.resize` in `pageshow`. Double-rAF + dve timeout zadenejo tudi iOS-ov post-mount viewport settlement.

---

## 0.5.3 — 2026-04-19

### Popravki
- **Planer ne predlaga več poti, ki so počasnejše od direktne hoje.** Dodan walk-dominance filter: vsak transit plan mora prihraniti vsaj **2 min** vs. direktna hoja, sicer ga skrijemo. Primer nesmisla, ki je v0.5.2 še šel skozi: peš 8 min do postaje + bus 5 min (delno nazaj) + peš 2 min = 15 min, ko bi peš naravnost trajalo 12 min. Izjema: če je hoja daljša od 30 min (≥2.5 km), pustimo tudi marginalne bus predloge — uporabnik pogosto raje sede kot hodi predolgo.
- **Realnejši čas pešhoje — uporabljamo URBAN_DETOUR faktor (1.35×).** Prej je walk baseline uporabljal haversine zračno razdaljo, ki v mestu podceni resnično hojo (reka, križanja, enosmerne poti). Zdaj `sec = (metri × 1.35) / hitrost`, kar je skladno z istim faktorjem, ki je že v RAPTOR access/egress kot fallback. Posledica: walk baseline je realnejši in bus plani pošteno tekmujejo z njim.
- **Dolg pritisk na mapo na iPhonu — zdaj zanesljivo deluje.** v0.5.2 je samo odstranil `dragstart` listener, kar ni bilo dovolj — MapLibre na iOS občasno zamudi ali spremeni lastne touch evente zaradi gesture recognition-a (pan/pinch). Prepisano na **native DOM `touchstart`/`touchmove`/`touchend` listeneje** na map kontejnerju, ki jih MapLibre ne prestreže. Threshold 25 px, trajanje 500 ms. Pinch (2 prsta) pravilno prekine timer.

---

## 0.5.2 — 2026-04-19

### Popravki
- **Dolg pritisk na mapo (550 ms) zdaj zares deluje na iPhonu.** Prej je bil nameščen `map.on('dragstart', clearLP)` listener, ki je MapLibre sprožil že ob rahlem premiku prsta (pred 20 px threshold-om) in timer takoj ubil. Odstranjen; razlikovanje drag vs. long-press skrbi zdaj samo `touchmove` prag, ki je bil povišan iz 8 px na 20 px (tesnejši prag je na iOS lovil prstno "trzanje"). Multi-touch preverjamo tudi po razdalji med točkami — MapLibre včasih poroča 2 točki za en prst, kar je blokiralo veljaven long-press.
- **Planer ne predlaga več absurdnih poti "tja in nazaj" po isti liniji.** V RAPTOR inner loop dodana zapora: če smo do postaje prispeli z linijo R, vkrcanja nazaj na linijo R v naslednji rundi ne poskušamo več. Prejšnje: G2 do Pobrežja → G2 nazaj proti centru = nesmisel, ki je zmagal Pareto prag, ker je prihod teoretično minimalno boljši. Zdaj direktno obsoljeno.
- **Predlogi poti v planerju se vsi vidijo.** Modal površina je imela `overflow-hidden`, kar je odrezalo 3–4 predloge + oba vpisna polja + časovni izbirnik. Zamenjano za `overflow-y: auto` + `max-height: calc(100dvh - env(safe-area-inset-bottom))`. Dodan `-webkit-overflow-scrolling: touch` za nativen momentum scroll na iOS.
- **iOS PWA — prazna lisa pod vrstico zavihkov odstranjena.** Body background spremenjen iz `var(--bg)` (#F5F5F7 svetlo / #000 temno) v `var(--surface)` (#FFFFFF / #1C1C1E), tako da se zlije s TabBar-om v `env(safe-area-inset-bottom)` območju (home indicator). App bg zdaj živi eksplicitno na `#app` za notranje zaslone.

---

## 0.5.1 — 2026-04-19

### Popravki
- **Long-press na karti zdaj deluje na iOS Safari.** Prej je koda poslušala samo `mousedown`, ki ga Android Chrome sintetizira iz `touchstart`, iOS pa ga emuilira šele po `touchend` — 550 ms timer ni mogel steči. Dodan je `touchstart` + `touchmove` handler v MapLibre listenerje, z isto logiko kot mouse. Multi-touch (pinch) takoj prekliče long-press timer.
- **Callout meni na iOS ne prekinja več dolgega pritiska.** `-webkit-touch-callout: none` + `user-select: none` na map containerju in `.maplibregl-canvas` prepreči native iOS gesto za izbiro/kopiranje.

### Opomba za iPhone testerje
Za **full-screen PWA izkušnjo** (brez Safari toolbar-a) mora biti aplikacija dodana na začetni zaslon: Safari → Deli → "Dodaj na začetni zaslon" → odpri ikono. Meta `apple-mobile-web-app-capable` deluje samo v tem načinu; v Safari brskalniku toolbar ostane vidnj vedno (iOS omejitev).

---

## 0.5.0 — 2026-04-19

### Novosti
- **Gumb »Pot do postaje«** — v panelu izbrane postaje primaren (accent) gumb, ki takoj odpre planer z pred-izpolnjenim ciljem in `from = Moja lokacija`, nato **auto-run**. Iz 4+ tapov v 2-tap shortcut.
- **Dolg pritisk na mapo (≈550 ms) postavi cilj** — long-press na prazni točki propagira v planer kot destinacija; Nominatim reverse-geocode v ozadju zamenja `Izbrana lokacija (lat, lon)` z naslovom. `from` auto-filled + auto-run.
- **Tap na mapo zapre izbrano postajo** — prej samo X gumb; zdaj hitrejša navigacija med postajami.
- **Vrnitev na prejšnji pogled ob deselect postaje** — ob izbiri zapomni `{center, zoom}`, ob deselect flyTo nazaj. Ohranjeno pri preklopu med postajami (vedno vrne na izvirno stanje).
- **Pinch-zoom na mobilnih** — odstranjen `maximum-scale=1` iz viewport meta; end-user lahko povečuje zemljevid/UI.
- **Retry UI, če GTFS ne naloži** — namesto večne skeleton-ce uporabnik vidi polzaslonski overlay z gumbom "Poskusi ponovno".
- **Datum voznih redov v nastavitvah** — "Vozni redi: <datum>"; opozorilna barva, če so starejši od 30 dni (odhodi znani nadskritijo).

### Popravki
- **GTFS fetch retry deluje** — prej cache-an rejected Promise je blokiral vse naknadne poskuse; zdaj ob napaki počisti cache in dovoli nov poskus.

### Hitrost / interno
- **Planer indeksi precompute (WeakMap)** — Haversine O(n²) ≈ 206k izračunov za 454 postaj se naredi enkrat na GTFS objekt, ne ob vsakem klicu. `nearByStop` + `tripsByBoardStop` kešana po identiteti objekta.
- **Transfer penalty 180 s + Pareto prag 60 s** — prejšnji 120 s prag je včasih proglasil 2-linijske plane za "boljše", ker so prišli 90 s prej. Z penalizacijo prestopov in tesnejšim pragom prevladuje direktna povezava.
- **Service filter v RAPTOR inner loop** — preskoči trip-e nevaljavnih dnevov takoj, ne ob zbiranju rezultatov.
- **AbortController v planerju** — zapiranje modal-a / nov run prekine odprte `walkMatrix`/`walkRoute` fetche; stale rezultati se ne commit-ajo.
- **Auto-versioning SW** — `scripts/build-sw.mjs` generira `public/sw.js` iz template-a ob vsakem `predev`/`prebuild` z `VERSION = pkg.version-SHA`. Testerji dobijo sveže SW brez ročnega bumpanja; `public/sw.js` zdaj `.gitignore`-an.
- **`getCenter()` / `getZoom()` exposed v MapView** — za snapshot/restore logic.

### Varnost / infrastruktura
- **Nominatim User-Agent** bump na `MoHaMobil/0.5.0`.

---

## 0.4.0 — 2026-04-17

### Novosti
- **Velikost napisov na zemljevidu** — 3 stopnje (Manjši / Srednji / Večji) v Nastavitve → Karta.
- **Imena cest na satelitu** — CARTO Voyager symbol layers zmergeani prek Esri raster podlage, bel tekst s temnim obrisom za kontrast.
- **Napisi vidni prej** — `minzoom − 2` (min 2), da se imena ulic pojavijo pri nižjih zoom stopnjah.
- **Dostopnostni temi**:
  - **Visoki kontrast** (čisto bela podlaga, črn tekst, debele obrobe) — za slabovidne.
  - **Črno-belo / Monochrome** (grayscale `filter: grayscale(1)` na `#app`) — za uporabnike, ki ne razlikujejo barv.
  - Privzeta tema: **svetla** (prej auto).
- **Odhodi — izbira prikaza**: samo minute, samo ura, ali oboje (`DepartureDisplay` nastavitev + unified `DepartureTime.svelte` komponenta).
- **Kompakten seznam** — manjše višine vrstic, več vsebine na ekran (`compactLists` nastavitev).
- **Zvezdica ob izbrani postaji v LineTimetableModal** — hitro pripni kombinacijo `(postaja, linija, smer)` za dostop iz zavihka Priljubljeni.
- **Pripete linije vertikalno** — v priljubljenih postajah so chipi za pripete linije razporejeni navpično (namesto vodoravnega drsnega traku).

### Popravki
- Gumb »Omogoči lokacijo« — bela pisava na rdeči podlagi (prej črna, neberljiva).
- SW cache bump `v3 → v4` — osveži zastarele CARTO stile in GTFS po nadgradnji.

### Varnost / infrastruktura
- **Nominatim User-Agent** — dodan `MoHaMobil/0.4.0 (github.com/m1984m/MoHa-Mobil)` header; skladno z Nominatim usage policy, prepreči ban.

### Interno
- `MapView.extractLabelLayers()` — izlušči simbole iz Voyagerja, skipa POI/icon source-layers, skalira `text-size` z `['*', factor, val]` ekspresijo.
- `styleKey(dark, kind, lsize)` — trojni ključ, sproži `setStyle()` reload ob spremembi velikosti napisov.
- Nov `favLines.ts` store (`mm.favLines.v1`) za pripete `(stopId, routeId, dir)` kombinacije.
- `theme.ts` razširjen iz 3 → 5 tem, `THEME_CLASSES` array prepreči class leakage ob preklopu.

---

## 0.3.0 — april 2026

### Novosti
- Natančnejše animacije avtobusov (GTFS schedule + OBA GPS anchor hibrid) in pešpoti.
- Priljubljene postaje: swipe za izbris, pripete linije.
- Več nastavitev za osebno prilagoditev.

### Interno
- Hibridna interpolacija vozil: bus napreduje po voznem redu, OBA GPS služi kot anchor za offset.
- ORS (OpenRouteService) foot-walking matrix za pre-fetch realnih časov hoje v planerju.
- `startPolling()` — setInterval poll (8s) + `requestAnimationFrame` loop za smooth prikaz.

---

## 0.2.0 — marec 2026 (prvi javni deploy)

### Funkcionalnost
- Prva javna objava na GitHub Pages: https://m1984m.github.io/MoHa-Mobil/
- Zavihki: Dom, Vozni redi, Karta, Priljubljeni, Nastavitve.
- MapLibre GL vector/raster render; CARTO Voyager (light) in Dark Matter (dark) podlage.
- GTFS Marprom (stops/routes/trips/service) + OBA live prihodi.
- Planer poti (RAPTOR algoritem) z OSRM/ORS pešpotmi.
- PWA — manifest, service worker, offline cache (GTFS + tiles).
- Shranjene poti, priljubljene postaje.
- Vremenski modal (Open-Meteo).

### Popravki pred deploy-em
- `crypto.randomUUID()` fallback za starejše mobile brskalnike.
- Nested `<button>` napaka v priljubljenih (accessibility).
- Double-tap zoom privzeto onemogočen (prepreči zoom ob tap-ih).
- Deploy skript `npm run deploy` (GitHub Pages `gh-pages` branch).

---

## Referenca

- **Slog različic**: 0.x.y — `MAJOR` ostane 0 do stabilne prve izdaje; `MINOR` za nove funkcionalnosti; `PATCH` za popravke.
- **Format tega dokumenta**: ohranjaj obratno kronološki vrstni red, vsaka različica ima ISO datum + sekcije `Novosti / Popravki / Varnost / Interno` (uporabi samo tiste, ki so relevantne).
- **UI Novosti sekcija** (`SettingsScreen.svelte → Novosti`): prikaže le **zadnjo različico**, **največ 4 bullete**. Zgodovina živi tukaj.
