# Rezervni posrednik za OBA (Vercel)

Druga pot do Marpromovega OBA, ko posrednik na Deno Deploy (`../relay/`) odpove.
Worker (`../worker/`) ima v `OBA_RELAY` seznam obeh in ob napaki preklopi.

- Naslov: glej `VERCEL_URL` spodaj (projekt `moha-oba-vercel`, račun m1984m)
- Regija je zaklenjena na **arn1 (Stockholm)**: iz fra1 (Frankfurt) Marprom ne odgovori (05.10.2026).
- Skrivnost `RELAY_KEY` je ista kot pri Deno (`../relay/.env`).
- Žeton za objavo: `../relay/.vercel-token` (ni v gitu).

Objava:
```bash
export VERCEL_TOKEN=$(tr -d '\r\n' < ../relay/.vercel-token)
npx vercel deploy --prod --yes
```
Skrivnost (enkrat): `npx vercel env add RELAY_KEY production` (vrednost iz `../relay/.env`).
