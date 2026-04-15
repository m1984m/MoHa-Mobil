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

// Maribor center fallback
export const MARIBOR = { lat: 46.5547, lon: 15.6459 };
