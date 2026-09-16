/**
 * MoHa Mobil — odločitev, katere zvonjenja so zapadla in kaj z njimi.
 *
 * Ta logika je namerno ločena od Workerja in od omrežja: `processDue` ne ve
 * ne za KV ne za `fetch`, pošiljanje dobi kot funkcijo. Zato jo je mogoče
 * preizkusiti v Node brez računa pri Cloudflaru (glej README, razdelek Preizkusi).
 */

/**
 * Koliko naprej gledamo. Cron se sproži enkrat na minuto in ni natančen na
 * sekundo, zato pobere tudi zvonjenja, ki zapadejo v naslednjih 30 s — sicer
 * bi obvestilo za 08:00:10 čakalo do naslednjega zagona ob 08:01.
 */
export const DUE_WINDOW_MS = 30_000;

/**
 * Koliko zamude še dovolimo. Obvestilo »kreni zdaj na avtobus« prepozno je
 * slabše od nobenega obvestila: uporabnika požene na postajo, s katere je
 * avtobus že odpeljal. Če je Worker ali potisna storitev toliko časa ležala,
 * zvonjenje tiho pade stran.
 *
 * 2 minuti, ne 10: alarm je običajno nastavljen z majhno rezervo (npr. 5 minut
 * pred odhodom), zato bi obvestilo, zamujeno za 9 minut, prispelo štiri minute
 * PO odhodu avtobusa. Rezerva mora ostati večja od tega okna.
 */
export const LATE_GRACE_MS = 120_000;

/** Koliko zaporednih neuspehov (429 / 5xx / omrežna napaka) zvonjenje prenese. */
export const MAX_TRIES = 3;

/**
 * Obdela eno naročnino.
 *
 * @param {{endpoint: string, keys: object, occurrences: Array}} doc  Zapis iz KV.
 * @param {number} now   Trenutni čas v ms (podan zato, da je test determinističen).
 * @param {(doc: object, occ: object) => Promise<{ok: boolean, status: number}>} send
 *        Pošiljalnik enega obvestila — v produkciji ovojnica okoli `sendPush`.
 * @param {{left: number}} [budget]  Skupna kvota pošiljanj za ta zagon crona.
 *        Ko se izteče, ostanek ostane nedotaknjen za naslednjo minuto.
 *
 * @returns {Promise<{occurrences: Array, changed: boolean, sent: number,
 *                    failed: number, dropped: number, expired: number, dead: boolean}>}
 *   `occurrences` je nov seznam (urejen po `fireAt`), ki ga je treba zapisati
 *   nazaj v KV — a samo, če je `changed` true.
 *   `dead` pomeni, da je potisna storitev vrnila 404/410: naprava je odjavljena
 *   in kličoči mora celotno naročnino izbrisati iz KV in iz indeksa.
 */
export async function processDue(doc, now, send, budget = null) {
  const list = Array.isArray(doc && doc.occurrences) ? doc.occurrences.slice() : [];
  list.sort((a, b) => (Number(a && a.fireAt) || 0) - (Number(b && b.fireAt) || 0));

  const keep = [];
  let changed = false;
  let sent = 0, failed = 0, dropped = 0, expired = 0;
  let dead = false;

  for (let i = 0; i < list.length; i++) {
    const occ = list[i];

    // Naročnina je mrtva — ostanka ni smiselno obdelovati, kličoči bo zapis
    // itak izbrisal. Vseeno ga prepišemo v `keep`, da funkcija ostane čista.
    if (dead) { keep.push(occ); continue; }

    const fireAt = Number(occ && occ.fireAt);
    if (!Number.isFinite(fireAt)) { changed = true; dropped++; continue; }

    // Še ni čas. Seznam je urejen, a vseeno gremo do konca, ker moramo
    // preostanek prenesti v `keep`.
    if (fireAt > now + DUE_WINDOW_MS) { keep.push(occ); continue; }

    // Prepozno, da bi bilo še koristno (npr. po izpadu). Odstranimo brez pošiljanja.
    if (fireAt < now - LATE_GRACE_MS) { changed = true; expired++; continue; }

    // Kvota zagona porabljena — pustimo pri miru, poskusimo naslednjo minuto.
    // Namerno NE štejemo kot poskus: krivda ni na strani naprave.
    if (budget && budget.left <= 0) { keep.push(occ); continue; }
    if (budget) budget.left--;

    let res;
    try {
      res = await send(doc, occ);
    } catch {
      res = { ok: false, status: 0 };
    }
    const status = Number(res && res.status) || 0;

    if (res && res.ok) { sent++; changed = true; continue; }   // poslano → vnos odpade

    if (status === 404 || status === 410) {
      // Naprava se je odjavila ali je naročnina potekla.
      dead = true;
      failed++;
      keep.push(occ);
      continue;
    }

    // 429, 5xx ali omrežna napaka: potisna storitev je začasno zdelana.
    const tries = (Number(occ.tries) || 0) + 1;
    failed++;
    changed = true;
    if (tries >= MAX_TRIES) { dropped++; continue; }
    keep.push({ ...occ, tries });
  }

  return { occurrences: keep, changed, sent, failed, dropped, expired, dead };
}
