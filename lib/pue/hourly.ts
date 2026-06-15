// ─────────────────────────────────────────────────────────────────────────────
// Hourly PUE engine — runs the cooling COP model over the 8,760-hour weather
// series, computing wet-bulb per hour from dry-bulb + RH + pressure.
//
// Because the model is linear in IT load, the resulting PUE[h] depends only on
// weather and the cooling configuration (not load magnitude). Callers multiply
// PUE[h] by their own hourly IT power to get facility power.
// ─────────────────────────────────────────────────────────────────────────────

import type { HourlyWeather, PUEInputs } from "./types";
import { COOLING_SYSTEMS, UPS_CONFIGS } from "./equipment-defaults";
import { wetBulb } from "./psychrometrics";
import {
  airAuxiliaryFraction,
  airEffectiveCOP,
  isAirEconomizing,
  LIQUID_PUMP_FRACTION,
  liquidCOP,
} from "./cooling";

export interface HourlyPUEResult {
  /** PUE for each of the 8,760 hours (load-independent). */
  pue: number[];
  /** Annual mean PUE. */
  annualPUE: number;
  /** Hours the air side was free-cooling (economizing). */
  airEconomizingHours: number;
  /** Hours the liquid loop ran on the dry cooler alone (no chiller). */
  liquidFreeCoolingHours: number;
}

export function calculateHourlyPUE(
  inputs: PUEInputs,
  weather: HourlyWeather,
): HourlyPUEResult {
  const system = COOLING_SYSTEMS[inputs.coolingType];
  const ups = UPS_CONFIGS[inputs.upsType];

  // Per-IT-watt fractions (everything scales linearly with IT load).
  const airHeatFrac = inputs.airCoolingPct / 100;
  const liquidHeatFrac = inputs.liquidCoolingPct / 100;
  const returnAirTemp = inputs.supplyAirTemp + inputs.temperatureRise;
  const airAuxFrac = airAuxiliaryFraction(
    system,
    inputs.supplyAirTemp,
    returnAirTemp,
  );
  const waterOutletC = inputs.waterInletTemp + inputs.waterTempRise;

  const upsLossFrac = 1 / ups.efficiency - 1;
  const pduLossFrac = inputs.pduLossPct / 100;
  const lightingFrac = inputs.lightingPct / 100;
  // Fixed (weather-independent) overhead as a fraction of IT load.
  const fixedOverheadFrac = upsLossFrac + pduLossFrac + lightingFrac;

  const n = weather.tdb.length;
  const pue = new Array<number>(n);
  let sumPue = 0;
  let airEco = 0;
  let liqFree = 0;

  for (let h = 0; h < n; h++) {
    const tdb = weather.tdb[h];
    const rh = weather.rh[h];
    const pPa = (weather.p[h] || 1013.25) * 100; // mbar → Pa
    const twb = wetBulb(tdb, rh, pPa);

    // Air-side cooling power as a fraction of IT load.
    let airFrac = 0;
    if (airHeatFrac > 0) {
      const economizing = isAirEconomizing(system, tdb, twb, inputs.supplyAirTemp);
      if (economizing) airEco++;
      const refTemp = system.usesWetBulb ? twb : tdb;
      const cop = airEffectiveCOP(system, refTemp, inputs.supplyAirTemp, economizing);
      airFrac = airHeatFrac / cop + airHeatFrac * airAuxFrac;
    }

    // Liquid-side cooling power as a fraction of IT load.
    let liqFrac = 0;
    if (liquidHeatFrac > 0) {
      const { cop, freeCooling } = liquidCOP(waterOutletC, tdb);
      if (freeCooling) liqFree++;
      liqFrac = liquidHeatFrac / cop + liquidHeatFrac * LIQUID_PUMP_FRACTION;
    }

    // PUE = 1 (IT) + cooling + fixed overhead, all per unit IT load.
    const p = 1 + airFrac + liqFrac + fixedOverheadFrac;
    pue[h] = p;
    sumPue += p;
  }

  return {
    pue,
    annualPUE: n ? sumPue / n : 0,
    airEconomizingHours: airEco,
    liquidFreeCoolingHours: liqFree,
  };
}
