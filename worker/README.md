# MoHa Mobil — proxy Worker

Ena majhna storitev na Cloudflaru, ki reši dve težavi hkrati:

| Težava | Kako jo Worker reši |
|---|---|
| Marpromov OBA (živa vozila, prihodi) nima CORS glav → aplikacija je klice preusmerjala prek `corsproxy.io` / `allorigins` | Worker doda CORS glavo sam; javna posrednika odpadeta |
| Ključ za openrouteservice se je ob gradnji vstavil kot besedilo v JS paket in je bil na javni strani berljiv | Ključ živi kot skrivnost v Workerju; v paket ne gre nikoli |
| Vsak uporabnik je pošiljal svoje zahteve na Marprom | Odgovori se predpomnijo (`GetLines` 6 h, pozicije 20 s, prihodi 10 s) — ob 50 hkratnih uporabnikih Marprom dobi eno zahtevo namesto petdeset |

> **Opomba o predpomnjenju:** Cloudflarov `caches.default` na domenah `*.workers.dev`
> **ne deluje** (dokumentirana omejitev). Worker zato hrani še lasten predpomnilnik v
> pomnilniku, ki deluje povsod — sunke združi, a ga ne delijo vse Cloudflarove lokacije.
> Če boš kdaj Workerju pripel lastno domeno, se polno predpomnjenje vklopi samo od sebe,
> brez spremembe kode.

Worker **ni splošen odprt proxy**: pusti skozi samo tri OBA metode in dva ORS
endpointa, preveri izvor zahteve in omeji velikost ORS zahteve. Brez teh omejitev
bi ga lahko kdorkoli uporabil za poljubne klice na tvoj račun in tvojo kvoto.

Poraba je znotraj brezplačnega paketa Cloudflara (100.000 zahtev/dan); pri
predvidenem obsegu uporabe je to red velikosti pod mejo.

---

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
| `/health` | GET | ne | edina pot brez preverjanja izvora |

Vse drugo vrne 404, tuj izvor vrne 403, zahteva navzgor se prekine po 9 sekundah.
