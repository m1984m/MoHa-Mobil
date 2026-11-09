// Podatki o medkrajevnih linijah (IJPP), ki jih potrebuje prikaz in branje poti.
//
// Ločeno od ijppPlan.ts: prikaz korakov (PlanSteps) in glasno branje (readAloud) sta v
// začetnem paketu, od načrtovanja pa rabita samo to tabelo. Dokler je bila v ijppPlan.ts,
// je šel ves medkrajevni načrtovalnik v začetni paket (analiza hitrosti 09.11.2026).
// Tabelo napolni ijppPlan.ts ob združevanju voznega reda.

/** Postajališča, linije in vožnje IJPP imajo id od tu naprej, da se ne prekrivajo z Marpromovimi. */
export const EXT = 1_000_000;

export type IjppRouteInfo = { agency: string; rail: boolean; color: string };

const routeInfo = new Map<number, IjppRouteInfo>();

export function ijppRouteInfo(routeId: number): IjppRouteInfo | undefined {
  return routeInfo.get(routeId);
}
export function setIjppRouteInfo(routeId: number, info: IjppRouteInfo): void {
  routeInfo.set(routeId, info);
}
export const isExtRoute = (routeId: number) => routeId >= EXT;
