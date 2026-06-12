// ─────────────────────────────────────────────────────────────────────────────
// Weather parsing — shared by the offline TMY3 ingestion script and the
// client-side "upload your own weather" feature.
//
// Parses EPW (EnergyPlus Weather) and CSV into the app's HourlyWeather shape,
// and derives the 12 MonthlyWeather values by averaging the hourly data through
// the ASHRAE-grade psychrometrics — so monthly and hourly are always consistent.
// ─────────────────────────────────────────────────────────────────────────────

import { MONTH_KEYS } from "./types";
import type { HourlyWeather, MonthlyWeather } from "./types";
import { dewPoint, wetBulb } from "./psychrometrics";

/** Hours in each month of a standard (non-leap) 8,760-hour year. */
const MONTH_HOURS = [744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744];

export interface ParsedStationMeta {
  usaf: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  elevationM: number;
}

export interface ParsedWeather {
  meta?: ParsedStationMeta;
  hourly: HourlyWeather;
}

// ── EPW ──────────────────────────────────────────────────────────────────────
// Line 1 is the LOCATION header:
//   LOCATION,City,State,Country,Source,WMO,Lat,Lon,TZ,Elevation
// Data rows begin at line 9. Field indices (0-based) on each data row:
//   6 = dry-bulb °C, 7 = dew point °C, 8 = RH %, 9 = atmospheric pressure Pa.
export function parseEPW(text: string): ParsedWeather {
  const lines = text.split(/\r?\n/);
  if (lines.length < 9) throw new Error("Not a valid EPW file (too few lines).");

  const loc = lines[0].split(",");
  const meta: ParsedStationMeta | undefined =
    loc[0]?.toUpperCase() === "LOCATION"
      ? {
          name: (loc[1] ?? "").trim(),
          state: (loc[2] ?? "").trim(),
          usaf: (loc[5] ?? "").trim(),
          lat: parseFloat(loc[6]),
          lon: parseFloat(loc[7]),
          elevationM: parseFloat(loc[9]),
        }
      : undefined;

  const tdb: number[] = [];
  const rh: number[] = [];
  const p: number[] = [];
  for (let i = 8; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < 10) continue;
    const t = parseFloat(c[6]);
    const r = parseFloat(c[8]);
    const paPa = parseFloat(c[9]);
    if (Number.isNaN(t) || Number.isNaN(r)) continue;
    tdb.push(t);
    rh.push(clampRh(r));
    p.push(Number.isNaN(paPa) || paPa <= 0 ? 1013.25 : paPa / 100); // Pa → mbar
  }
  return { meta, hourly: { tdb, rh, p } };
}

// ── CSV ──────────────────────────────────────────────────────────────────────
// Accepts a simple user CSV (header-aware: finds dry-bulb / RH / pressure
// columns; otherwise assumes col0 = dry-bulb °C, col1 = RH %) and the NREL TMY3
// CSV layout (2 header lines, then columns incl. "Dry-bulb (C)", "RHum (%)",
// "Pressure (mbar)").
export function parseWeatherCSV(text: string): ParsedWeather {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) throw new Error("Empty CSV.");

  // TMY3 CSV: first line is station metadata (USAF,name,state,...), second is the
  // column header row. Detect by the presence of a "Date (MM/DD/YYYY)" column.
  const looksTmy3 = /date\s*\(mm/i.test(lines[1] ?? "");
  const headerIdx = looksTmy3 ? 1 : /[a-df-z]/i.test(lines[0].replace(/e[+-]?\d/gi, "")) ? 0 : -1;

  let ti = 0;
  let ri = 1;
  let pi = -1;
  let start = 0;
  if (headerIdx >= 0) {
    const cols = lines[headerIdx].toLowerCase().split(",").map((s) => s.trim());
    const find = (...k: string[]) => cols.findIndex((col) => k.some((x) => col.includes(x)));
    const t = find("dry-bulb", "dry bulb", "dbt", "tdb", "temp");
    const r = find("rhum", "rh", "humid");
    const pp = find("pressure", "pabs", "mbar", "pres");
    ti = t < 0 ? 0 : t;
    ri = r < 0 ? 1 : r;
    pi = pp;
    start = headerIdx + 1;
  }

  const tdb: number[] = [];
  const rh: number[] = [];
  const p: number[] = [];
  for (let i = start; i < lines.length; i++) {
    const c = lines[i].split(",");
    const t = parseFloat(c[ti]);
    const r = parseFloat(c[ri]);
    if (Number.isNaN(t) || Number.isNaN(r)) continue;
    tdb.push(t);
    rh.push(clampRh(r));
    const pv = pi >= 0 ? parseFloat(c[pi]) : NaN;
    p.push(Number.isNaN(pv) || pv <= 0 ? 1013.25 : pv);
  }
  return { hourly: { tdb, rh, p } };
}

/** Auto-detect format by extension/content and parse. (.xlsx handled by caller via dynamic import.) */
export function parseWeather(filename: string, text: string): ParsedWeather {
  return filename.toLowerCase().endsWith(".epw") || /^location,/i.test(text)
    ? parseEPW(text)
    : parseWeatherCSV(text);
}

// ── Monthly derivation ───────────────────────────────────────────────────────
/**
 * Average the hourly series into the 12 MonthlyWeather values, computing wet-bulb
 * and dew point per hour (at that hour's pressure) before averaging — so the
 * monthly figures are physically consistent with the hourly cloud.
 */
export function deriveMonthly(hourly: HourlyWeather): MonthlyWeather {
  const T2M: Record<string, number> = {};
  const T2MWET: Record<string, number> = {};
  const T2MDEW: Record<string, number> = {};
  const RH2M: Record<string, number> = {};

  let h = 0;
  for (let m = 0; m < 12; m++) {
    const n = MONTH_HOURS[m];
    let st = 0;
    let swb = 0;
    let sdp = 0;
    let srh = 0;
    let count = 0;
    for (let k = 0; k < n && h < hourly.tdb.length; k++, h++) {
      const t = hourly.tdb[h];
      const r = hourly.rh[h];
      const pPa = (hourly.p[h] ?? 1013.25) * 100;
      st += t;
      srh += r;
      swb += wetBulb(t, r, pPa);
      sdp += dewPoint(t, r, pPa);
      count++;
    }
    const key = MONTH_KEYS[m];
    const d = count || 1;
    T2M[key] = st / d;
    T2MWET[key] = swb / d;
    T2MDEW[key] = sdp / d;
    RH2M[key] = srh / d;
  }
  return { T2M, T2MWET, T2MDEW, RH2M };
}

function clampRh(r: number): number {
  return Math.max(1, Math.min(100, r));
}
