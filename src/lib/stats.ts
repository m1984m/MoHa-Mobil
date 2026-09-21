// Branje statistike iz Workerja (GET /stat).
//
// Ključ je shranjen lokalno in se pošlje v glavi `x-stat-key`. Deset dotikov na
// ime v Nastavitvah samo odpre zaslon — ključ je tisto, kar zares varuje, saj bi
// skriti vhod vsakdo, ki pogleda v kodo, našel v minuti.

const KLJUC = 'mm.statKey.v1';

export type Vrstica = Record<string, string | number>;
export type Statistika = {
  dni: number;
  ob: string;
  izPredpomnilnika?: boolean;
  zagoni: Vrstica[];
  zavihki: Vrstica[];
  filter: Vrstica[];
  namestitev: Vrstica[];
  omrezje: Vrstica[];
  zaledje: Vrstica[];
};

export function beriKljuc(): string {
  try { return localStorage.getItem(KLJUC) ?? ''; } catch { return ''; }
}

export function shraniKljuc(v: string) {
  try {
    if (v) localStorage.setItem(KLJUC, v);
    else localStorage.removeItem(KLJUC);
  } catch {
    // zasebno okno — ključ bo treba vpisati znova
  }
}

function naslov(): string {
  const env = (import.meta as any).env ?? {};
  const izrecno = env.VITE_EV_ENDPOINT as string | undefined;
  if (izrecno) return izrecno.replace(/\/ev\/?$/, '/stat');
  const oba = env.VITE_OBA_PROXY as string | undefined;
  if (oba && /\/oba\/?$/.test(oba)) return oba.replace(/\/oba\/?$/, '/stat');
  return '';
}

export class NapacenKljuc extends Error {}

export async function pridobi(dni: number): Promise<Statistika> {
  const url = naslov();
  if (!url) throw new Error('Naslov Workerja ni nastavljen.');
  const kljuc = beriKljuc();
  if (!kljuc) throw new NapacenKljuc('Ključ ni vpisan.');

  const res = await fetch(`${url}?dni=${encodeURIComponent(String(dni))}`, {
    headers: { 'x-stat-key': kljuc },
    cache: 'no-store',
  });
  if (res.status === 401) {
    shraniKljuc('');
    throw new NapacenKljuc('Ključ ni pravi.');
  }
  if (!res.ok) {
    let podrobnost = '';
    try { podrobnost = ((await res.json()) as any)?.error ?? ''; } catch {}
    throw new Error(`Strežnik je vrnil ${res.status}${podrobnost ? ' — ' + podrobnost : ''}`);
  }
  return res.json();
}

/** Vsota stolpca `n`, ki pride kot niz (SQL vrne velike številke kot besedilo). */
export function vsota(vrstice: Vrstica[], polje = 'n'): number {
  return vrstice.reduce((s, v) => s + (Number(v[polje]) || 0), 0);
}
