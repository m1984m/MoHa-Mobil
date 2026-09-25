# MoHa Mobil — proxy Worker

Ena majhna storitev na Cloudflaru, ki reši dve težavi hkrati:

| Težava | Kako jo Worker reši |
|---|---|
| Marpromov OBA (živa vozila, prihodi) nima CORS glav → aplikacija je klice preusmerjala prek `corsproxy.io` / `allorigins` | Worker doda CORS glavo sam; javna posrednika odpadeta |
| Ključ za openrouteservice se je ob gradnji vstavil kot besedilo v JS paket in je bil na javni strani berljiv | Ključ živi kot skrivnost v Workerju; v paket ne gre nikoli |
| Vsak uporabnik je pošiljal svoje zahteve na Marprom | Odgovori se predpomnijo (`GetLines` 6 h, pozicije 30 s, prihodi 40 s) — ob 50 hkratnih uporabnikih Marprom dobi eno zahtevo namesto petdeset |
| Pot Cloudflare → Marprom občasno visi in uporabnik je čakal 9 s v prazno | Klic se prekine po 4 s, nato se postreže zadnji znani odgovor (»zasilni«, s popravljenim ETA) |

> **Opomba o predpomnjenju:** Cloudflarov `caches.default` na `*.workers.dev`
> **deluje** — preverjeno 22.09.2026 (odgovori z `X-Proxy-Cache: HIT`). V README je
> prej pisalo nasprotno; to ni držalo in ni bilo nepomembno, ker je zasilni odgovor
> odvisen prav od tega, da si shranjeni odgovor delijo vsi izolati. Poleg roba Worker
> hrani še majhen predpomnilnik v pomnilniku izolata kot hitro pot.

### Zasilni odgovor in osveževanje v ozadju

Pot Cloudflare → `vozniredi.marprom.si` občasno visi (22.09.2026 izmerjeno: z roba
uspe okoli četrtina klicev, isti hip neposredno 15/15). Worker zato ne postavlja
uporabnika v vrsto za klic, ki morda ne bo nikoli odgovoril:

| Stanje predpomnilnika | Kaj dobi uporabnik | Kaj se zgodi v ozadju |
|---|---|---|
| svež (pod TTL) | takoj | če je čez polovico TTL, se sproži osvežitev prek `waitUntil` |
| potekel, a pod TTL + 90 s | klic dobi 0,7 s prednosti; če ne odgovori, gre ven star odgovor | klic se dokonča in napolni predpomnilnik za naslednji vpogled |
| prazen | čaka na klic, največ 4 s | — |

**To je glavni obrambni mehanizem**, ne gretje iz cron-a: teče tam, kjer so
uporabniki, in vsak njihov vpogled je še ena priložnost, da klic uspe — ne da bi
kdo čakal. Aplikacija sprašuje vsakih 15 s, zato je takih priložnosti dovolj.

Trije podatki, ki jih je treba poznati:

- Zasilni odgovor gre ven s statusom **200**, ker za aplikacijo to ni napaka —
  podatek ima. Glava `X-Proxy-Cache: STALE` in `X-Proxy-Age` povesta, da je star.
- V statistiki se **klic navzgor zabeleži po svojem pravem izidu** (`ok` /
  `nedosegljiv` / `napaka`), tudi kadar se je dokončal šele v ozadju. Števci zato
  še naprej kažejo, da je pot pokvarjena, čeprav uporabnik tega ne čuti.
- **`ETAMin` se popravi za starost odgovora** (`popraviEta`). To je edino polje, ki
  se s stanjem pokvari: `ArrivalTime` je vozni red, `DelayMin` je zamuda, oboje ostane.
  Prihodi, ki so med čakanjem že minili, izpadejo. Brez tega bi predpomnilnik
  avtobus kazal dlje, kot je — ravno v nevarno smer.

Ponavljanje klica znotraj istega klica Workerja **ne pomaga** (izmerjeno: 3 poskusi
= 2 uspeha od 21, en sam poskus = 3 od 15). Kadar prvi poskus visi, visijo vsi;
šele nov klic Workerja ima spet svojo možnost. Zato `OBA_POSKUSI = 1`.

### Ogrevanje predpomnilnika iz cron-a (`warm.js`)

Cron vsako minuto poskusi osvežiti do 8 najbolj gledanih postajališč zadnjih 30
minut. Seznam pride iz statistike in se shrani v KV za 5 minut; ponoči je prazen in
cron ne naredi ničesar. Postajališča, mlajša od 25 s, se preskočijo.

Najprej gre **tipanje z enim samim postajališčem**: ker so izidi klicev znotraj enega
klica Workerja korelirani, prvi neuspeh pomeni konec — v slabi minuti odide en klic
namesto osmih. Preostala gredo vzporedno.

> **Znana omejitev:** Cloudflare cron-a ne požene nujno v Evropi. 22.09.2026 je tekel
> iz **SIN (Singapur)** in od tam Marprom ni bil dosegljiv **niti enkrat** (0 od 120
> klicev), medtem ko so klici uporabnikov iz evropskih lokacij v istih minutah
> uspevali. Smart Placement tega ne reši — po dokumentaciji velja samo za `fetch`,
> ne za `scheduled`. Zato je gretje dodatek, ne rešitev; obnese se takrat, ko
> Cloudflare cron postavi bliže.

Gretje piše **eno podatkovno točko na klic cron-a** z `blob1 = 'cron'` (ne `'srv'`),
zato števcev uporabe na zaslonu s statistiko ne napihne. Ob popolnem neuspehu se
zapiše še Cloudflarova lokacija. Pogled:

```sql
SELECT toStartOfInterval(timestamp, INTERVAL '1' MINUTE) AS minuta,
       double1 AS postaj, double2 AS uspelo, double3 AS klicev, blob3 AS lokacija
FROM moha_mobil WHERE blob1 = 'cron' AND blob2 = 'gretje'
  AND timestamp > NOW() - INTERVAL '2' HOUR ORDER BY minuta FORMAT JSON
```

> **Pozor pri spreminjanju:** ključ predpomnilnika gradi `kljucPredpomnilnika()` v
> `oba.js`, ki ga uporabljata **oba** — pot za uporabnika in cron. Če bi se razsla,
> bi cron polnil en predal, uporabnik pa bral iz drugega in gretje ne bi imelo učinka.

## Namestitev — 6 korakov

### 1. Račun in prijava

Če Cloudflare računa še nimaš, ga naredi na `dash.cloudflare.com` (brezplačen,
brez kartice). Nato v tej mapi:

```bash
cd worker
npx wrangler login
```

Odpre se brskalnik s potrditvijo. **Opomba za tvoj računalnik:** wrangler shranjuje
prijavo v `%APPDATA%\xdg.config\.wrangler`. Če kateri od ukazov javi, da nisi
prijavljen, ga poženi s pripetim `XDG_CONFIG_HOME`:

```powershell
$env:XDG_CONFIG_HOME = "$env:APPDATA\xdg.config"; npx wrangler deploy
```

### 2. Ključ za openrouteservice

Vzemi obstoječi ključ iz `web/.env` (vrstica `VITE_ORS_KEY=…`) ali naredi novega
na `openrouteservice.org/dev` (brezplačno, 2.000 poti + 500 matrik na dan).

```bash
npx wrangler secret put ORS_KEY
```

Ukaz vpraša za vrednost in jo shrani šifrirano pri Cloudflaru. **Ne** piši ključa
v `wrangler.toml` — ta je v gitu.

### 3. Objava

```bash
npx wrangler deploy
```

Izpiše naslov oblike `https://moha-mobil-proxy.<tvoj-subdomain>.workers.dev`.
Ta naslov potrebuješ v naslednjem koraku.

### 4. Preizkus, da deluje

```bash
# mora vrniti {"ok":true,"orsConfigured":true,...}
curl https://moha-mobil-proxy.<subdomain>.workers.dev/health

# mora vrniti seznam linij (in v glavah X-Proxy-Cache)
curl -H "Origin: https://m1984m.github.io" \
     https://moha-mobil-proxy.<subdomain>.workers.dev/oba/GetLines

# mora vrniti 403 — dokaz, da ni odprt proxy
curl -i -H "Origin: https://zlonamerna.si" \
     https://moha-mobil-proxy.<subdomain>.workers.dev/oba/GetLines
```

Če `orsConfigured` vrne `false`, se je zataknilo pri 2. koraku.

### 5. Preklop aplikacije na Worker

V `web/.env` **zamenjaj** vsebino s tem (ključ ORS lahko pustiš za lokalni razvoj,
a ga v produkcijskem buildu ne bo več potreboval nihče):

```
VITE_OBA_PROXY=https://moha-mobil-proxy.<subdomain>.workers.dev/oba
VITE_ORS_PROXY=https://moha-mobil-proxy.<subdomain>.workers.dev/ors
```

Nato iz mape `web/`:

```bash
npm run build          # preveri, da se zgradi
npm run deploy         # objava na GitHub Pages
```

### 6. Potrditev v živo

Odpri `https://m1984m.github.io/MoHa-Mobil/`, zavihek Karta, in v razvijalskih
orodjih (Network) preveri:

- klici gredo na `…workers.dev/oba/…`, **ne** na `corsproxy.io`,
- v paketu ni več ORS ključa: `curl -s https://m1984m.github.io/MoHa-Mobil/assets/index-*.js | grep -c "5b3ce"` mora vrniti `0`
  (`5b3ce…` je predpona ključev openrouteservice),
- načrtovalec poti še vedno riše pešpoti po pločnikih (ne ravnih črt) in ne kaže
  opozorila »Pešpoti trenutno niso na voljo«.

---

## Alarm za odhod avtobusa (strežniški del)

### Zakaj je za to sploh potreben strežnik

Telefon sme obvestilo prikazati z **zaprto aplikacijo** samo prek potisne storitve
brskalnika (Mozilla, Google, Apple, Microsoft). `setTimeout` v zavihku umre takoj,
ko uporabnik zavihek zapre, `Notification` brez potiska pa iOS sploh ne dovoli.
Odjemalec zato Workerju pove **kdaj** naj zazvoni, Worker pa to preveri enkrat na
minuto in ob pravem času pošlje potisk.

Šifriranje potiska je v `src/push.js`: aes128gcm po RFC 8291/8188 in žeton VAPID
ES256 po RFC 8292, napisano neposredno na WebCrypto. Paket npm `web-push` na
Workerjih ne deluje (stoji na `node:crypto` ECDH in `node:https`). Koda je
prenesena iz projekta Mateleni, kjer je bila preverjena v Node in v živo.

### Namestitev — 3 dodatni koraki

**1. Ustvari imenski prostor KV**

```bash
cd worker
npx wrangler kv namespace create ALARMS_KV
```

Izpiše nekaj takega:

```
[[kv_namespaces]]
binding = "ALARMS_KV"
id = "a1b2c3d4e5f6..."
```

Ta `id` prepiši v `wrangler.toml` namesto `<VPISI_PO_wrangler_kv_namespace_create>`.
(Starejši wrangler pozna ukaz kot `npx wrangler kv:namespace create ALARMS_KV`.)

**2. Vpiši zasebni ključ VAPID kot skrivnost**

```bash
npx wrangler secret put VAPID_PRIVATE
```

Ukaz vpraša za vrednost — prilepi polje `privateKey` iz `worker/secrets/vapid.json`
(mapa `secrets/` je v `.gitignore`). Javni ključ (`publicKey`) je že vpisan v
`wrangler.toml` kot `VAPID_PUBLIC`; ta **sme** biti v gitu, ker ga brskalnik ob
naročanju dobi tako ali tako.

> Ključa VAPID sta par. Če zasebnega kdaj zamenjaš, se morajo **vse** naprave
> naročiti znova — stare naročnine so vezane na stari javni ključ.

**3. Objavi**

```bash
npx wrangler deploy
```

Ob objavi wrangler izpiše tudi vrstico o sprožilcu `* * * * *` — to je cron.

### Kaj vrnejo novi endpointi

Vsi so pod `/alarms` in vsi zahtevajo dovoljen `Origin` (kot `/oba` in `/ors`).
V omejitev 60 zahtev na uro na naslov IP štejejo **samo spreminjajoče** zahteve
(`POST`/`DELETE`); `GET /alarms/status` in neznane poti gredo mimo, ker je vsak
klic omejevalnika pisanje v KV in bi protizlorabni števec pojedel prav tisto
kvoto, ki jo potrebujejo naročnine (glej Znane omejitve).

**`POST /alarms/sync`** — shrani naročnino in seznam zvonjenj (prepiše prejšnjega).

```jsonc
// zahteva
{
  "subscription": { "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" } },
  "occurrences": [
    { "id": "6-europark-0743", "fireAt": 1789000000000,
      "title": "Linija 6", "body": "Kreni čez 5 minut", "tag": "6-europark", "url": "" }
  ]
}
// odgovor
{ "ok": true, "count": 1, "until": 1789000000000 }
```

`until` je najpoznejši `fireAt` (ali `null`, če je seznam prazen).

Zahteva se zavrne s **400**, če: endpoint ni `https:` ali ne kaže na znano potisno
storitev, `p256dh` ni dolg 87–88 znakov base64url, `auth` ni dolg 22–24, vnosov je
več kot 500, `fireAt` ni število ali je več kot 120 dni naprej, ali je
`title`/`body` daljši od 200 znakov. Telo nad 256 kB dobi **413**.

> **Za odjemalca:** zvonjenja s časom **v preteklosti** se tiho preskočijo in se
> ne štejejo v `count` — celotna sinhronizacija se zaradi njih ne zavrne. Vnos
> namreč lahko poteče med letom zahteve in te tekme odjemalec ne more dobiti.
> Če je `count` manjši od poslanega seznama, je razlika ravno v preteklih vnosih.

Dokler `VAPID_PRIVATE` ni nastavljen, vse poti pod `/alarms` vrnejo **503**.
Brez tega bi odjemalec dobil `ok: true` in mislil, da so alarmi nastavljeni,
cron pa ne bi mogel poslati ničesar.

**`DELETE /alarms/sync`** — telo `{ "endpoint": "https://…" }`, odgovor `{ "ok": true }`.
Idempotentno: če naročnine ni bilo, je odgovor enak (odjava, ponovljena po izpadu
omrežja, ne sme vrniti napake).

**`POST /alarms/resubscribe`** — brskalnik sme naročnino zamenjati sam (dogodek
`pushsubscriptionchange` v service workerju). Stari endpoint takrat umre, uporabnik
pa o tem ne ve nič — brez te poti bi mu alarmi tiho nehali zvoniti.

```jsonc
// zahteva
{
  "oldEndpoint": "https://…stari…",
  "subscription": { "endpoint": "https://…novi…", "keys": { "p256dh": "…", "auth": "…" } }
}
// odgovor
{ "ok": true, "moved": true, "count": 3 }
```

Zvonjenja starega zapisa se prenesejo na novega, star `sub:<id>` se izbriše in
odstrani iz indeksa. Validacija naročnine, omejitev velikosti telesa in
omejevalnik zahtev so **enaki** kot pri `POST /alarms/sync`.

| Primer | Kaj se zgodi |
|---|---|
| star zapis obstaja, novega še ni | zvonjenja se prenesejo, `moved: true` |
| starega zapisa ni (ali je že potekel) | shrani se samo nova naročnina, `moved: false`, `count: 0` |
| `oldEndpoint` manjka ali je neveljaven | navaden vpis, **brez** napake; če zapis za novi endpoint že obstaja, se njegova zvonjenja ohranijo |
| `oldEndpoint` je enak novemu | navadna posodobitev — zapis se **ne** izbriše, zvonjenja ostanejo, `moved: false` |
| star **in** nov zapis obstajata | združita se; po `id` se ne podvoji, ob istem `id` obvelja vnos iz zapisa z novejšim `updatedAt` |

`moved` je `true` samo, kadar so zvonjenja res prišla z drugega, zdaj izbrisanega
zapisa — ne ob navadni posodobitvi istega endpointa.

**`GET /alarms/status?endpoint=…`**

```jsonc
{ "subscribed": true, "count": 3, "until": 1789000000000, "vapidPublic": "BC-oaC…" }
```

**Brez** parametra `endpoint` vrne samo `{ "vapidPublic": "…" }` — to odjemalec
potrebuje za `pushManager.subscribe({ applicationServerKey })`, da ključa ni treba
vgraditi v paket.

### Kaj leži v KV

| Ključ | Vsebina | TTL |
|---|---|---|
| `sub:<id>` | `{ endpoint, keys: { p256dh, auth }, occurrences: [...], updatedAt }` | 130 dni |
| `rl:<hash>` | števec zahtev za hashiran IP v tekoči uri | 1 h |

Seznama naročnin **ne vzdržujemo sami**. Cron ga dobi z
`ALARMS_KV.list({ prefix: 'sub:' })`. Prejšnja različica je imela lasten indeks
pod ključem `index`, a KV nima transakcij: cron je indeks prebral na začetku in
na koncu zapisal svojo različico, s čimer je vsako napravo, ki se je
sinhronizirala med njegovim tekom, izbrisal iz seznama — njen zapis je ostal v
KV, cron je ni pogledal nikoli več, `/alarms/status` pa je še vedno javljal
`subscribed: true`. Alarm je tiho obmolknil in se ni popravil sam.

`<id>` je **prvih 32 znakov šestnajstiškega zapisa SHA-256 endpointa**. Ključ je
izpeljan, ne naključen, zato ista naprava ob ponovni sinhronizaciji ne ustvari
podvojenega zapisa. Sam endpoint (ki vsebuje žeton naprave) v imenu ključa ne leži.

`occurrences` so vedno urejene po `fireAt`. Vsak vnos hrani samo znana polja
(`id`, `fireAt`, `title`, `body`, `tag`, `url`) — karkoli drugega iz telesa zahteve
se zavrže. Cron vnosu lahko doda še `tries` (števec neuspelih poskusov).

TTL 130 dni pomeni, da naročnina naprave, ki se nikoli več ne oglasi, sama izgine.

### Znane omejitve

**Obvestilo se lahko podvoji.** KV je eventualno konsistenten: zapis iz ene
Cloudflarove lokacije je v drugi viden šele čez kakšno minuto. Če cron v tem oknu
teče dvakrat iz različnih lokacij, lahko isto zvonjenje odide dvakrat. Brez
Durable Objecta se temu pri KV ni mogoče izogniti, zato je sprejeto zavestno:
vsako poslano obvestilo **vedno** nosi `fireAt` in `id`, da zna service worker
ponovitev prepoznati in zavreči (`tag` poskrbi še za združevanje v predalu).

**Brezplačna meja KV je približno 50 naprav.** Meja je 1.000 pisanj na dan.
Ena sinhronizacija stane 2 pisanji (števec omejevalnika + zapis naročnine), vsako
poslano obvestilo pa še 1. Pri nekaj sinhronizacijah in nekaj alarmih na napravo
na dan se kvota izčrpa nekje pri 50 napravah. Branje stanja (`/alarms/status`) in
neznane poti ne pišejo nič. Če bo naprav več, je naslednji korak Durable Object
(ki hkrati odpravi tudi podvajanje zgoraj).

### Kaj počne cron

Sproži se **vsako minuto** (`[triggers] crons = ["* * * * *"]`) in počne dvoje
vzporedno: ogreva predpomnilnik prihodov (opisano zgoraj) in za vsako naročnino
pogleda njena zvonjenja. Eno drugega ne sme podreti, zato sta obe veji lovljeni
ločeno:

| Stanje zvonjenja | Kaj se zgodi |
|---|---|
| `fireAt` je več kot 30 s naprej | pusti pri miru |
| `fireAt` je zapadel (do 30 s naprej, do 10 min nazaj) | pošlje potisk, vnos odpade |
| `fireAt` je več kot **2 minuti** v preteklosti | vnos odpade **brez** pošiljanja |
| potisna storitev vrne 404 ali 410 | naprava je odjavljena → celotna naročnina gre iz KV in iz indeksa |
| potisna storitev vrne 429 ali 5xx | vnos ostane, `tries` +1; po 3. neuspehu odpade |

> **Zakaj zamujenega ne pošljemo:** obvestilo »kreni zdaj na avtobus« prepozno je
> slabše od nobenega obvestila — uporabnika požene na postajo, s katere je
> avtobus že odpeljal. Okno je 2 minuti in ne 10: alarm je običajno nastavljen z
> majhno rezervo (npr. 5 minut pred odhodom), zato bi obvestilo, zamujeno za
> 9 minut, prispelo štiri minute **po** odhodu.

Na en zagon pošlje največ **200** obvestil in dela največ **25 s**; ostanek počaka
na naslednjo minuto. Zapis v KV gre nazaj samo ob dejanski spremembi.

Vsak zagon pusti eno vrstico v dnevniku (`[observability]` je vklopljen):

```
alarms cron: naročnin=3/3 poslano=1 spodletelo=0 odpadlo=0 zamujeno=0 odjavljenih=0 412ms
```

> **Cron na Cloudflaru ni natančen na sekundo.** Zagon ob »07:43:00« se v praksi
> zgodi nekaj sekund do nekaj deset sekund kasneje, ob visoki obremenitvi
> platforme pa se posamezen zagon lahko tudi izpusti. Zato Worker pobere tudi
> zvonjenja, ki zapadejo v naslednjih 30 s, in zato alarm nastavi **z rezervo**
> (npr. 5 minut pred odhodom), ne na sekundo natančno.

### Preizkus

**Lokalno, s prisilnim zagonom crona:**

```bash
cd worker
npx wrangler dev --test-scheduled
```

V drugem oknu:

```bash
# sproži cron takoj, brez čakanja na minuto
curl "http://localhost:8787/__scheduled"

# stanje in javni ključ
curl -H "Origin: http://localhost:9125" \
     "http://localhost:8787/alarms/status"

# sinhronizacija (nadomesti endpoint in ključa s pravo naročnino iz brskalnika)
curl -X POST -H "Origin: http://localhost:9125" -H "Content-Type: application/json" \
     -d '{"subscription":{"endpoint":"https://updates.push.services.mozilla.com/wpush/v2/…","keys":{"p256dh":"…","auth":"…"}},"occurrences":[{"id":"t1","fireAt":'"$(( ($(date +%s) + 60) * 1000 ))"',"title":"Test","body":"Kreni","tag":"t1","url":""}]}' \
     "http://localhost:8787/alarms/sync"

# odjava
curl -X DELETE -H "Origin: http://localhost:9125" -H "Content-Type: application/json" \
     -d '{"endpoint":"https://updates.push.services.mozilla.com/wpush/v2/…"}' \
     "http://localhost:8787/alarms/sync"
```

`wrangler dev` uporabi **lokalni** KV (v `.wrangler/state/`), ne pravega — za delo
proti pravemu dodaj `--remote`.

**V živo po objavi:**

```bash
npx wrangler tail    # počakaj minuto: vsak zagon crona izpiše vrstico "alarms cron: …"
curl -H "Origin: https://m1984m.github.io" \
     https://moha-mobil-proxy.<subdomain>.workers.dev/alarms/status
```

Če `/alarms/status` vrne `503 ALARMS_KV ni vezan`, je ostal neizpolnjen `id`
v `wrangler.toml`.

---

## Vzdrževanje

**Dnevnik in napake**

```bash
npx wrangler tail        # klici v živo
```

V Cloudflare nadzorni plošči: Workers & Pages → moha-mobil-proxy → Logs.

**Sprememba dovoljenih izvorov** (npr. dodaš lastno domeno): uredi
`ALLOWED_ORIGINS` v `wrangler.toml` in znova poženi `npx wrangler deploy`.

**Zamenjava ORS ključa:** `npx wrangler secret put ORS_KEY` (prepiše obstoječega).
Aplikacije ni treba znova graditi.

**Vrnitev na staro stanje:** iz `web/.env` odstrani vrstici `VITE_OBA_PROXY` in
`VITE_ORS_PROXY`, vrni `VITE_ORS_KEY`, in `npm run deploy`. Aplikacija se samodejno
vrne na javna posrednika in vgrajen ključ.

---

## Kaj Worker prepušča

| Pot | Metoda | Predpomnilnik | Omejitve |
|---|---|---|---|
| `/oba/GetLines` | GET | 6 h | — |
| `/oba/GetActiveDeviceDetails` | GET | 20 s | — |
| `/oba/GetArrivalsForStopPoint?stopPointId=N` | GET | 10 s | `N` mora biti število do 7 mest |
| `/ors/directions/foot-walking/geojson` | POST | ne | telo ≤ 8 kB, 2–30 koordinat |
| `/ors/matrix/foot-walking` | POST | ne | telo ≤ 8 kB, 2–30 koordinat |
| `/alarms/sync` | POST | ne | telo ≤ 256 kB, ≤ 500 zvonjenj, 60 zahtev/h na IP |
| `/alarms/sync` | DELETE | ne | telo `{ endpoint }` |
| `/alarms/resubscribe` | POST | ne | enaka validacija in omejitve kot `/alarms/sync` |
| `/alarms/status` | GET | ne | neobvezen parameter `endpoint` |
| `/tts` | POST | 24 h (isto besedilo) | telo `text/plain` ≤ 800 znakov, 20 novih besedil/min na IP |
| `/health` | GET | ne | edina pot brez preverjanja izvora |

Vse drugo vrne 404, tuj izvor vrne 403. Zahteva navzgor se prekine po 4 sekundah
pri OBA (nato zasilni odgovor) in po 9 sekundah pri ORS.

## Glasno branje (POST /tts)

Aplikacija pošlje slovensko besedilo, Worker ga pošlje Azure Speech (glas
`sl-SI-PetraNeural`) in vrne MP3. Brez ključa `/tts` vrne 503 in aplikacija bere s
sistemskim glasom telefona.

1. Na portal.azure.com ustvari vir **Speech service**, regija Germany West Central (West Europe
   25.09.2026 ni sprejemal novih naročnikov), raven
   **Free F0** (0,5 M znakov na mesec, trda meja, brez stroška; S0 bi zaračunaval).
2. Keys and Endpoint → KEY 1 → `npx wrangler secret put AZURE_SPEECH_KEY`.
3. Druga regija: popravi `AZURE_SPEECH_REGION` v `wrangler.toml`.
4. Objavi Worker; `/health` mora javiti `ttsConfigured: true`.

Napačen ključ ali porabljena kvota (Azure 401/403) vrne 503, aplikacija do konca
seje bere s sistemskim glasom. Omejevalnik na IP je vezava `TTS_LIMITER`
(`[[ratelimits]]`), ki ne piše v KV.

## Analitika (Workers Analytics Engine)

Worker piše dogodke v nabor `moha_mobil` prek vezave `ANALYTICS`
(`wrangler.toml`). Dva vira:

- **strežniško štetje** — vsak klic `/oba/*` in `/ors/*`: metoda, izid
  (`ok` / `cache` / `napaka` / `nedosegljiv`), odzivni čas, število poskusov,
  `relay` ali `direct`, oznaka države. Brez podatka o uporabniku.
- **`POST /ev`** — dogodki iz aplikacije. Sprejmejo se samo znana imena in
  znane vrednosti razsežnosti; prosto besedilo se zavrže. Telo do 4 kB,
  največ 20 dogodkov na zahtevo, zavora 600 dogodkov na minuto na izolat.

Koordinate, naslov IP in identifikator naprave se ne zapisujejo nikoli. Zato
ni piškotka in ni privolitvenega okna. V aplikaciji je pod **Nastavitve →
Podatki** stikalo za izklop, spoštuje se tudi `Do Not Track`.

Če vezave ni, štetje tiho ne naredi nič — pot, po kateri tečejo vozni redi,
ostane nedotaknjena. `GET /health` javi `analytics: true|false`.

### Pogled v podatke

```bash
cd worker
CF_ACCOUNT_ID=... CF_API_TOKEN=... node scripts/statistika.mjs 7
```

Žeton: dash.cloudflare.com → My Profile → API Tokens → Create Token →
Custom token, ena sama pravica **Account · Account Analytics · Read**.
Vrednosti lahko namesto v okolje shraniš v `worker/secrets/analytics.json`
(`{ "accountId": "...", "apiToken": "..." }`) — ta mapa je v `.gitignore`.

Brezplačni paket: 100.000 zapisov in 10.000 poizvedb na dan, hramba tri
mesece. Za stalno nadzorno ploščo obstaja Counterscale, ki teče nad istim
naborom.
