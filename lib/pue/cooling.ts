// ─────────────────────────────────────────────────────────────────────────────
// Cooling COP primitives — shared by the monthly PUE engine (calculations.ts)
// and the hourly PUE engine (hourly.ts).
//
// The model is linear in IT load: every term (cooling, UPS, PDU, lighting)
// scales with the IT load, so the resulting PUE depends only on weather and the
// cooling configuration — not on the load magnitude.
// ─────────────────────────────────────────────────────────────────────────────

import type { CoolingSystem } from "./types";

// ── Water properties ─────────────────────────────────────────────────────────

/** Specific heat of water kJ/(kg·°C) */
export const CP_WATER = 4.186;

/**
 * Coolant flow rate in L/min.
 *   Q (kW) = ṁ (kg/s) × Cp × ΔT  →  L/min = (Q / (Cp·ΔT)) × 60  (ρ ≈ 1 kg/L)
 */
export function waterFlowLPM(heatKW: number, deltaTc: number): number {
  if (deltaTc <= 0) return 0;
  return (heatKW / (CP_WATER * deltaTc)) * 60;
}

/** L/min → US gal/min */
export const lpmToGPM = (lpm: number) => lpm / 3.785;

// ── Air-side COP model ───────────────────────────────────────────────────────

function supplyAirCOPFactor(supplyAirTemp: number, refSupplyAirTemp: number): number {
  const delta = supplyAirTemp - refSupplyAirTemp;
  if (delta >= 0) return 1 + 0.015 * delta;
  return 1 + 0.025 * delta;
}

export function airEffectiveCOP(
  system: CoolingSystem,
  outdoorTemp: number,
  supplyAirTemp: number,
  economizing: boolean,
): number {
  if (economizing) return 20.0;

  const oatDelta = outdoorTemp - system.designOAT;
  const oatFactor = 1 - system.copDegradationPerC * oatDelta;
  const satFactor = supplyAirCOPFactor(supplyAirTemp, system.refSupplyAirTemp);

  const cop = system.ratedCOP * oatFactor * satFactor;
  return Math.max(1.5, Math.min(cop, system.ratedCOP * 1.6));
}

export function isAirEconomizing(
  system: CoolingSystem,
  dryBulbC: number,
  wetBulbC: number,
  supplyAirTemp: number,
): boolean {
  const refTemp = system.usesWetBulb ? wetBulbC : dryBulbC;
  return refTemp <= supplyAirTemp - 2;
}

export function airAuxiliaryFraction(
  system: CoolingSystem,
  supplyAirTemp: number,
  returnAirTemp: number,
): number {
  const actualDeltaT = Math.max(returnAirTemp - supplyAirTemp, 3);
  return system.auxiliaryFraction * (system.refDeltaT / actualDeltaT);
}

// ── Liquid-side COP model ────────────────────────────────────────────────────

/** Dry-cooler approach temperature (°C). */
export const DRY_COOLER_APPROACH_C = 5;
/** COP of a dry cooler (fans + pumps only — no compressor). */
export const DRY_COOLER_COP = 20.0;
/** Pump power as fraction of liquid heat load (CDU + piping). */
export const LIQUID_PUMP_FRACTION = 0.02;

/**
 * Liquid-side cooling COP. The water outlet temperature (inlet + rise) sets
 * whether a dry cooler alone can reject the heat, or whether a chiller must trim
 * the loop.
 *  - waterOutlet ≥ OAT + approach → dry cooler only (COP ≈ 20)
 *  - otherwise → chiller-assisted; COP degrades as the gap grows.
 */
export function liquidCOP(
  waterOutletC: number,
  oatDryBulbC: number,
): { cop: number; freeCooling: boolean } {
  const dryLimit = oatDryBulbC + DRY_COOLER_APPROACH_C;

  if (waterOutletC >= dryLimit) {
    return { cop: DRY_COOLER_COP, freeCooling: true };
  }

  const gap = dryLimit - waterOutletC;
  const chillerCOP = Math.max(4.0, 8.0 - 0.3 * gap);
  const chillerFraction = Math.min(1.0, gap / 15);
  const blendedCOP =
    1 / (chillerFraction / chillerCOP + (1 - chillerFraction) / DRY_COOLER_COP);

  return { cop: blendedCOP, freeCooling: false };
}
