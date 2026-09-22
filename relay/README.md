# Posrednik za OBA (Deno Deploy)

Živi prihodi in pozicije vozil gredo od 20.09.2026 skozi ta posrednik, ker
Cloudflare ne pride do Marproma.

## Zakaj

Izmerjeno 20.09.2026 na `https://vozniredi.marprom.si/OBA/GetLines`:

| Od kod | Rezultat |
|---|---|
| domače omrežje | 200 v 0,11 s |
| Cloudflarov rob (colo MXP) | 522, povezava pade po 19,5 s |
| Cloudflare, vrata 80 (brez TLS) | 522, enako |
| Google Cloud (34.96.49.207) | 200, s pravimi zamudami |
| `gov.si` in `nap.si` s Cloudflara | 200 |

Torej ne gre za geografsko blokado in ne za TLS: potrdilo je veljavno
(Let's Encrypt, TLS 1.3, cela veriga), gostitelj pa iz omrežja Cloudflare ne
odgovori niti na nešifriranih vratih. Paketi se tiho zavržejo, zato Worker
obvisi in ob svoji devetsekundni omejitvi javi `upstream unreachable`.

Javni posredniki niso rešitev: `corsproxy.io` zdaj zahteva ključ, `allorigins`
in `codetabs` pa sta sama na Cloudflaru in vrneta isto napako.

## Kako je vezano

```
telefon  →  Cloudflare Worker  →  ta posrednik (Deno Deploy, Google)  →  Marprom
```

Worker ostane edina točka, ki jo kliče aplikacija: CORS, seznam dovoljenih
izvorov, preverjanje parametrov in predpomnjenje so še vedno tam. Posrednik je
namenoma neumna cev s skupno skrivnostjo, da ni odprt proxy.

Worker gre skozi posrednik samo, kadar ima nastavljeno spremenljivko
`OBA_RELAY`. Brez nje kliče Marproma neposredno, tako kot prej.

## Objava

Naslov v produkciji: **https://moha-oba.m1984m.deno.net**

Račun je na novi ploščadi (`console.deno.com`), ne na stari `dash.deno.com`.
Zato **`deployctl` ne deluje** — njegov prijavni tok visi v neskončnost, ker
potrditve na novi ploščadi nikoli ne dobi. Uporabi CLI nove ploščadi.

Vgrajeni `deno deploy` v Denu 2.9.6 vsaki zastavici podvoji vrednost
(»Option "--app" can only occur once«), zato se orodje kliče neposredno iz
JSR. Ker JSR paket potrebuje `node_modules`, se požene iz ločene mape, izvorna
koda pa se poda kot pot:

```bash
# enkratna priprava mape, iz katere se poganja orodje
mkdir /tmp/deploy-cli && cd /tmp/deploy-cli
echo '{ "nodeModulesDir": "auto" }' > deno.json

export DENO_DEPLOY_TOKEN=$(cat <pot>/relay/.deno-token)
deno run -A jsr:@deno/deploy --json -y --org m1984m --app moha-oba --prod <pot>/relay
```

**Mapa z izvorno kodo mora biti čista.** Prvi poskus je padel v gradnji po 1,5 s,
ker je bil v njej `node_modules` in `deno.json` z `nodeModulesDir: auto` —
zaznane nastavitve gradnje so bile napačne. Aplikacija je bila ustvarjena z
`--do-not-use-detected-build-config`.

Skrivnost se naredi z `env load` in **začne veljati šele po ponovni objavi**:

```bash
deno run -A jsr:@deno/deploy env load --json -y --org m1984m --app moha-oba <pot>/relay/.env
```

`relay/.env` vsebuje `RELAY_KEY`, `relay/.deno-token` pa žeton za objavo. Nobeden
ni v gitu. Isti ključ mora imeti Worker:

```bash
cd ../worker
npx wrangler secret put RELAY_KEY
npx wrangler deploy
```

`OBA_RELAY` je navaden vnos v `worker/wrangler.toml`, ker naslov ni skrivnost.

## Preverjanje

```bash
curl https://moha-mobil-proxy.meteleni.workers.dev/health
# obaVia: "relay", relayKeyConfigured: true

curl -H "Origin: https://m1984m.github.io" \
     https://moha-mobil-proxy.meteleni.workers.dev/oba/GetArrivalsForStopPoint?stopPointId=192
```

Posrednik sam odgovori na `/health` brez ključa; vse ostalo brez pravilne glave
`x-relay-key` dobi 403.

Izmerjeno ob objavi 20.09.2026: posrednik do Marproma 0,45 s, cela veriga prek
Workerja 0,35 do 0,83 s, v aplikaciji na GitHub Pages 11 klicev OBA in vsi 200.

## Ko Marprom odblokira Cloudflare

Odstrani `OBA_RELAY` iz `worker/wrangler.toml`, objavi Worker in ugasni aplikacijo
`moha-oba` na Deno Deploy. Druge spremembe niso potrebne — ključ predpomnilnika v Workerju
je ves čas Marpromov naslov, ne naslov posrednika.

## Odločitev 22.09.2026: posrednik je ukinjen, naprej Cloudflare

Marprom je Cloudflare spet odblokiral — Worker od 22.09. kliče
`vozniredi.marprom.si` **neposredno** (12/12 klicev 200, `GetLines` v 0,74 s).
`OBA_RELAY` je v `worker/wrangler.toml` zakomentiran, `/health` javlja
`obaVia: "direct"`.

Zakaj je posrednik sploh padel: brezplačni paket Deno Deploy je 22.09. okoli
07:00 prekoračil kvoto in aplikacijo suspendiral (`503 USAGE_EXCEEDED`). Živi
prihodi so v aplikaciji utihnili, dokler tega nisva opazila.

**Sklep: brezplačni Deno Deploy ni primeren za stalno posredovanje prometa.**
Naprej se uporabi Cloudflare.

**Pomembna omejitev tega sklepa:** posrednik je obstajal prav zato, ker
Cloudflare do Marproma ni prišel. Če bi se blokada kdaj ponovila, posrednik
**na Cloudflaru po definiciji ne bi pomagal** — takrat bi bilo treba gostitelja
zunaj Cloudflarovega omrežja (izmerjeno 20.09.: Google Cloud do Marproma pride).
Za tak primer ostaja koda v tej mapi, odkomentira se `OBA_RELAY` in postavi
skrivnost `RELAY_KEY`.

### Brisanje projekta na Deno Deploy

```bash
cd relay
node pocisti-projekt.mjs                     # izpis projektov
node pocisti-projekt.mjs --izbrisi moha-oba  # izbris
```

Žeton v `relay/.deno-token` je **preklican** (API vrača 401 `invalidToken`),
zato je za izbris potreben nov:
**https://console.deno.com/account/access-tokens** → New token.

Popravek prvotnega zapisa: predpona `ddp_` **ne** pomeni starega »classic«
Deploya — tako se začnejo osebni žetoni tudi na novi platformi (organizacijski
se začnejo `ddo_`). Shranjeni žeton torej ni napačne vrste, ampak je preprosto
neveljaven. Deno Deploy Classic je bil sicer ukinjen 20.07.2026, zato
`dash.deno.com` danes tako ali tako ne pride v poštev.
