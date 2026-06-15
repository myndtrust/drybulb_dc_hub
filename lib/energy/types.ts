// ─────────────────────────────────────────────────────────────────────────────
// Energy time-series schema
//
// One hourly vector = number[] of length 8,760. A site's total energy model
// composes several vectors:
//   itMW[h]       — IT power demand, summed across differentiated services
//   pue[h]        — weather-driven hourly PUE for the chosen city (flat fallback)
//   facilityMW[h] — itMW[h] × pue[h]  ← the per-city energy-requirement vector
//   price[h]      — $/kWh (flat / time-of-use / gas-derived)
//
// This schema is shared infrastructure: the cost model consumes it today, and
// future total-energy work (grid price series, carbon, storage dispatch) adds
// more vectors composed by buildEnergyModel(). See lib/energy/README.md.
// ─────────────────────────────────────────────────────────────────────────────

import type { CoolingType } from "@/lib/pue/types";

export const HOURS = 8760;

// ── Load profiles ────────────────────────────────────────────────────────────

export type ProfileShape = "flat" | "diurnal" | "business" | "ramp";

export interface ProfileParams {
  shape: ProfileShape;
  /** Floor utilization, % of the channel's allocated capacity. */
  baseLoadPct: number;
  /** Ceiling utilization, %. */
  peakLoadPct: number;
  /** Weekend swing scaling (1 = no change, 0 = flat at base). */
  weekendFactor: number;
  /** Local hour (0–23) of the daily peak (diurnal shape). Default 15. */
  peakHour?: number;
  /** Local hour (0–23) of the daily trough (diurnal shape). Default 4. */
  troughHour?: number;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

export type PowerSource = "grid" | "gas";
export type PriceMode = "flat" | "tou";

export interface PricingParams {
  source: PowerSource;
  priceMode: PriceMode;
  gridPricePerKWh: number;
  touPeakPerKWh: number;
  touOffPeakPerKWh: number;
  touPeakStartHour: number;
  touPeakEndHour: number;
  heatRateBtuPerKWh: number;
  gasPricePerMMBtu: number;
}

// ── Differentiated service channels ──────────────────────────────────────────

// ── Synthetic demand model (the "Diurnal / statistical" Scheduler path) ──────
export type DemandSource = "preset" | "model" | "custom";
export type SynthMethod = "additive" | "sampling";
export type Distribution = "normal" | "uniform" | "triangular" | "beta";

export interface SynthModel {
  method: SynthMethod;
  /** Average demand, % of peak. */
  baseLevelPct: number;
  /** Daily swing amplitude, % of peak. */
  diurnalAmpPct: number;
  /** Hour of day (0–23) the daily peak occurs. */
  peakHour: number;
  /** Hour of day (0–23) the daily trough occurs. */
  troughHour: number;
  /** Seasonal swing amplitude, % of peak. */
  seasonalAmpPct: number;
  /** Month (1–12) the seasonal peak occurs. */
  peakMonth: number;
  /** Linear growth over the year, % of peak (can be negative). */
  trendPct: number;
  /** Variability distribution. */
  dist: Distribution;
  /** Variability magnitude, % of peak. */
  spreadPct: number;
  /** RNG seed (reproducible). */
  seed: number;
}

export interface ServiceChannel {
  id: string;
  label: string;
  /** Peak demand of this service (MW). Its hourly demand = peakDemandMW × demand[h]. */
  peakDemandMW: number;
  /**
   * The 8,760-hour demand schedule — the source of truth. Each value is a
   * fraction (0–1) of peakDemandMW for that hour of the year. Edited in the
   * Scheduler, replaceable by CSV.
   */
  demand: number[];
  /** Which builder produced `demand`. */
  demandSource: DemandSource;
  /** Preset params (the "preset" source). */
  profile: ProfileParams;
  /** Statistical model params (the "model" source). */
  model: SynthModel;
  /** Unit price: $ per MWh of IT delivered by this service. */
  unitPricePerMWh: number;
}

// ── Cooling configuration (compact subset the hourly PUE engine needs) ───────

export interface CoolingConfig {
  coolingType: CoolingType;
  /** Supply-air setpoint (°C). */
  supplyAirTemp: number;
  /** Share of IT heat removed by direct-to-chip liquid cooling (%). */
  liquidCoolingPct: number;
}

// ── Results ──────────────────────────────────────────────────────────────────

export interface ServiceResult {
  id: string;
  label: string;
  capacityMW: number;
  avgUtil: number;
  annualRevenue: number;
}

export interface EnergyModel {
  pue: number[];
  itMW: number[];
  facilityMW: number[];
  price: number[]; // $/kWh
  annualITMWh: number;
  annualFacilityMWh: number;
  annualEnergyCost: number;
  avgPue: number;
  avgUtil: number;
  services: ServiceResult[];
  annualRevenue: number;
  /** True when PUE came from city weather rather than the flat fallback. */
  weatherCoupled: boolean;
}
