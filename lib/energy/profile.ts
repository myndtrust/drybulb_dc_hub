// ─────────────────────────────────────────────────────────────────────────────
// Hourly utilization profiles + pricing — the building blocks of the energy
// time-series schema. Parametric generators (presets), CSV import, and the
// load-duration / stats helpers, all decoupled from any specific tool's inputs.
// ─────────────────────────────────────────────────────────────────────────────

import { HOURS, type PricingParams, type ProfileParams, type ProfileShape } from "./types";

/** Day-of-week for hour h of a standard year starting Monday (0 = Mon). */
function dayOfWeek(hour: number): number {
  return Math.floor(hour / 24) % 7;
}
function hourOfDay(hour: number): number {
  return hour % 24;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Smooth daily shape (0 at the trough hour → 1 at the peak hour), with the
 * up- and down-legs eased by cosines so the peak and trough can sit at any
 * local hours (asymmetric).
 */
export function dayShape(hod: number, peakHour = 15, troughHour = 4): number {
  const upLen = ((((peakHour - troughHour) % 24) + 24) % 24) || 24;
  const downLen = 24 - upLen;
  const fromTrough = (((hod - troughHour) % 24) + 24) % 24;
  if (fromTrough <= upLen) {
    const t = upLen === 0 ? 1 : fromTrough / upLen;
    return 0.5 - 0.5 * Math.cos(Math.PI * t); // 0 → 1
  }
  const t = downLen === 0 ? 0 : (fromTrough - upLen) / downLen;
  return 0.5 + 0.5 * Math.cos(Math.PI * t); // 1 → 0
}

/** Build an 8,760-hour utilization profile (fractions 0–1) from parameters. */
export function generateProfile(p: ProfileParams): number[] {
  const base = Math.min(p.baseLoadPct, p.peakLoadPct) / 100;
  const peak = Math.max(p.baseLoadPct, p.peakLoadPct) / 100;
  const span = peak - base;
  const peakHour = p.peakHour ?? 15;
  const troughHour = p.troughHour ?? 4;
  const out = new Array<number>(HOURS);
  for (let h = 0; h < HOURS; h++) {
    out[h] = clamp01(shapeValue(p.shape, h, base, span, peak, p.weekendFactor, peakHour, troughHour));
  }
  return out;
}

function shapeValue(
  shape: ProfileShape,
  h: number,
  base: number,
  span: number,
  peak: number,
  weekendFactor: number,
  peakHour: number,
  troughHour: number,
): number {
  const hod = hourOfDay(h);
  const isWeekend = dayOfWeek(h) >= 5;

  switch (shape) {
    case "flat":
      return peak;
    case "diurnal": {
      const daily = base + span * dayShape(hod, peakHour, troughHour);
      return isWeekend ? base + (daily - base) * weekendFactor : daily;
    }
    case "business": {
      if (isWeekend) return base + span * 0.15 * weekendFactor;
      return hod >= 8 && hod < 20 ? peak : base;
    }
    case "ramp":
      return base + span * (h / (HOURS - 1));
    default:
      return peak;
  }
}

/** Force an arbitrary-length series to exactly 8,760 fractional values. */
export function resampleTo8760(values: number[]): number[] {
  const out = new Array<number>(HOURS);
  const n = values.length;
  if (n === 0) return out.fill(0);
  for (let h = 0; h < HOURS; h++) {
    const v = values[Math.min(n - 1, Math.floor((h / HOURS) * n))];
    out[h] = clamp01(v);
  }
  return out;
}

// ── CSV import / export (the 8,760-hour demand schedule) ─────────────────────
// Import: one numeric value per row (a leading "hour" column is auto-skipped,
// extra columns ignored). Values may be fractions (0–1), percentages (0–100),
// or absolute MW — normalized to fractions of the series max — and resampled to
// exactly 8,760 hours.
export function parseDemandCSV(text: string): number[] {
  const nums: number[] = [];
  for (const rawRow of text.split(/\r?\n/)) {
    const cols = rawRow.split(",");
    // Pick the last numeric cell on the row (so "hour,value" works too).
    let val = NaN;
    for (let c = cols.length - 1; c >= 0; c--) {
      const v = parseFloat(cols[c]);
      if (Number.isFinite(v)) { val = v; break; }
    }
    if (Number.isFinite(val)) nums.push(val);
  }
  if (nums.length === 0) throw new Error("No numeric values found in the file.");

  const max = Math.max(...nums);
  if (max <= 0) throw new Error("Demand values must be positive.");

  let divisor = 1;
  if (max > 1.0001 && max <= 100.0001) divisor = 100; // percentages
  else if (max > 100) divisor = max; // absolute → fraction of peak
  return resampleTo8760(nums.map((v) => v / divisor));
}

/** Export an 8,760-hour demand fraction series as "hour,fraction" CSV. */
export function demandToCSV(demand: number[]): string {
  const lines = ["hour,demand_fraction"];
  for (let h = 0; h < demand.length; h++) lines.push(`${h},${(demand[h] ?? 0).toFixed(4)}`);
  return lines.join("\n");
}

// ── Summary & charting ───────────────────────────────────────────────────────

export interface ProfileStats {
  avgUtil: number;
  peakUtil: number;
  minUtil: number;
  fullLoadHours: number;
}

export function profileStats(profile: number[]): ProfileStats {
  let sum = 0;
  let peak = 0;
  let min = 1;
  for (const f of profile) {
    sum += f;
    if (f > peak) peak = f;
    if (f < min) min = f;
  }
  return {
    avgUtil: profile.length ? sum / profile.length : 0,
    peakUtil: peak,
    minUtil: min,
    fullLoadHours: sum,
  };
}

/** Sorted-descending values (a load-duration curve). */
export function loadDurationCurve(series: number[]): number[] {
  return [...series].sort((a, b) => b - a);
}

// ── Pricing ──────────────────────────────────────────────────────────────────
/**
 * Delivered electricity price ($/kWh) for hour h. Gas → a flat effective price
 * from heat rate × fuel price. Grid → flat, or time-of-use inside the peak
 * window.
 */
export function hourlyPrice(p: PricingParams, hour: number): number {
  if (p.source === "gas") {
    return (p.heatRateBtuPerKWh * p.gasPricePerMMBtu) / 1e6;
  }
  if (p.priceMode !== "tou") return p.gridPricePerKWh;
  const hod = hour % 24;
  const { touPeakStartHour: s, touPeakEndHour: e } = p;
  const inPeak = s <= e ? hod >= s && hod < e : hod >= s || hod < e;
  return inPeak ? p.touPeakPerKWh : p.touOffPeakPerKWh;
}
