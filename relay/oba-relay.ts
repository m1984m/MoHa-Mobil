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
 */

const OBA_BASE = "https://vozniredi.marprom.si/OBA";

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

const UPSTREAM_TIMEOUT_MS = 8000;
const RELAY_KEY = Deno.env.get("RELAY_KEY") ?? "";

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

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, keyConfigured: RELAY_KEY.length > 0 });
    }

    if (request.method !== "GET") {
      return json({ error: "method not allowed" }, 405);
    }

    // Brez skupne skrivnosti je to odprt proxy, ki bi ga lahko kdorkoli
    // uporabljal na Marpromov račun. Zahtevamo jo pred vsem drugim.
    if (!RELAY_KEY || request.headers.get("x-relay-key") !== RELAY_KEY) {
      return json({ error: "forbidden" }, 403);
    }

    const method = url.pathname.replace(/^\/oba\//, "");
    const ttl = METHODS[method];
    if (!url.pathname.startsWith("/oba/") || ttl === undefined) {
      return json({ error: "unknown method" }, 404);
    }

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

    const body = await res.text();
    cachePut(key, body, ttl);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Relay-Cache": "MISS",
      },
    });
  },
};
