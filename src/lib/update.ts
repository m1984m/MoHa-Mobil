import { writable } from 'svelte/store';

// Waiting ServiceWorker, ki čaka aktivacijo. Set v main.ts ob `updatefound`,
// reset po `postMessage SKIP_WAITING` + reload.
export const updateAvailable = writable<ServiceWorker | null>(null);
