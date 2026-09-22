import { tr } from './i18n';

export type Weather = { tempC: number; code: number; emoji: string; label: string };

// Open-Meteo: free, no key required. https://open-meteo.com/
// WMO weather codes: https://open-meteo.com/en/docs
// Opis je funkcija (tr ob klicu), objekti pa ga berejo prek getterja: vreme v App
// preživi menjavo jezika, zato opis ne sme biti zamrznjen ob prenosu.
const EMOJI_MAP: Record<number, [string, () => string]> = {
  0: ['☀️', () => tr('Jasno')],
  1: ['🌤️', () => tr('Pretežno jasno')],
  2: ['⛅', () => tr('Delno oblačno')],
  3: ['☁️', () => tr('Oblačno')],
  45: ['🌫️', () => tr('Megla')],
  48: ['🌫️', () => tr('Ivje')],
  51: ['🌦️', () => tr('Rosenje')],
  53: ['🌦️', () => tr('Rosenje')],
  55: ['🌦️', () => tr('Gosto rosenje')],
  61: ['🌧️', () => tr('Dež')],
  63: ['🌧️', () => tr('Dež')],
  65: ['🌧️', () => tr('Močan dež')],
  71: ['🌨️', () => tr('Sneg')],
  73: ['🌨️', () => tr('Sneg')],
  75: ['❄️', () => tr('Močan sneg')],
  80: ['🌦️', () => tr('Ploha')],
  81: ['🌧️', () => tr('Ploha')],
  82: ['⛈️', () => tr('Močna ploha')],
  95: ['⛈️', () => tr('Nevihta')],
  96: ['⛈️', () => tr('Nevihta s točo')],
  99: ['⛈️', () => tr('Močna nevihta')],
};
const FALLBACK: [string, () => string] = ['🌡️', () => tr('Vreme')];

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const tempC = j.current?.temperature_2m;
    const code = j.current?.weather_code;
    if (tempC == null || code == null) return null;
    const [emoji, label] = EMOJI_MAP[code] ?? FALLBACK;
    return { tempC: Math.round(tempC), code, emoji, get label() { return label(); } };
  } catch {
    return null;
  }
}

export type HourPoint = { hour: number; tempC: number; code: number; emoji: string; label: string; precipMm: number };
export type DayWeather = {
  tempC: number; code: number; emoji: string; label: string;
  tempMin: number; tempMax: number;
  sunrise: string; sunset: string;
  precipSumMm: number; windMaxKmh: number; uvMax: number;
  hourly: HourPoint[];
};

export async function fetchDayWeather(lat: number, lon: number): Promise<DayWeather | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code`
    + `&hourly=temperature_2m,weather_code,precipitation`
    + `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,wind_speed_10m_max,uv_index_max,weather_code`
    + `&forecast_days=1&timezone=auto`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const tempC = Math.round(j.current?.temperature_2m ?? 0);
    const code = j.current?.weather_code ?? 0;
    const [emoji, label] = EMOJI_MAP[code] ?? FALLBACK;

    const hours: string[] = j.hourly?.time ?? [];
    const hT: number[] = j.hourly?.temperature_2m ?? [];
    const hC: number[] = j.hourly?.weather_code ?? [];
    const hP: number[] = j.hourly?.precipitation ?? [];

    const now = new Date();
    // Lokalni datum, NE toISOString (UTC): API s timezone=auto vrača lokalne čase,
    // zato je bil med 00:00 in 01:59 (UTC še prejšnji dan) urni graf prazen.
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const hourly: HourPoint[] = [];
    for (let i = 0; i < hours.length; i++) {
      const t = hours[i];
      if (!t.startsWith(today)) continue;
      const h = parseInt(t.slice(11, 13), 10);
      const [em, lab] = EMOJI_MAP[hC[i]] ?? FALLBACK;
      hourly.push({ hour: h, tempC: Math.round(hT[i]), code: hC[i], emoji: em, get label() { return lab(); }, precipMm: hP[i] ?? 0 });
    }

    const fmtHM = (iso: string) => iso ? iso.slice(11, 16) : '';
    return {
      tempC, code, emoji, get label() { return label(); },
      tempMin: Math.round(j.daily?.temperature_2m_min?.[0] ?? tempC),
      tempMax: Math.round(j.daily?.temperature_2m_max?.[0] ?? tempC),
      sunrise: fmtHM(j.daily?.sunrise?.[0] ?? ''),
      sunset: fmtHM(j.daily?.sunset?.[0] ?? ''),
      precipSumMm: Math.round((j.daily?.precipitation_sum?.[0] ?? 0) * 10) / 10,
      windMaxKmh: Math.round(j.daily?.wind_speed_10m_max?.[0] ?? 0),
      uvMax: Math.round(j.daily?.uv_index_max?.[0] ?? 0),
      hourly,
    };
  } catch {
    return null;
  }
}
