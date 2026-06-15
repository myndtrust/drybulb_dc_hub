import type {
  AnnualPUEResult,
  MonthKey,
  MonthlyPUEResult,
  MonthlyWeather,
  PUEInputs,
} from "./types";
import { MONTH_KEYS as MONTHS } from "./types";
import { COOLING_SYSTEMS, UPS_CONFIGS } from "./equipment-defaults";
import {
  airAuxiliaryFraction,
  airEffectiveCOP,
  isAirEconomizing,
  LIQUID_PUMP_FRACTION,
  liquidCOP,
  waterFlowLPM,
} from "./cooling";

// Re-export so existing importers (`@/lib/pue/calculations`) keep working.
export { lpmToGPM } from "./cooling";

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
