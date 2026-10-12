// Stenski čas Maribora ne glede na časovni pas telefona.
//
// Vozni red, opomniki in »čez N min« so vezani na uro v Mariboru. Telefon z drugim
// časovnim pasom (ročno nastavljen domači pas, računalnik v tujini) je prej kazal
// avtobus, ki je odpeljal pred uro, opomniki pa so prišli 1–6 h pozno (pregled
// 12.10.2026). `new Date()` za vse, kar bere uro, dan ali datum, zato zamenja
// `nowMb()`; za razlike časov (Date.now(), časovniki, epoch opomnikov) ostane epoch.
//
// Na telefonu v pasu Europe/Ljubljana (skoraj vsi) je vse spodaj enako kot prej:
// nowMb() vrne new Date() in mbWallToEpoch() kliče isti konstruktor Date kot prej,
// zato se obnašanje ob premiku ure (preverjeno 25.10.2026) ne spremeni.

export const MB_TZ = 'Europe/Ljubljana';

function deviceTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

/** true = telefon je v pasu Maribora; takrat so vse funkcije tu le ovoji okrog Date. */
export const isMbTz = deviceTz() === MB_TZ;

let fmt: Intl.DateTimeFormat | null = null;
function mbFormatter(): Intl.DateTimeFormat {
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: MB_TZ, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  }
  return fmt;
}

/** Zamik Maribora proti UTC v ms ob trenutku t (npr. +7.200.000 poleti). */
export function mbOffsetMs(t: number): number {
  const s = Math.floor(t / 1000) * 1000;
  try {
    const p: Record<string, number> = {};
    for (const x of mbFormatter().formatToParts(new Date(s))) {
      if (x.type !== 'literal') p[x.type] = Number(x.value);
    }
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
    return asUtc - s;
  } catch {
    // Brez podatkov o pasovih (zelo star brskalnik): privzemi pas naprave.
    return -new Date(s).getTimezoneOffset() * 60000;
  }
}

/**
 * Trenutek t kot Date, katerega LOKALNA polja (getHours, getDay, getDate …) kažejo
 * stenski čas Maribora. Samo za branje ure/datuma — getTime() tega objekta ni pravi
 * epoch, kadar telefon ni v pasu Maribora.
 */
export function toMb(t: number | Date): Date {
  const ms = typeof t === 'number' ? t : t.getTime();
  if (isMbTz) return new Date(ms);
  const wall = ms + mbOffsetMs(ms);                       // stenski čas Maribora kot »UTC«
  const devOffset = (t: number) => -new Date(t).getTimezoneOffset() * 60000;
  // Zamik naprave vzamemo ob ciljnem trenutku: če vmes premakne uro naprava (London
  // 25.10. ob 01:00 UTC), bi zamik ob `ms` dal uro preveč ali premalo.
  let out = wall - devOffset(ms);
  const fixed = wall - devOffset(out);
  if (fixed !== out) out = fixed;
  return new Date(out);
}

/** Zdaj po stenski uri Maribora (glej toMb). */
export function nowMb(): Date {
  return toMb(Date.now());
}

/** Sekunde od polnoči po stenski uri Maribora. */
export function nowSecMb(): number {
  const d = nowMb();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * Pravi epoch (ms) za stenski čas Maribora y-m-d h:mi:s (m od 0, kot pri Date).
 * V pasu Maribora isto kot prej `new Date(y, m, d, h, mi, s).getTime()`.
 */
export function mbWallToEpoch(y: number, m: number, d: number, h = 0, mi = 0, s = 0): number {
  if (isMbTz) return new Date(y, m, d, h, mi, s).getTime();
  const wall = Date.UTC(y, m, d, h, mi, s);
  // Dva koraka: zamik ob približku, nato ob popravljenem trenutku (prehod ure).
  const guess = wall - mbOffsetMs(wall);
  return wall - mbOffsetMs(guess);
}
