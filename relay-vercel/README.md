# Rezervni posrednik za OBA (Vercel)

Druga pot do Marpromovega OBA, ko posrednik na Deno Deploy (`../relay/`) odpove.
Worker (`../worker/`) ima v `OBA_RELAY` seznam obeh in ob napaki preklopi.

- Naslov: glej `VERCEL_URL` spodaj (projekt `moha-oba-vercel`, račun m1984m)
- Regija je zaklenjena na **arn1 (Stockholm)**: iz fra1 (Frankfurt) Marprom ne odgovori (05.10.2026).
- Skrivnost `RELAY_KEY` je ista kot pri Deno (`../relay/.env`).
- Žeton za objavo: `../relay/.vercel-token` (ni v gitu).
- Telo odgovora preveri enako kot Worker in Deno: `Status: 1` v predpomnilnik,
  `Status: -1` naprej brez predpomnjenja, HTML/prazno/`GetLines` brez `Status: 1` → 502,
  neznan `Status` → 502 z `X-Relay-Razlog: neznano`. Na Marprom čaka največ 3,5 s.
  Podrobnosti v `../relay/README.md` (Preverjanje).
- ORS (pešpoti): `POST /ors/directions/foot-walking/geojson` in `POST /ors/matrix/foot-walking`
  prepišeta prepisa v `vercel.json` na `/api/relay?ors=directions|matrix`; potrebni glavi
  `x-relay-key` in `x-ors-key`, na ORS čaka največ 2 s, odgovor ORS gre nazaj
  nespremenjen z `X-Relay-Ors: 1`. Prepisa sta del objave — brez nove objave Vercel na
  `/ors/…` vrača 404.

Objava:
```bash
export VERCEL_TOKEN=$(tr -d '\r\n' < ../relay/.vercel-token)
npx vercel deploy --prod --yes
```
Skrivnost (enkrat): `npx vercel env add RELAY_KEY production` (vrednost iz `../relay/.env`).
