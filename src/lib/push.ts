import { writable, get } from 'svelte/store';
import { tick } from 'svelte';
import type { GTFS } from './gtfs';
import { computeOccurrences, pruneFiredOnce } from './alarms';
import type { Alarm, Occurrence } from './alarms';
import { tr, lang } from './i18n';

// Potisna obvestila za alarme. Odjemalec samo naroči napravo in strežniku pove,
// KDAJ naj zazvoni in KAJ naj piše (glej alarms.computeOccurrences); vse ostalo
// (razpored, VAPID podpis, pošiljanje) je na Workerju.
//
// Pravilo: nobena od teh funkcij ne sme vreči izjeme v UI. Napaka se pokaže kot
// besedilo v pushState.error, omrežni klici imajo trdo časovno omejitev.

const API = String(import.meta.env.VITE_ALARM_API ?? '').replace(/\/+$/, '');
const VAPID = String(import.meta.env.VITE_VAPID_PUBLIC ?? '').trim();
const TIMEOUT_MS = 8000;

export function pushSupported(): boolean {
  return typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && typeof window !== 'undefined'
    && 'PushManager' in window
    && 'Notification' in window;
}

export function isStandalone(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    return (navigator as any).standalone === true;
  } catch { return false; }
}

export function isIOS(): boolean {
  try {
    const ua = navigator.userAgent || '';
    // iPadOS 13+ se predstavlja kot Macintosh — loči ga zaslon na dotik.
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  } catch { return false; }
}

export type PushState = {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  endpoint: string | null;
  lastSync: number | null;
  count: number;          // koliko ponovitev ima strežnik v vrsti
  until: number | null;   // do kdaj so alarmi pokriti (ms)
  error: string | null;
  busy: boolean;
};

function currentPermission(): NotificationPermission {
  try {
    if (typeof Notification === 'undefined') return 'default';
    return Notification.permission;
  } catch { return 'default'; }
}

export const pushState = writable<PushState>({
  supported: pushSupported(),
  permission: currentPermission(),
  subscribed: false,
  endpoint: null,
  lastSync: null,
  count: 0,
  until: null,
  error: null,
  busy: false,
});

function patch(p: Partial<PushState>) {
  pushState.update(s => ({ ...s, ...p }));
}

// ── pomožne ──────────────────────────────────────────────────────────────────

// Vračamo Uint8Array<ArrayBuffer> (ne privzetega ArrayBufferLike): applicationServerKey
// zahteva pogled na pravi ArrayBuffer, sicer TS zavrne zaradi SharedArrayBuffer.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Vsak omrežni klic ima svoj AbortController — AbortSignal.timeout še ni povsod
// (starejši iOS). Napaka nikoli ne pobegne: vrne null.
async function req(path: string, init: RequestInit = {}): Promise<any | null> {
  if (!API) return null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(API + path, { ...init, signal: ctl.signal });
    if (!r.ok) return null;
    const txt = await r.text();
    return txt ? JSON.parse(txt) : {};
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// navigator.serviceWorker.ready se v razvoju (SW se registrira samo v PROD) ne
// razreši nikoli — zato dirka s časovno omejitvijo.
async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>(res => setTimeout(() => res(null), TIMEOUT_MS)),
    ]);
  } catch { return null; }
}

async function getSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await getRegistration();
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

function subPayload(sub: PushSubscription): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  try {
    const j: any = sub.toJSON();
    if (!j || !j.endpoint || !j.keys || !j.keys.p256dh || !j.keys.auth) return null;
    return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
  } catch { return null; }
}

function iconUrl(name: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '/');
  return `${base}${name}`;
}

// Zadnja znana naročnina. Hranimo jo, ker ob zapiranju strani ni več časa za
// asinhroni getSubscription() — sendBeacon potrebuje telo takoj.
let lastSubscription: { endpoint: string; keys: { p256dh: string; auth: string } } | null = null;

// Teče ensureSubscribed? syncAlarms počaka nanj, sicer bi ravno ob rotaciji
// endpointa dobil null in tiho odstopil.
let readyPromise: Promise<boolean> | null = null;

// ── javni API ────────────────────────────────────────────────────────────────

/**
 * Vklopi obvestila. MORA biti klican neposredno iz uporabnikove geste (tap na gumb),
 * sicer brskalnik zavrne Notification.requestPermission().
 * Vrne true samo, če je naprava naročena in je sinhronizacija stekla.
 */
export async function enablePush(occ: Occurrence[] = []): Promise<boolean> {
  patch({ busy: true, error: null });
  try {
    if (!pushSupported()) {
      patch({ supported: false, error: tr('Ta brskalnik ne podpira potisnih obvestil.') });
      return false;
    }
    if (isIOS() && !isStandalone()) {
      patch({ error: tr('Na iPhonu in iPadu obvestila delujejo šele, ko aplikacijo dodaš na začetni zaslon: Deli → Dodaj na začetni zaslon, nato jo odpri s te ikone.') });
      return false;
    }
    if (!VAPID) {
      patch({ error: tr('Strežniški ključ za obvestila ni nastavljen (VITE_VAPID_PUBLIC) — obvestil ni mogoče vklopiti.') });
      return false;
    }

    const perm = await Notification.requestPermission();
    patch({ permission: perm });
    if (perm !== 'granted') {
      patch({ error: tr('Dovoljenje za obvestila ni bilo dano. Vklopiš ga lahko v nastavitvah brskalnika za to stran.') });
      return false;
    }

    const reg = await getRegistration();
    if (!reg) {
      patch({ error: tr('Storitveni delavec ni na voljo — obvestila delujejo samo v nameščeni (objavljeni) različici aplikacije.') });
      return false;
    }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      });
    }
    patch({ subscribed: true, endpoint: sub.endpoint, error: null });

    // true samo, če je strežnik razpored res sprejel (F13: »Shranjeno« naj to odraža).
    return await syncAlarms(occ);
  } catch (e: any) {
    patch({ error: tr('Obvestil ni bilo mogoče vklopiti: {msg}', { msg: e?.message ?? tr('neznana napaka') }) });
    return false;
  } finally {
    patch({ busy: false });
  }
}

/** Izklopi obvestila: odjavi naročnino in jo umakne s strežnika. */
export async function disablePush(): Promise<void> {
  patch({ busy: true, error: null });
  try {
    const sub = await getSubscription();
    const endpoint = sub?.endpoint ?? null;
    if (sub) { try { await sub.unsubscribe(); } catch {} }
    if (endpoint) {
      await req('/sync', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      });
    }
    patch({ subscribed: false, endpoint: null, count: 0, until: null, lastSync: null });
  } finally {
    patch({ busy: false });
  }
}

// Meje Workerja (worker/src/worker.js). Worker validira strogo: EN SAM vnos, ki jih
// prekrši, pomeni 400 za celotno telo — ne le za tisti vnos. Zato jih uveljavimo že
// tu in raje obrežemo, kot da bi izgubili celotno sinhronizacijo.
const MAX_OCCURRENCES = 500;
const MAX_ID = 100;          // id in tag
const MAX_TEXT = 200;        // title in body
const MAX_AHEAD_MS = 120 * 24 * 3600 * 1000;
const MAX_BODY_BYTES = 256 * 1024;
const BODY_RESERVE = 2048;   // naročnina + ovoj JSON okoli seznama
// Zvonjenja, ki so preblizu zdaj, izpustimo: ponovitve so izračunane prej, scheduleSync
// jih zadrži še ~1 s, nato gre omrežni klic — brez rezerve bi prav ob zvonjenju alarma
// v telo ušel vnos, ki je medtem zapadel, in Worker bi zavrnil VSE.
const FIRE_GUARD_MS = 30_000;

// `lang`: jezik besedila; storitveni delavec z njim prevede svoje nadomestno besedilo
// (npr. »Zamujeno opozorilo«), ki ga sicer ne zna (F29).
export type SyncItem = { id: string; fireAt: number; title: string; body: string; tag: string; url: string; lang: string };

function cut(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

function byteLen(s: string): number {
  try { return new TextEncoder().encode(s).length; } catch { return s.length * 2; }
}

/**
 * Pripravi telo za /sync: odstrani zapadla in predaljna zvonjenja, obreže besedila na
 * meje Workerja in omeji dolžino seznama. Prazen rezultat je veljavno stanje — pomeni
 * "ta naprava nima nič v vrsti" in na strežniku izprazni alarme.
 */
export function prepareOccurrences(occ: Occurrence[], now: number = Date.now()): SyncItem[] {
  const floor = now + FIRE_GUARD_MS;
  const ceil = now + MAX_AHEAD_MS;
  const kept: SyncItem[] = [];
  const jezik = get(lang);
  for (const o of occ) {
    if (!isFinite(o.fireAt) || o.fireAt <= floor || o.fireAt > ceil) continue;
    const tag = cut(o.tag, MAX_ID);
    kept.push({
      id: tag,
      fireAt: o.fireAt,
      title: cut(o.title, MAX_TEXT),
      body: cut(o.body, MAX_TEXT),
      tag,
      url: '/',
      lang: jezik,
    });
  }
  kept.sort((a, b) => a.fireAt - b.fireAt);
  // Najprej odreži po številu (odpadejo najbolj oddaljena zvonjenja — najmanj nujna),
  // nato še po velikosti telesa, ki jo Worker meri v bajtih.
  let list = kept.slice(0, MAX_OCCURRENCES);
  while (list.length > 1 && byteLen(JSON.stringify(list)) + BODY_RESERVE > MAX_BODY_BYTES) {
    list = list.slice(0, Math.max(1, Math.floor(list.length * 0.9)));
  }
  return list;
}

/**
 * Pošlje strežniku celoten razpored zvonjenja. Brez naročnine tiho ne naredi ničesar —
 * to je normalno stanje pred prvim vklopom obvestil. Prazen razpored strežnik razume
 * kot izbris zapisa naročnine (F25): brez opomnikov na strežniku ne ostane nič.
 * Vrne true, kadar je strežnik razpored sprejel.
 */
export async function syncAlarms(occ: Occurrence[]): Promise<boolean> {
  let sub = await getSubscription();
  // Ob zagonu teče ensureSubscribed s svojim omrežnim klicem (0,2–2 s). Debounce
  // scheduleSync je krajši, zato bi brez tega čakanja prišli sem, ko naročnine še ni,
  // in strežnik bi za nov endpoint ostal brez zvonjenj — brez vidne napake.
  if (!sub && readyPromise) {
    await readyPromise;
    sub = await getSubscription();
  }
  if (!sub) return false;
  const subscription = subPayload(sub);
  if (!subscription) return false;
  lastSubscription = subscription;

  // Filtriramo tik pred oddajo, ne ob izračunu — med izračunom in tem trenutkom je
  // minil debounce in morda še čakanje na naročnino.
  const items = prepareOccurrences(occ);

  const res = await req('/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription, occurrences: items }),
  });
  if (res === null) {
    patch({ error: tr('Alarmov ni bilo mogoče uskladiti s strežnikom. Poskusimo znova ob naslednjem zagonu.') });
    return false;
  }
  const until = items.length > 0 ? items[items.length - 1].fireAt : null;
  patch({
    subscribed: true,
    endpoint: sub.endpoint,
    lastSync: Date.now(),
    count: typeof res.count === 'number' ? res.count : items.length,
    until: typeof res.until === 'number' ? res.until : until,
    error: null,
  });
  return true;
}

/** Osveži stanje s strežnika (koliko zvonjenj čaka v vrsti in do kdaj). */
export async function refreshStatus(): Promise<void> {
  const sub = await getSubscription();
  if (!sub) {
    patch({ subscribed: false, endpoint: null, count: 0, until: null });
    return;
  }
  const res = await req(`/status?endpoint=${encodeURIComponent(sub.endpoint)}`);
  if (res === null) return;
  // Strežnik brez zapisa pomeni samo, da ni zvonjenj v vrsti: zapis se ob praznem
  // razporedu izbriše (F25) in ga naslednja uskladitev ustvari znova. Naprava je
  // naročena, dokler ima brskalnik naročnino.
  patch({
    endpoint: sub.endpoint,
    subscribed: true,
    count: typeof res.count === 'number' ? res.count : 0,
    until: typeof res.until === 'number' ? res.until : null,
  });
}

/**
 * Ob zagonu: preveri, ali naročnina še obstaja. Brskalniki jo tiho zavržejo
 * (rotacija endpointa, počiščeni podatki strani) — takrat se, če je dovoljenje
 * še vedno dano, tiho naročimo znova; klicatelj naj nato pošlje syncAlarms.
 */
export function ensureSubscribed(): Promise<boolean> {
  readyPromise = doEnsureSubscribed();
  return readyPromise;
}

async function doEnsureSubscribed(): Promise<boolean> {
  const perm = currentPermission();
  patch({ supported: pushSupported(), permission: perm });
  if (!pushSupported() || perm !== 'granted') {
    patch({ subscribed: false });
    return false;
  }
  try {
    const reg = await getRegistration();
    if (!reg) return false;
    let sub = await reg.pushManager.getSubscription();
    let created = false;
    if (!sub && VAPID) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      });
      created = true;
    }
    if (!sub) return false;
    lastSubscription = subPayload(sub) ?? lastSubscription;
    patch({ subscribed: true, endpoint: sub.endpoint });
    // Sveže naročnine strežnik še ne pozna: refreshStatus bi vrnil subscribed=false
    // in uporabnik bi bral, da so obvestila izklopljena. Registrira jo šele
    // syncAlarms, ki ga sproži scheduleSync takoj za tem.
    if (!created) await refreshStatus();
    return true;
  } catch {
    return false;
  }
}

/** Takojšnje lokalno obvestilo — preizkus deluje tudi, če strežnik ni dosegljiv. */
export async function showLocalTest(): Promise<boolean> {
  try {
    if (!('Notification' in window)) {
      patch({ error: tr('Ta brskalnik ne podpira obvestil. Na iPhonu najprej dodaj aplikacijo na začetni zaslon.') });
      return false;
    }
    if (currentPermission() !== 'granted') {
      const perm = await Notification.requestPermission();
      patch({ permission: perm });
      if (perm !== 'granted') {
        patch({ error: tr('Obvestila niso dovoljena. Dovoli jih v nastavitvah telefona ali brskalnika in poskusi znova.') });
        return false;
      }
    }
    const reg = await getRegistration();
    const opts: NotificationOptions = {
      body: tr('Tako bo videti alarm za odhod.'),
      tag: 'mm-test',
      icon: iconUrl('icon-192.svg'),
      badge: iconUrl('icon-maskable.svg'),
      data: { url: '/' },
      silent: false,
    };
    const title = tr('Preizkus obvestila');
    if (reg) {
      await reg.showNotification(title, opts);
      return true;
    }
    // Brez storitvenega delavca (razvoj v brskalniku) — navadno obvestilo.
    new Notification(title, opts);
    return true;
  } catch {
    patch({ error: tr('Preizkusnega obvestila ni bilo mogoče prikazati.') });
    return false;
  }
}

// ── samodejna uskladitev ─────────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSync: { gtfs: GTFS; list: Alarm[] } | null = null;

/**
 * Preračuna ponovitve in jih z zamikom pošlje strežniku. Zamik združi rafal
 * sprememb v urejevalniku (vsak pritisk na dan/uro) v eno samo zahtevo.
 */
export function scheduleSync(gtfs: GTFS | null, list: Alarm[], delayMs = 1000): void {
  if (!gtfs) return;
  pendingSync = { gtfs, list };
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const p = pendingSync;
    pendingSync = null;
    if (!p) return;
    // Enkratni opomniki, ki so že zazvonili, odpadejo (F13); sprememba seznama sproži
    // novo uskladitev prek App, ta pa nima več kaj odstraniti.
    pruneFiredOnce();
    void syncAlarms(computeOccurrences(p.gtfs, p.list));
  }, delayMs);
}

/**
 * Uskladi takoj in počaka na odgovor strežnika (čarovnik: »Shranjeno« šele, ko je
 * strežnik razpored sprejel — F13). Prej odloženo uskladitev nadomesti.
 */
export async function syncNow(gtfs: GTFS | null, list: Alarm[]): Promise<boolean> {
  if (!gtfs) return false;
  // Sprememba seznama je App že sprožila scheduleSync (ob naslednjem izrisu) — počakamo
  // nanj in ga prekličemo, da ne gre na strežnik še ena enaka zahteva.
  await tick();
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  pendingSync = null;
  return syncAlarms(computeOccurrences(gtfs, list));
}

/**
 * Takoj odda čakajočo sinhronizacijo. Kliče se ob skritju/zapiranju strani: brez tega
 * uporabnik izklopi opomnik in pol sekunde kasneje zapre aplikacijo, časovnik umre,
 * strežnik pa naslednje jutro zvoni za opomnik, ki ga ni več.
 *
 * sendBeacon preživi zapiranje strani, fetch ne. Telo pošljemo kot text/plain, da
 * ostane preprosta zahteva brez preflighta (Worker bere request.text() in razčleni
 * JSON, glave content-type ne gleda). Vrne true, če je bilo kaj oddano.
 */
export function flushPendingSync(): boolean {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
  const p = pendingSync;
  pendingSync = null;
  if (!p) return false;
  const items = prepareOccurrences(computeOccurrences(p.gtfs, p.list));
  if (!API || !lastSubscription) return false;
  const body = JSON.stringify({ subscription: lastSubscription, occurrences: items });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(`${API}/sync`, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return true;
    }
  } catch {}
  // Zadnja možnost: navadna zahteva. Če stran res odhaja, jo brskalnik lahko ubije.
  void req('/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  return true;
}

// visibilitychange (hidden) je edini dogodek, na katerega se da na mobilnem zanesti —
// pagehide je dodatna varovalka za namizne brskalnike.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingSync();
  });
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => { flushPendingSync(); });
}
