export function getLocation(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Ni geolokacije'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 30000,
    });
  });
}

// Živa sledilna pozicija prek watchPosition. Vrne unsubscribe funkcijo.
// Kličeta ga App.svelte in poljubni drugi consumer-ji; več paralelnih watch-ov
// je ok — brskalnik deduplicira na OS nivoju.
export function watchLocation(
  onUpdate: (p: { lat: number; lon: number; accuracy: number }) => void,
  onError?: (err: GeolocationPositionError) => void,
): () => void {
  if (!navigator.geolocation) return () => {};
  const id = navigator.geolocation.watchPosition(
    (pos) => onUpdate({
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    }),
    (err) => onError?.(err),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

// Maribor center fallback
export const MARIBOR = { lat: 46.5547, lon: 15.6459 };
