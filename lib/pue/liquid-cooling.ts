// ─────────────────────────────────────────────────────────────────────────────
// ASHRAE TC 9.9 liquid-cooling classes + climate-driven free-cooling analysis.
//
//   W-classes (FWS, Facility Water Supply) and S-classes (TCS, Technology
//   Cooling System — the fluid the silicon actually sees) define the MAXIMUM
//   supply-water temperature delivered to the loop. Source: ASHRAE TC 9.9
//   "Thermal Guidelines… Past, Present, Future" (2025) slides 25–26.
//
// This module provides the class data and the *deterministic* free-cooling
// analysis: for a chosen class + heat-rejection path, how many of the 8,760
// hours can be served chiller-free (achievable supply temp ≤ class limit).
// The cooling-energy / pPUE numbers are produced by the ASHRAE-90.4 hourly
// engine (lib/pue/energy-model.ts, Phase 6), which consumes this — keeping the
// heuristic energy math out of here.
// ─────────────────────────────────────────────────────────────────────────────

import { P_STD, wetBulb } from "./psychrometrics";

export type LiquidFamily = "W" | "S";

export interface LiquidClass {
  key: string;
  family: LiquidFamily;
  /** Maximum supply-water temperature for the class (°C). */
  supplyMaxC: number;
}

// FWS — facility water supply (max temp). Minimum water temp for all W-classes
// is 2 °C. "W+" is open-ended (>45 °C); modeled with a high cap for plotting.
export const W_CLASSES: LiquidClass[] = [
  { key: "W17", family: "W", supplyMaxC: 17 },
  { key: "W27", family: "W", supplyMaxC: 27 },
  { key: "W32", family: "W", supplyMaxC: 32 },
  { key: "W40", family: "W", supplyMaxC: 40 },
  { key: "W45", family: "W", supplyMaxC: 45 },
  { key: "W+", family: "W", supplyMaxC: 60 },
];

// TCS — technology cooling system supply (max temp). Minimum is dew point + 2 °C
// (condensation guard). TCS runs warmer than FWS because of the CDU approach.
export const S_CLASSES: LiquidClass[] = [
  { key: "S30", family: "S", supplyMaxC: 30 },
  { key: "S35", family: "S", supplyMaxC: 35 },
  { key: "S40", family: "S", supplyMaxC: 40 },
  { key: "S45", family: "S", supplyMaxC: 45 },
  { key: "S50", family: "S", supplyMaxC: 50 },
];

export const W_MIN_SUPPLY_C = 2;
/** Condensation guard for TCS supply: dew point + this margin (°C). */
export const S_DEWPOINT_MARGIN_C = 2;

export function liquidClasses(family: LiquidFamily): LiquidClass[] {
  return family === "W" ? W_CLASSES : S_CLASSES;
}

export function findLiquidClass(key: string): LiquidClass | undefined {
  return [...W_CLASSES, ...S_CLASSES].find((c) => c.key === key);
}

// Heat-rejection path sets which outdoor temperature limits the achievable
// water temperature: a dry cooler is limited by dry-bulb; a cooling tower or
// evaporative device is limited by wet-bulb.
export type HeatRejection = "dry-cooler" | "cooling-tower" | "evaporative";

export function isWetBulbLimited(r: HeatRejection): boolean {
  return r === "cooling-tower" || r === "evaporative";
}

export interface FreeCoolingOptions {
  supplyMaxC: number;
  rejection: HeatRejection;
  /** Approach ΔT between the limiting outdoor temp and the achievable water temp (°C). */
  approachC: number;
}

export interface HourlyWeatherLike {
  tdb: ArrayLike<number>; // °C
  rh: ArrayLike<number>; // %
  p?: ArrayLike<number>; // mbar (optional; sea level assumed if absent)
}

/**
 * The limiting outdoor temperature for each hour given the heat-rejection path
 * (dry-bulb for a dry cooler, wet-bulb otherwise).
 */
export function limitingTemps(hourly: HourlyWeatherLike, rejection: HeatRejection): Float64Array {
  const n = hourly.tdb.length;
  const out = new Float64Array(n);
  const wb = isWetBulbLimited(rejection);
  for (let i = 0; i < n; i++) {
    if (wb) {
      const pPa = hourly.p ? hourly.p[i] * 100 : P_STD;
      out[i] = wetBulb(hourly.tdb[i], hourly.rh[i], pPa);
    } else {
      out[i] = hourly.tdb[i];
    }
  }
  return out;
}

export interface FreeCoolingProfile {
  /** Hours per year servable chiller-free. */
  freeHours: number;
  /** Fraction of the year (0–1) servable chiller-free. */
  freeFraction: number;
  /** The class supply-temperature ceiling used (°C). */
  supplyMaxC: number;
  /** Achievable supply-water temp each hour (= limiting temp + approach), °C. */
  achievableC: Float64Array;
  /** achievableC sorted descending — the load-duration curve for plotting. */
  durationCurveC: Float64Array;
}

/**
 * Deterministic free-cooling analysis over the 8,760 hours. An hour is
 * chiller-free when the achievable supply-water temperature (limiting outdoor
 * temp + approach) is at or below the class ceiling.
 */
export function freeCoolingProfile(
  hourly: HourlyWeatherLike,
  opts: FreeCoolingOptions,
): FreeCoolingProfile {
  const lim = limitingTemps(hourly, opts.rejection);
  const n = lim.length;
  const achievable = new Float64Array(n);
  let free = 0;
  for (let i = 0; i < n; i++) {
    achievable[i] = lim[i] + opts.approachC;
    if (achievable[i] <= opts.supplyMaxC) free++;
  }
  const durationCurve = Float64Array.from(achievable).sort((a, b) => b - a);
  return {
    freeHours: free,
    freeFraction: n ? free / n : 0,
    supplyMaxC: opts.supplyMaxC,
    achievableC: achievable,
    durationCurveC: durationCurve,
  };
}
