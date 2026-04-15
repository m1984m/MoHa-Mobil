export type Weather = { tempC: number; code: number; emoji: string; label: string };

// Open-Meteo: free, no key required. https://open-meteo.com/
// WMO weather codes: https://open-meteo.com/en/docs
const EMOJI_MAP: Record<number, [string, string]> = {
  0: ['☀️', 'Jasno'],
  1: ['🌤️', 'Pretežno jasno'],
  2: ['⛅', 'Delno oblačno'],
  3: ['☁️', 'Oblačno'],
  45: ['🌫️', 'Megla'],
  48: ['🌫️', 'Ivje'],
  51: ['🌦️', 'Rosenje'],
  53: ['🌦️', 'Rosenje'],
  55: ['🌦️', 'Gosto rosenje'],
  61: ['🌧️', 'Dež'],
  63: ['🌧️', 'Dež'],
  65: ['🌧️', 'Močan dež'],
  71: ['🌨️', 'Sneg'],
  73: ['🌨️', 'Sneg'],
  75: ['❄️', 'Močan sneg'],
  80: ['🌦️', 'Ploha'],
  81: ['🌧️', 'Ploha'],
  82: ['⛈️', 'Močna ploha'],
  95: ['⛈️', 'Nevihta'],
  96: ['⛈️', 'Nevihta s točo'],
  99: ['⛈️', 'Močna nevihta'],
};

export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const tempC = j.current?.temperature_2m;
    const code = j.current?.weather_code;
    if (tempC == null || code == null) return null;
    const [emoji, label] = EMOJI_MAP[code] ?? ['🌡️', 'Vreme'];
    return { tempC: Math.round(tempC), code, emoji, label };
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
    const [emoji, label] = EMOJI_MAP[code] ?? ['🌡️', 'Vreme'];

    const hours: string[] = j.hourly?.time ?? [];
    const hT: number[] = j.hourly?.temperature_2m ?? [];
    const hC: number[] = j.hourly?.weather_code ?? [];
    const hP: number[] = j.hourly?.precipitation ?? [];

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hourly: HourPoint[] = [];
    for (let i = 0; i < hours.length; i++) {
      const t = hours[i];
      if (!t.startsWith(today)) continue;
      const h = parseInt(t.slice(11, 13), 10);
      const [em, lab] = EMOJI_MAP[hC[i]] ?? ['🌡️', 'Vreme'];
      hourly.push({ hour: h, tempC: Math.round(hT[i]), code: hC[i], emoji: em, label: lab, precipMm: hP[i] ?? 0 });
    }

    const fmtHM = (iso: string) => iso ? iso.slice(11, 16) : '';
    return {
      tempC, code, emoji, label,
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
