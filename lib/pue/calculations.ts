import type {
  AnnualPUEResult,
  CoolingSystem,
  MonthKey,
  MonthlyPUEResult,
  MonthlyWeather,
  PUEInputs,
} from "./types";
import { MONTH_KEYS as MONTHS } from "./types";
import { COOLING_SYSTEMS, UPS_CONFIGS } from "./equipment-defaults";

// ─────────────────────────────────────────────────────────────────────────────
// Water properties
// ─────────────────────────────────────────────────────────────────────────────

/** Specific heat of water kJ/(kg·°C) */
const CP_WATER = 4.186;

/**
 * Calculate coolant flow rate in L/min.
 *   Q (kW) = ṁ (kg/s) × Cp × ΔT
 *   ṁ (kg/s) = Q / (Cp × ΔT)
 *   L/min   = ṁ × 60  (density ≈ 1 kg/L for water)
 */
function waterFlowLPM(heatKW: number, deltaTc: number): number {
  if (deltaTc <= 0) return 0;
  return (heatKW / (CP_WATER * deltaTc)) * 60;
}

/** L/min → US gal/min */
export const lpmToGPM = (lpm: number) => lpm / 3.785;

// ─────────────────────────────────────────────────────────────────────────────
// Air-side COP model
// ─────────────────────────────────────────────────────────────────────────────

function supplyAirCOPFactor(
  supplyAirTemp: number,
  refSupplyAirTemp: number
): number {
  const delta = supplyAirTemp - refSupplyAirTemp;
  if (delta >= 0) return 1 + 0.015 * delta;
  return 1 + 0.025 * delta;
}

function airEffectiveCOP(
  system: CoolingSystem,
  outdoorTemp: number,
  supplyAirTemp: number,
  economizing: boolean
): number {
  if (economizing) return 20.0;

  const oatDelta = outdoorTemp - system.designOAT;
  const oatFactor = 1 - system.copDegradationPerC * oatDelta;
  const satFactor = supplyAirCOPFactor(supplyAirTemp, system.refSupplyAirTemp);

  const cop = system.ratedCOP * oatFactor * satFactor;
  return Math.max(1.5, Math.min(cop, system.ratedCOP * 1.6));
}

function isAirEconomizing(
  system: CoolingSystem,
  dryBulbC: number,
  wetBulbC: number,
  supplyAirTemp: number
): boolean {
  const refTemp = system.usesWetBulb ? wetBulbC : dryBulbC;
  return refTemp <= supplyAirTemp - 2;
}

function airAuxiliaryFraction(
  system: CoolingSystem,
  supplyAirTemp: number,
  returnAirTemp: number
): number {
  const actualDeltaT = Math.max(returnAirTemp - supplyAirTemp, 3);
  return system.auxiliaryFraction * (system.refDeltaT / actualDeltaT);
}

// ─────────────────────────────────────────────────────────────────────────────
// Liquid-side COP model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dry-cooler approach temperature.  A dry cooler can reject heat when the
 * water outlet temperature exceeds outdoor dry-bulb by at least this margin.
 */
const DRY_COOLER_APPROACH_C = 5;

/** COP of a dry cooler (fans + pumps only — no compressor). */
const DRY_COOLER_COP = 20.0;

/** Pump power as fraction of liquid heat load (CDU + piping). */
const LIQUID_PUMP_FRACTION = 0.02;

/**
 * Calculate liquid-side cooling COP.
 *
 * The water outlet temperature (inlet + rise) determines whether a dry cooler
 * alone can reject the heat, or whether a chiller must trim the loop.
 *
 *  - If T_outlet > OAT + approach → dry cooler only (COP ≈ 20)
 *  - If OAT + approach > T_outlet → chiller-assisted; COP degrades as the
 *    gap grows because the chiller must make up a larger fraction of the
 *    heat rejection.
 */
function liquidCOP(
  waterOutletC: number,
  oatDryBulbC: number
): { cop: number; freeCooling: boolean } {
  const dryLimit = oatDryBulbC + DRY_COOLER_APPROACH_C;

  if (waterOutletC >= dryLimit) {
    // Full free cooling — dry cooler handles all heat
    return { cop: DRY_COOLER_COP, freeCooling: true };
  }

  // Chiller-assisted: the fraction of heat the chiller must handle grows
  // as outdoor temp rises above the free-cooling threshold.
  // chillerFraction = how much of the gap the chiller must bridge.
  const gap = dryLimit - waterOutletC; // positive °C the chiller must overcome
  // Chiller COP for liquid loops is typically 5–8 (water-to-water, small lift)
  const chillerCOP = Math.max(4.0, 8.0 - 0.3 * gap);
  // Blend: part of heat goes through dry cooler at high COP, rest through chiller.
  // As gap grows → more chiller, lower blended COP.
  const chillerFraction = Math.min(1.0, gap / 15); // fully chiller-dependent at 15 °C gap
  const blendedCOP =
    1 / (chillerFraction / chillerCOP + (1 - chillerFraction) / DRY_COOLER_COP);

  return { cop: blendedCOP, freeCooling: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly PUE
// ─────────────────────────────────────────────────────────────────────────────

function calculateMonthPUE(
  inputs: PUEInputs,
  month: MonthKey,
  weather: MonthlyWeather
): MonthlyPUEResult {
  const system = COOLING_SYSTEMS[inputs.coolingType];
  const ups = UPS_CONFIGS[inputs.upsType];

  const oatDryBulb = weather.T2M[month];
  const oatWetBulb = weather.T2MWET[month];
  const humidity = weather.RH2M[month];
  const itLoadKW = inputs.itLoadKW;

  // ── Heat load split ──
  const airHeatKW = itLoadKW * (inputs.airCoolingPct / 100);
  const liquidHeatKW = itLoadKW * (inputs.liquidCoolingPct / 100);

  // ── Air-side cooling ──
  const returnAirTemp = inputs.supplyAirTemp + inputs.temperatureRise;
  const airEconomizing = isAirEconomizing(
    system,
    oatDryBulb,
    oatWetBulb,
    inputs.supplyAirTemp
  );
  const refTemp = system.usesWetBulb ? oatWetBulb : oatDryBulb;
  const airCoolingCOP = airEffectiveCOP(
    system,
    refTemp,
    inputs.supplyAirTemp,
    airEconomizing
  );
  const airAuxFrac = airAuxiliaryFraction(
    system,
    inputs.supplyAirTemp,
    returnAirTemp
  );
  const airCoolingKW =
    airHeatKW > 0
      ? airHeatKW / airCoolingCOP + airHeatKW * airAuxFrac
      : 0;

  // ── Liquid-side cooling ──
  let liquidCoolingKW = 0;
  let liquidCoolingCOP = 0;
  let liquidFreeCooling = false;
  let flowLPM = 0;

  if (liquidHeatKW > 0) {
    const waterOutletC = inputs.waterInletTemp + inputs.waterTempRise;
    const liqResult = liquidCOP(waterOutletC, oatDryBulb);
    liquidCoolingCOP = liqResult.cop;
    liquidFreeCooling = liqResult.freeCooling;

    // Cooling power = compressor/dry-cooler work + pump power
    liquidCoolingKW =
      liquidHeatKW / liquidCoolingCOP + liquidHeatKW * LIQUID_PUMP_FRACTION;

    // Water flow rate
    flowLPM = waterFlowLPM(liquidHeatKW, inputs.waterTempRise);
  }

  // ── Total cooling ──
  const coolingKW = airCoolingKW + liquidCoolingKW;

  // ── Other losses ──
  const upsLossKW = itLoadKW * (1 / ups.efficiency - 1);
  const pduLossKW = itLoadKW * (inputs.pduLossPct / 100);
  const lightingKW = itLoadKW * (inputs.lightingPct / 100);

  const totalFacilityKW =
    itLoadKW + coolingKW + upsLossKW + pduLossKW + lightingKW;
  const pue = totalFacilityKW / itLoadKW;

  return {
    month,
    oatDryBulb,
    oatWetBulb,
    humidity,
    airCoolingCOP,
    liquidCoolingCOP,
    airCoolingKW,
    liquidCoolingKW,
    coolingKW,
    upsLossKW,
    pduLossKW,
    lightingKW,
    totalFacilityKW,
    pue,
    airEconomizing,
    liquidFreeCooling,
    waterFlowLPM: flowLPM,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Annual PUE
// ─────────────────────────────────────────────────────────────────────────────

export function calculateAnnualPUE(
  inputs: PUEInputs,
  weather: MonthlyWeather
): AnnualPUEResult {
  const monthly = MONTHS.map((month) =>
    calculateMonthPUE(inputs, month, weather)
  );

  const annualPUE =
    monthly.reduce((sum, m) => sum + m.pue, 0) / monthly.length;

  const annualCoolingKW =
    monthly.reduce((sum, m) => sum + m.coolingKW, 0) / monthly.length;

  const annualTotalKW =
    monthly.reduce((sum, m) => sum + m.totalFacilityKW, 0) / monthly.length;

  const avgFlowLPM =
    monthly.reduce((sum, m) => sum + m.waterFlowLPM, 0) / monthly.length;

  const bestMonth = monthly.reduce((best, m) =>
    m.pue < best.pue ? m : best
  );
  const worstMonth = monthly.reduce((worst, m) =>
    m.pue > worst.pue ? m : worst
  );

  return {
    monthly,
    annualPUE,
    bestMonth,
    worstMonth,
    annualCoolingKW,
    annualTotalKW,
    itLoadKW: inputs.itLoadKW,
    waterFlowLPM: avgFlowLPM,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rating & benchmarks
// ─────────────────────────────────────────────────────────────────────────────

export function pueRating(pue: number): {
  label: string;
  color: string;
  description: string;
} {
  if (pue <= 1.2)
    return {
      label: "Excellent",
      color: "text-green-600",
      description: "Hyperscale / best-in-class efficiency",
    };
  if (pue <= 1.4)
    return {
      label: "Good",
      color: "text-emerald-600",
      description: "Modern, well-designed facility",
    };
  if (pue <= 1.6)
    return {
      label: "Average",
      color: "text-yellow-600",
      description: "Typical enterprise data center",
    };
  if (pue <= 2.0)
    return {
      label: "Below Average",
      color: "text-orange-600",
      description: "Older facility or inefficient cooling",
    };
  return {
    label: "Poor",
    color: "text-red-600",
    description: "Significant efficiency improvements possible",
  };
}

export const PUE_BENCHMARKS = [
  { label: "Hyperscale (Google, Meta)", pue: 1.10 },
  { label: "Best-in-class colo", pue: 1.20 },
  { label: "Modern enterprise", pue: 1.40 },
  { label: "Industry average (2024)", pue: 1.58 },
  { label: "Legacy enterprise", pue: 1.80 },
  { label: "AI-dense (liquid cooled)", pue: 1.15 },
];
