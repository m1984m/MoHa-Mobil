import { cubicIn, cubicOut, quintOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

// Enoten jezik gibanja za vse, kar se odpre čez aplikacijo.
//
//   backdrop — zatemnitev ozadja okna (samo barva in zameglitev, ne prosojnost
//              elementa: sicer bi s prelivom izginjala tudi plošča v njem)
//   sheet    — list od spodaj (okna, izbire) ali od zgoraj (planer, iskanje)
//   page     — celozaslonska stran od desne, kot "push" v iOS
//   swap     — menjava vsebine znotraj okna (izbira postaje, smer, dan)
//
// Odpiranje je daljše in se mehko ustavi (quintOut), zapiranje krajše in pospešuje
// (cubicIn) — tako se aplikacija odziva hitro, a ne sunkovito. Ob sistemski nastavitvi
// "zmanjšaj gibanje" je trajanje 0: element se pokaže takoj in se takoj odstrani
// (samo CSS pravilo v app.css bi animacijo skrajšalo, zapiranje pa bi še vedno
// čakalo polno trajanje).

function reduced(): boolean {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
const NONE: TransitionConfig = { duration: 0 };

export function backdrop(_node: Element, { out = false, alpha = 0.45, blur = 6 } = {}): TransitionConfig {
  if (reduced()) return NONE;
  return {
    duration: out ? 200 : 240,
    easing: cubicOut,
    css: (t) => `background-color: rgba(0,0,0,${alpha * t}); backdrop-filter: blur(${blur * t}px); -webkit-backdrop-filter: blur(${blur * t}px);`,
  };
}

export function sheet(node: Element, { out = false, from = 'bottom' }: { out?: boolean; from?: 'bottom' | 'top' } = {}): TransitionConfig {
  if (reduced()) return NONE;
  // Višina ob začetku: list mora priti izpod roba, ne samo zdrsniti za nekaj pik.
  const h = (node as HTMLElement).offsetHeight || window.innerHeight * 0.6;
  const dir = from === 'top' ? -1 : 1;
  return {
    duration: out ? 220 : 380,
    easing: out ? cubicIn : quintOut,
    css: (_t, u) => `transform: translateY(${dir * u * (h + 24)}px);`,
  };
}

export function page(_node: Element, { out = false, instant = false } = {}): TransitionConfig {
  if (reduced() || instant) return NONE;
  const w = Math.min(window.innerWidth, 640);
  return {
    duration: out ? 240 : 360,
    easing: out ? cubicIn : quintOut,
    css: (t, u) => `transform: translateX(${u * w}px); box-shadow: -12px 0 32px rgba(0,0,0,${0.14 * t});`,
  };
}

export function swap(_node: Element, { dy = 10 } = {}): TransitionConfig {
  if (reduced()) return NONE;
  return {
    duration: 240,
    easing: cubicOut,
    css: (t, u) => `opacity: ${t}; transform: translateY(${-dy * u}px);`,
  };
}
