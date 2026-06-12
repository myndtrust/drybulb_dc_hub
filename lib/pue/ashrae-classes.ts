// ─────────────────────────────────────────────────────────────────────────────
// ASHRAE TC 9.9 air-cooling environmental classes (Thermal Guidelines for Data
// Processing Environments, 4th/5th ed).
//
// Each class is a region on the psychrometric chart bounded by:
//   • a dry-bulb temperature range [tMinC, tMaxC]
//   • a LOW moisture limit  = the *moister* (max) of its dew-point and RH floors
//   • a HIGH moisture limit = the *drier* (min) of its dew-point and RH caps
// (per the guideline footnotes — the limiting boundary governs).
//
// Humidity is handled in humidity ratio W (kg/kg) via the ASHRAE-grade
// psychrometrics in ./psychrometrics, so envelopes and climate data share one
// formulation. Limits below are the widely published values; exact vertices
// should be confirmed against the purchased 5th-edition before any compliance use.
// ─────────────────────────────────────────────────────────────────────────────

import {
  P_STD,
  humidityRatio,
  satHumidityRatio,
} from "./psychrometrics";

export type AirClassKey = "recommended" | "a1" | "a2" | "a3" | "a4" | "h1";

export interface AirClass {
  key: AirClassKey;
  label: string;
  /** Dry-bulb range (°C). */
  tMinC: number;
  tMaxC: number;
  /** Low-moisture floor: dew point (°C) and/or RH (%) — the moister governs. */
  lowDewPointC?: number;
  lowRhPct?: number;
  /** High-moisture cap: dew point (°C) and/or RH (%) — the drier governs. */
  highDewPointC?: number;
  highRhPct?: number;
  /** Recommended (tighter) dry-bulb band, where the class also defines one. */
  recTMinC?: number;
  recTMaxC?: number;
}

// Low-moisture floor lowered to −12 °C DP / 8 % RH for the allowable classes in
// the 4th edition; recommended floor is −9 °C DP.
const ALLOW_LOW = { lowDewPointC: -12, lowRhPct: 8 };

export const AIR_CLASSES: Record<AirClassKey, AirClass> = {
  recommended: {
    key: "recommended",
    label: "Recommended",
    tMinC: 18,
    tMaxC: 27,
    lowDewPointC: -9,
    highDewPointC: 15,
    highRhPct: 60,
  },
  a1: { key: "a1", label: "A1", tMinC: 15, tMaxC: 32, ...ALLOW_LOW, highDewPointC: 17, highRhPct: 80 },
  a2: { key: "a2", label: "A2", tMinC: 10, tMaxC: 35, ...ALLOW_LOW, highDewPointC: 21, highRhPct: 80 },
  a3: { key: "a3", label: "A3", tMinC: 5, tMaxC: 40, ...ALLOW_LOW, highDewPointC: 24, highRhPct: 85 },
  a4: { key: "a4", label: "A4", tMinC: 5, tMaxC: 45, ...ALLOW_LOW, highDewPointC: 24, highRhPct: 90 },
  // H1: high-density air-cooled class (5th ed). Narrow band; recommended 18–22 °C,
  // allowable 15–25 °C, moisture limits as A1.
  h1: {
    key: "h1",
    label: "H1 (high-density)",
    tMinC: 15,
    tMaxC: 25,
    recTMinC: 18,
    recTMaxC: 22,
    ...ALLOW_LOW,
    highDewPointC: 17,
    highRhPct: 80,
  },
};

export const AIR_CLASS_ORDER: AirClassKey[] = ["recommended", "a1", "a2", "a3", "a4", "h1"];

/** Driest humidity ratio (kg/kg) allowed at temperature t — the moister of the floors. */
export function lowMoistureW(c: AirClass, tdbC: number, pPa: number = P_STD): number {
  let w = 0;
  if (c.lowDewPointC != null) w = Math.max(w, satHumidityRatio(c.lowDewPointC, pPa));
  if (c.lowRhPct != null) w = Math.max(w, humidityRatio(tdbC, c.lowRhPct, pPa));
  return w;
}

/** Most-moist humidity ratio (kg/kg) allowed at temperature t — the drier of the caps. */
export function highMoistureW(c: AirClass, tdbC: number, pPa: number = P_STD): number {
  let w = Infinity;
  if (c.highDewPointC != null) w = Math.min(w, satHumidityRatio(c.highDewPointC, pPa));
  if (c.highRhPct != null) w = Math.min(w, humidityRatio(tdbC, c.highRhPct, pPa));
  return w;
}

/** Whether a (dry-bulb, humidity-ratio) state lies within the class envelope. */
export function isWithinEnvelope(
  c: AirClass,
  tdbC: number,
  w: number,
  pPa: number = P_STD,
): boolean {
  if (tdbC < c.tMinC || tdbC > c.tMaxC) return false;
  return w >= lowMoistureW(c, tdbC, pPa) - 1e-9 && w <= highMoistureW(c, tdbC, pPa) + 1e-9;
}

/**
 * Closed polygon (dry-bulb °C, humidity ratio kg/kg) tracing the envelope —
 * along the high-moisture boundary left→right, then the low boundary back.
 * Caller scales W to g/kg for the chart.
 */
export function envelopePolygon(
  c: AirClass,
  pPa: number = P_STD,
  stepC = 0.5,
): Array<{ tdbC: number; w: number }> {
  const pts: Array<{ tdbC: number; w: number }> = [];
  for (let t = c.tMinC; t <= c.tMaxC + 1e-9; t += stepC) {
    pts.push({ tdbC: t, w: highMoistureW(c, t, pPa) });
  }
  for (let t = c.tMaxC; t >= c.tMinC - 1e-9; t -= stepC) {
    pts.push({ tdbC: t, w: lowMoistureW(c, t, pPa) });
  }
  return pts;
}

/**
 * Fraction (0–1) and count of hourly states that fall within the envelope.
 * @param hourly parallel arrays of dry-bulb (°C), RH (%), pressure (mbar)
 */
export function hoursWithinEnvelope(
  c: AirClass,
  hourly: { tdb: ArrayLike<number>; rh: ArrayLike<number>; p?: ArrayLike<number> },
): { hours: number; fraction: number } {
  const n = hourly.tdb.length;
  let hours = 0;
  for (let i = 0; i < n; i++) {
    const pPa = hourly.p ? hourly.p[i] * 100 : P_STD; // mbar → Pa
    const w = humidityRatio(hourly.tdb[i], hourly.rh[i], pPa);
    if (isWithinEnvelope(c, hourly.tdb[i], w, pPa)) hours++;
  }
  return { hours, fraction: n ? hours / n : 0 };
}
