/**
 * Skupne stalnice za Marpromov OBA.
 *
 * Tu so zato, ker jih potrebujeta dva klicatelja: pot za uporabnika
 * (`handleOba` v worker.js) in ogrevanje predpomnilnika iz cron-a (warm.js).
 * Ključ predpomnilnika se med njima NE sme raziti — če bi se, bi cron polnil
 * en predal, uporabnik pa bral iz drugega in ogrevanje ne bi imelo učinka.
 */

export const OBA_BASE = 'https://vozniredi.marprom.si/OBA';

// Dovoljene OBA metode in koliko sekund sme odgovor ležati v predpomnilniku.
// GetLines se spremeni nekajkrat letno, pozicije vozil pa se osvežujejo ~1×/min.
// Ob osipu na poti do Marproma je vsak zadetek v predpomnilniku klic, ki ne more
// pasti — zato sta živi metodi na zgornjem robu tistega, kar je še sveže.
// Prihodi se v aplikaciji osvežujejo na 15 s; 40 s star ETA zgreši kvečjemu za
// minuto (in se popravi, glej popraviEta), neuspel klic pa ne pokaže ničesar.
export const OBA_METHODS = {
  GetLines: 21600,                 // 6 h
  GetActiveDeviceDetails: 30,
  GetArrivalsForStopPoint: 40,
};

// Kako dolgo po izteku TTL se sme odgovor uporabiti kot zasilni. Velja SAMO
// takrat, ko upstream ne odgovori — sicer gre vedno po svežega. Pri prihodih to
// pomeni skupaj do 130 s, kar je po popravku ETA natančno na minuto; dlje ne
// gremo, ker bi obljubljali avtobus, ki je že šel.
export const STALE_MAX_MS = 90_000;

// Glave, s katerimi se predstavimo Marpromu. Preverjeno 22.09.2026, da osip na
// poti NI vezan nanje (z istim UA neposredno 10/10).
export const OBA_HEADERS = {
  'Accept': 'application/json',
  'User-Agent': 'MoHaMobil/1.0 (+github.com/m1984m/MoHa-Mobil)',
};

/** Naslov navzgor za eno metodo; `parametri` so že preverjeni. */
export function obaUrl(method, parametri = {}) {
  const u = new URL(`${OBA_BASE}/${method}`);
  for (const [k, v] of Object.entries(parametri)) u.searchParams.set(k, String(v));
  return u.toString();
}

/**
 * Ključ za `caches.default`. Ostane na Marpromovem naslovu tudi, če bi klic kdaj
 * spet tekel prek posrednika — tako shranjeni odgovori ob menjavi poti ostanejo
 * veljavni.
 */
export function kljucPredpomnilnika(method, parametri = {}) {
  return new Request(obaUrl(method, parametri), { method: 'GET' });
}

/** Odgovor, kakršen gre v predpomnilnik na robu (daljši max-age od TTL). */
export function zaPredpomnilnik(body, ttl) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${ttl + Math.round(STALE_MAX_MS / 1000)}`,
    },
  });
}
