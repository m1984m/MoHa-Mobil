/**
 * MoHa Mobil — posrednik za Marpromov OBA vmesnik (Deno Deploy)
 *
 * ZAKAJ OBSTAJA
 * Marprom (oziroma požarni zid pred `vozniredi.marprom.si`, 194.152.2.50) tiho
 * zavrže promet iz omrežja Cloudflare. Izmerjeno 20.09.2026: z domačega omrežja
 * 200 v 0,11 s, s Cloudflarovega roba (Milano) 522 po 19,5 s, in to tudi na
 * nešifriranih vratih 80. Druga slovenska strežnika (gov.si, nap.si) s Cloudflara
 * delujeta, Google Cloud pa do Marproma pride — torej ne gre za geografsko
 * blokado, ampak za Cloudflare. Zato Worker ne more več sam do OBA in gre skozi
 * ta posrednik, ki teče na Googlovem oblaku (Deno Deploy).
 *
 * To je namenoma NEUMNA cev: preverjanje parametrov, CORS, predpomnjenje za
 * odjemalce in seznam dovoljenih izvorov ostanejo v Workerju. Tu je samo toliko
 * logike, da posrednik ni odprt proxy in da Marprom ne dobi več zahtev, kot jih
 * potrebuje.
 *
 * KO MARPROM ODBLOKIRA CLOUDFLARE: v Workerju odstrani spremenljivko OBA_RELAY
 * in ta projekt lahko ugasneš. Worker takrat spet kliče Marprom neposredno.
 *
 * ORS (12.10.2026): tudi openrouteservice tiho zavrže promet s Cloudflara, zato
 * posrednik nosi še pešpoti — POST na natanko dve poti /ors/…, telo in ključ ORS
 * (glava x-ors-key) pošlje Worker. Odgovor ORS gre nazaj nespremenjen, brez
 * predpomnjenja, z oznako X-Relay-Ors.
 */

const OBA_BASE = "https://vozniredi.marprom.si/OBA";
const ORS_BASE = "https://api.openrouteservice.org/v2";

// Natanko poti ORS, ki ju kliče aplikacija prek Workerja — nič drugega.
const ORS_POTI = new Set(["/directions/foot-walking/geojson", "/matrix/foot-walking"]);
const ORS_NAJVEC_TELO = 8 * 1024; // enako kot MAX_ORS_BODY v Workerju
// Worker da posredniku pri ORS vsaj 2,35 s (preostanek do 5,5 s, razdeljen med
// posrednike); posrednik mora odnehati prej, da Worker pravočasno gre naprej.
const ORS_TIMEOUT_MS = 2000;

// Natanko tri metode, ki jih aplikacija uporablja, in koliko sekund sme odgovor
// ležati tu. Predpomnilnik je na strani posrednika zato, ker je Workerjev
// `caches.default` na *.workers.dev brez učinka, njegov pomnilniški predpomnilnik
// pa velja samo znotraj enega izolata — brez tega bi Marprom dobil toliko zahtev,
// kolikor je izolatov.
const METHODS: Record<string, number> = {
  GetLines: 21600, // 6 h, vozni red se spremeni nekajkrat letno
  GetActiveDeviceDetails: 15,
  GetArrivalsForStopPoint: 8,
};

// Worker čaka na posrednika 4 s in po 0,8 s isti klic pošlje še drugemu
// posredniku. Posrednik mora zato odnehati prej (tudi z 502), da Worker izve za
// napako, preden prekine sam. Zdrav odgovor Marproma pride v 0,1–0,8 s.
const UPSTREAM_TIMEOUT_MS = 3500;
const RELAY_KEY = Deno.env.get("RELAY_KEY") ?? "";

// Primerjava ključa, ki po času izvajanja ne izda, koliko znakov se ujema
// (enako kot enakaKljuca v worker/src/stat.js).
function enakaKljuca(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Marprom tudi napako vrne s statusom 200 in jo zapiše v telo
// ({"Response":{"Status":-1,...}}). Enako kot razvrstiOdgovor v worker/src/oba.js:
//   "ok"      Status 1 (pri GetLines še neprazen seznam linij) — gre v predpomnilnik
//   "prazno"  živa metoda s Status -1: ni podatkov (ponoči pravilno) — gre naprej,
//             a NE v predpomnilnik; kako dolgo ga hraniti, odloči Worker
//   "neznano" Status ni ne 1 ne -1 — 502 z X-Relay-Razlog: neznano, da Worker to
//             v statistiki pokaže posebej
//   "napaka"  HTML, prazno ali neveljavno telo, GetLines brez Status 1 — 502
function razvrsti(method: string, body: string): "ok" | "prazno" | "neznano" | "napaka" {
  let j: { Response?: { Status?: unknown }; Lines?: unknown } | null;
  try {
    j = JSON.parse(body);
  } catch {
    return "napaka";
  }
  const status = j && j.Response ? j.Response.Status : undefined;
  if (status === 1) {
    const lines = j ? j.Lines : undefined;
    if (method === "GetLines" && !(Array.isArray(lines) && lines.length > 0)) return "napaka";
    return "ok";
  }
  if (status === -1) return method !== "GetLines" ? "prazno" : "napaka";
  return status === undefined ? "napaka" : "neznano";
}

type Entry = { body: string; exp: number };
const cache = new Map<string, Entry>();

function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.exp) {
    cache.delete(key);
    return null;
  }
  return hit.body;
}

function cachePut(key: string, body: string, ttlSec: number) {
  // Postaj je ~460; zgornja meja, da poraba pomnilnika ne raste v nedogled.
  if (cache.size > 600) cache.clear();
  cache.set(key, { body, exp: Date.now() + ttlSec * 1000 });
}

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

// POST /ors/<pot> → ORS. Status, telo in Content-Type gredo nazaj nespremenjeni;
// oznaka X-Relay-Ors Workerju pove, da je odgovor dal ORS (tudi 4xx) in ne
// posrednik. Ključa ORS posrednik ne hrani in ne beleži — pride z vsako zahtevo.
async function orsNaprej(request: Request, pot: string): Promise<Response> {
  if (!ORS_POTI.has(pot)) return json({ error: "unknown endpoint" }, 404);
  const orsKljuc = request.headers.get("x-ors-key") ?? "";
  if (!orsKljuc) return json({ error: "missing x-ors-key" }, 400);
  if (Number(request.headers.get("content-length") ?? 0) > ORS_NAJVEC_TELO) {
    return json({ error: "body too large" }, 413);
  }
  let telo: string;
  try {
    telo = await request.text();
  } catch {
    return json({ error: "bad body" }, 400);
  }
  if (telo.length > ORS_NAJVEC_TELO) return json({ error: "body too large" }, 413);

  try {
    const res = await fetch(ORS_BASE + pot, {
      method: "POST",
      headers: {
        Authorization: orsKljuc,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: telo,
      signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
    });
    // Branje telesa je še pod isto mejo časa.
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/json",
        "X-Relay-Ors": "1",
      },
    });
  } catch (e) {
    return json(
      { error: "upstream unreachable", detail: String((e as Error)?.name ?? e) },
      502,
    );
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, keyConfigured: RELAY_KEY.length > 0 });
    }

    // OBA samo GET, ORS samo POST.
    const ors = url.pathname.startsWith("/ors/");
    if (request.method !== (ors ? "POST" : "GET")) {
      return json({ error: "method not allowed" }, 405);
    }

    // Brez skupne skrivnosti je to odprt proxy, ki bi ga lahko kdorkoli
    // uporabljal na Marpromov račun. Zahtevamo jo pred vsem drugim.
    if (!RELAY_KEY || !enakaKljuca(request.headers.get("x-relay-key") ?? "", RELAY_KEY)) {
      return json({ error: "forbidden" }, 403);
    }

    if (ors) return orsNaprej(request, url.pathname.slice("/ors".length));

    // Object.hasOwn: podedovana imena (toString, constructor …) bi sicer prišla
    // mimo seznama metod in vsako bi pomenilo klic na Marprom.
    const method = url.pathname.replace(/^\/oba\//, "");
    if (!url.pathname.startsWith("/oba/") || !Object.hasOwn(METHODS, method)) {
      return json({ error: "unknown method" }, 404);
    }
    const ttl = METHODS[method];

    const upstream = new URL(`${OBA_BASE}/${method}`);
    if (method === "GetArrivalsForStopPoint") {
      const id = url.searchParams.get("stopPointId") ?? "";
      if (!/^\d{1,7}$/.test(id)) return json({ error: "bad stopPointId" }, 400);
      upstream.searchParams.set("stopPointId", id);
    }

    const key = upstream.toString();
    const hit = cacheGet(key);
    if (hit !== null) {
      return new Response(hit, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Relay-Cache": "HIT",
        },
      });
    }

    let res: Response;
    try {
      res = await fetch(key, {
        headers: {
          Accept: "application/json",
          "User-Agent": "MoHaMobil/1.0 (+github.com/m1984m/MoHa-Mobil)",
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      return json(
        { error: "upstream unreachable", detail: String((e as Error)?.name ?? e) },
        502,
      );
    }

    if (!res.ok) return json({ error: "upstream " + res.status }, 502);

    // Branje telesa je še pod isto mejo časa; prekinitev tu ne sme uiti kot izjema.
    let body: string;
    try {
      body = await res.text();
    } catch (e) {
      return json(
        { error: "upstream unreachable", detail: String((e as Error)?.name ?? e) },
        502,
      );
    }
    const vrsta = razvrsti(method, body);
    if (vrsta === "napaka") return json({ error: "invalid upstream body" }, 502);
    if (vrsta === "neznano") {
      return json({ error: "unknown upstream status" }, 502, { "X-Relay-Razlog": "neznano" });
    }
    if (vrsta === "ok") cachePut(key, body, ttl);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Relay-Cache": "MISS",
      },
    });
  },
};
