// ─────────────────────────────────────────────────────────────────────────────
// Client data layer for TMY3 weather hosted in Supabase Storage.
//   index.json      → the ~1,020-station picker list (fetched once, cached)
//   <usaf>.json     → one station's monthly + 8,760-hour weather (cached per id)
// Falls back to the NASA POWER monthly endpoint when Storage isn't configured
// or a station file is missing (then hourly = null → psychro tab shows a notice).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  HourlyWeather,
  MonthlyWeather,
  StationWeather,
  TmyStation,
} from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const TMY3_ENABLED = Boolean(SUPABASE_URL);

const STORAGE_BASE = SUPABASE_URL
  ? `${SUPABASE_URL}/storage/v1/object/public/tmy3`
  : "";

let indexCache: TmyStation[] | null = null;
const stationCache = new Map<string, StationWeather>();

/** The station picker list (cached for the session). */
export async function fetchStationIndex(): Promise<TmyStation[]> {
  if (indexCache) return indexCache;
  if (!TMY3_ENABLED) return [];
  const res = await fetch(`${STORAGE_BASE}/index.json`);
  if (!res.ok) throw new Error(`station index ${res.status}`);
  indexCache = (await res.json()) as TmyStation[];
  return indexCache;
}

export interface StationWeatherResult {
  monthly: MonthlyWeather;
  hourly: HourlyWeather | null;
  meta?: Pick<TmyStation, "usaf" | "name" | "state" | "lat" | "lon" | "elevationM">;
  source: string;
}

/** One station's weather: TMY3 from Storage, else NASA POWER monthly fallback. */
export async function fetchStationWeather(
  station: Pick<TmyStation, "usaf" | "lat" | "lon">,
): Promise<StationWeatherResult> {
  if (TMY3_ENABLED) {
    try {
      const cached = stationCache.get(station.usaf);
      const rec =
        cached ??
        ((await (await fetchOrThrow(`${STORAGE_BASE}/${station.usaf}.json`)).json()) as StationWeather);
      if (!cached) stationCache.set(station.usaf, rec);
      return {
        monthly: rec.monthly,
        hourly: rec.hourly,
        meta: rec,
        source: rec.source,
      };
    } catch {
      // fall through to NASA POWER
    }
  }
  return fetchNasaMonthly(station.lat, station.lon);
}

async function fetchOrThrow(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

/** Monthly-only fallback via the existing NASA POWER proxy. */
async function fetchNasaMonthly(lat: number, lon: number): Promise<StationWeatherResult> {
  const res = await fetchOrThrow(`/api/weather?lat=${lat}&lon=${lon}`);
  const data = await res.json();
  return {
    monthly: {
      T2M: data.T2M,
      T2MWET: data.T2MWET,
      T2MDEW: data.T2MDEW,
      RH2M: data.RH2M,
    },
    hourly: null,
    source: "NASA POWER — MERRA-2 (monthly fallback)",
  };
}
