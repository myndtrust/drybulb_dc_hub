// ─────────────────────────────────────────────────────────────────────────────
// Total energy model — composes the hourly vectors.
//
// Differentiated service channels each contribute hourly IT power; the chosen
// city's weather drives hourly PUE through the real PUE cooling engine; the two
// multiply into the facility energy-requirement vector, which prices out to an
// annual energy cost. Utilization-linked service revenue is computed alongside.
// ─────────────────────────────────────────────────────────────────────────────

import type { HourlyWeather, PUEInputs } from "@/lib/pue/types";
import { calculateHourlyPUE } from "@/lib/pue/hourly";
import { DEFAULT_INPUTS as PUE_DEFAULTS } from "@/lib/pue/equipment-defaults";
import { hourlyPrice, resampleTo8760 } from "./profile";
import {
  HOURS,
  type CoolingConfig,
  type EnergyModel,
  type PricingParams,
  type ServiceChannel,
} from "./types";

export interface BuildEnergyArgs {
  itLoadMW: number;
  /** City weather (8,760 h) or null to use the flat PUE fallback. */
  hourlyWeather: HourlyWeather | null;
  cooling: CoolingConfig;
  /** Flat PUE used when no city/weather is available. */
  flatPue: number;
  services: ServiceChannel[];
  pricing: PricingParams;
}

/** A service's 8,760-hour demand schedule (0–1 of peak), resilient to bad lengths. */
function serviceUtil(s: ServiceChannel): number[] {
  return s.demand?.length === HOURS ? s.demand : resampleTo8760(s.demand ?? []);
}

export function buildEnergyModel(a: BuildEnergyArgs): EnergyModel {
  // — Hourly PUE: weather-driven if a city is selected, else flat —
  let pueHourly: number[] | null = null;
  let weatherCoupled = false;
  if (a.hourlyWeather && a.hourlyWeather.tdb.length > 0) {
    const pueInputs: PUEInputs = {
      ...(PUE_DEFAULTS as PUEInputs),
      coolingType: a.cooling.coolingType,
      supplyAirTemp: a.cooling.supplyAirTemp,
      liquidCoolingPct: a.cooling.liquidCoolingPct,
      airCoolingPct: Math.max(0, 100 - a.cooling.liquidCoolingPct),
    };
    pueHourly = calculateHourlyPUE(pueInputs, a.hourlyWeather).pue;
    weatherCoupled = true;
  }

  // — Per-service hourly demand (peak demand MW × shape fraction) —
  const channels = a.services.map((s) => ({
    s,
    util: serviceUtil(s),
    capacityMW: s.peakDemandMW,
  }));

  const itMW = new Array<number>(HOURS);
  const pue = new Array<number>(HOURS);
  const facilityMW = new Array<number>(HOURS);
  const price = new Array<number>(HOURS);

  let annualITMWh = 0;
  let annualFacilityMWh = 0;
  let annualEnergyCost = 0;
  let sumPue = 0;

  for (let h = 0; h < HOURS; h++) {
    let it = 0;
    for (const c of channels) it += c.capacityMW * (c.util[h] ?? 0);
    const p = pueHourly ? pueHourly[h] : a.flatPue;
    const fac = it * p;
    const pr = hourlyPrice(a.pricing, h);

    itMW[h] = it;
    pue[h] = p;
    facilityMW[h] = fac;
    price[h] = pr;

    annualITMWh += it; // 1 h step → MW·h = MWh
    annualFacilityMWh += fac;
    annualEnergyCost += fac * 1000 * pr; // MWh → kWh × $/kWh
    sumPue += p;
  }

  // — Per-service revenue: unit price ($/MWh) × MWh delivered —
  const services = channels.map((c) => {
    let sumU = 0;
    for (let h = 0; h < HOURS; h++) sumU += c.util[h] ?? 0;
    const avgUtil = sumU / HOURS;
    const annualMWh = c.capacityMW * sumU; // peakMW × Σ fraction·1h
    return {
      id: c.s.id,
      label: c.s.label,
      capacityMW: c.capacityMW,
      avgUtil,
      annualRevenue: c.s.unitPricePerMWh * annualMWh,
    };
  });
  const annualRevenue = services.reduce((s, x) => s + x.annualRevenue, 0);
  const avgUtil =
    a.itLoadMW > 0 ? annualITMWh / (a.itLoadMW * HOURS) : 0;

  return {
    pue,
    itMW,
    facilityMW,
    price,
    annualITMWh,
    annualFacilityMWh,
    annualEnergyCost,
    avgPue: sumPue / HOURS,
    avgUtil,
    services,
    annualRevenue,
    weatherCoupled,
  };
}
