// ─────────────────────────────────────────────────────────────────────────────
// Data Center Cost Model — per-location engine + portfolio roll-up
//
// computeCost(): one location → capex build-up + AI capex, weather-driven hourly
// energy (lib/energy), utilization-linked revenue, and simple payback / ROI.
// computePortfolio(): sums locations into a Total (combined cash flow over the
// longest horizon; blended payback / ROI / LCOE).
// ─────────────────────────────────────────────────────────────────────────────

import type { HourlyWeather } from "@/lib/pue/types";
import { buildEnergyModel } from "@/lib/energy/model";
import type { EnergyModel, PricingParams } from "@/lib/energy/types";
import {
  AI_LINE_ITEMS,
  FACILITY_LINE_ITEMS,
  POWER_LINE_ITEM,
  powerLineLabel,
  type ComponentCost,
  type CostInputs,
  type LocationConfig,
} from "./types";
import { AI_CATEGORIES, FACILITY_CATEGORIES, getCategory } from "./catalog";

// ── Itemized BOM → $/W ───────────────────────────────────────────────────────

/** One component cost converted to $/W of critical IT. */
export function componentCostPerW(cc: ComponentCost | undefined, capacityW: number): number {
  if (!cc) return 0;
  switch (cc.unit) {
    case "perW":
      return cc.value;
    case "perMW":
      return cc.value / 1e6;
    case "total":
      return capacityW > 0 ? cc.value / capacityW : 0;
    default:
      return 0;
  }
}

/** The lump-sum $/W slider value for a category (from facility/ai). */
function lumpPerW(loc: LocationConfig, catKey: string): number {
  if (loc.facility && catKey in loc.facility) {
    return loc.facility[catKey as keyof LocationConfig["facility"]] as number;
  }
  if (catKey === "gpus") return loc.ai.gpus;
  if (catKey === "otherAI") return loc.ai.otherAI;
  return 0;
}

/** Effective $/W for a category: the BOM sum when itemized, else the slider. */
export function categoryPerW(loc: LocationConfig, catKey: string, capacityW: number): number {
  const cat = getCategory(catKey);
  const mode = loc.categoryMode?.[catKey] ?? "lump";
  if (cat && mode === "itemized") {
    let perW = 0;
    for (const comp of cat.components) {
      const cc = loc.componentCosts?.[comp.key];
      perW += cc ? componentCostPerW(cc, capacityW) : comp.defaultPerW;
    }
    return perW;
  }
  return lumpPerW(loc, catKey);
}

export interface CapexSegment {
  key: string;
  label: string;
  amount: number;
  color: string;
}

export interface CashFlowPoint {
  year: number;
  net: number;
  cumulative: number;
}

export interface CostResult {
  capacityW: number;
  capacityMW: number;

  facilityCapex: number;
  aiCapex: number;
  totalCapex: number;
  capexPerW: number;
  facilityCapexPerW: number;
  capexBreakdown: CapexSegment[];

  energy: EnergyModel;
  avgUtil: number;
  peakUtil: number;
  avgPue: number;
  weatherCoupled: boolean;
  annualITMWh: number;
  annualFacilityMWh: number;
  annualEnergyCost: number;
  annualOtherOpex: number;
  annualOpex: number;
  annualRevenue: number;
  annualProfit: number;

  analysisYears: number;
  cashFlow: CashFlowPoint[];
  paybackYears: number | null;
  roiPct: number;
  lcoePerMWh: number;
  /** PV pieces for blending an aggregate LCOE in the portfolio total. */
  lcoeNumeratorPV: number; // capex + Σ PV(opex)
  lcoeEnergyPV: number; // Σ PV(IT MWh)
}

function pricingFrom(loc: LocationConfig): PricingParams {
  return {
    source: loc.powerSource,
    priceMode: loc.priceMode,
    gridPricePerKWh: loc.gridPricePerKWh,
    touPeakPerKWh: loc.touPeakPerKWh,
    touOffPeakPerKWh: loc.touOffPeakPerKWh,
    touPeakStartHour: loc.touPeakStartHour,
    touPeakEndHour: loc.touPeakEndHour,
    heatRateBtuPerKWh: loc.heatRateBtuPerKWh,
    gasPricePerMMBtu: loc.gasPricePerMMBtu,
  };
}

export function computeCost(
  loc: LocationConfig,
  hourlyWeather: HourlyWeather | null,
): CostResult {
  const capacityW = loc.capacityMW * 1e6;

  // Each category resolves to an effective $/W: the itemized BOM sum when the
  // category is in "Itemized" mode, otherwise its lump-sum slider value.
  const facilityPerW = FACILITY_CATEGORIES.reduce((a, c) => a + categoryPerW(loc, c.key, capacityW), 0);
  const aiPerW = AI_CATEGORIES.reduce((a, c) => a + categoryPerW(loc, c.key, capacityW), 0);

  const facilityCapex = facilityPerW * capacityW;
  const aiCapex = aiPerW * capacityW;
  const totalCapex = facilityCapex + aiCapex;

  const capexBreakdown: CapexSegment[] = [
    ...FACILITY_LINE_ITEMS.map((li) => ({
      key: li.key,
      label: li.label,
      amount: categoryPerW(loc, li.key, capacityW) * capacityW,
      color: li.color,
    })),
    {
      key: POWER_LINE_ITEM.key,
      label: powerLineLabel(loc.powerSource),
      amount: categoryPerW(loc, "power", capacityW) * capacityW,
      color: POWER_LINE_ITEM.color,
    },
    ...AI_LINE_ITEMS.map((li) => ({
      key: li.key,
      label: li.label,
      amount: categoryPerW(loc, li.key, capacityW) * capacityW,
      color: li.color,
    })),
  ].filter((s) => s.amount > 0);

  const energy = buildEnergyModel({
    itLoadMW: loc.capacityMW,
    hourlyWeather,
    cooling: loc.cooling,
    flatPue: loc.pue,
    services: loc.services,
    pricing: pricingFrom(loc),
  });

  let peakITMW = 0;
  for (const v of energy.itMW) if (v > peakITMW) peakITMW = v;
  const peakUtil = loc.capacityMW > 0 ? peakITMW / loc.capacityMW : 0;

  const annualOtherOpex = loc.otherOpexPerMWYr * 1e6 * loc.capacityMW;
  const annualOpex = energy.annualEnergyCost + annualOtherOpex;
  const annualProfit = energy.annualRevenue - annualOpex;

  const cashFlow: CashFlowPoint[] = [];
  let cumulative = -totalCapex;
  cashFlow.push({ year: 0, net: -totalCapex, cumulative });
  let paybackYears: number | null = null;
  let lifetimeProfit = 0;
  for (let y = 1; y <= loc.analysisYears; y++) {
    const refresh =
      loc.gpuRefreshYears > 0 && y % loc.gpuRefreshYears === 0
        ? categoryPerW(loc, "gpus", capacityW) * capacityW
        : 0;
    const net = annualProfit - refresh;
    lifetimeProfit += annualProfit;
    const prev = cumulative;
    cumulative += net;
    cashFlow.push({ year: y, net, cumulative });
    if (paybackYears === null && prev < 0 && cumulative >= 0) {
      paybackYears = y - 1 + (0 - prev) / (cumulative - prev);
    }
  }
  const roiPct = totalCapex > 0 ? ((lifetimeProfit - totalCapex) / totalCapex) * 100 : 0;

  const r = loc.discountRatePct / 100;
  let pvOpex = 0;
  let pvEnergy = 0;
  for (let t = 1; t <= loc.analysisYears; t++) {
    const d = Math.pow(1 + r, t);
    pvOpex += annualOpex / d;
    pvEnergy += energy.annualITMWh / d;
  }
  const lcoeNumeratorPV = totalCapex + pvOpex;
  const lcoePerMWh = pvEnergy > 0 ? lcoeNumeratorPV / pvEnergy : 0;

  return {
    capacityW,
    capacityMW: loc.capacityMW,
    facilityCapex,
    aiCapex,
    totalCapex,
    capexPerW: totalCapex / capacityW,
    facilityCapexPerW: facilityPerW,
    capexBreakdown,
    energy,
    avgUtil: energy.avgUtil,
    peakUtil,
    avgPue: energy.avgPue,
    weatherCoupled: energy.weatherCoupled,
    annualITMWh: energy.annualITMWh,
    annualFacilityMWh: energy.annualFacilityMWh,
    annualEnergyCost: energy.annualEnergyCost,
    annualOtherOpex,
    annualOpex,
    annualRevenue: energy.annualRevenue,
    annualProfit,
    analysisYears: loc.analysisYears,
    cashFlow,
    paybackYears,
    roiPct,
    lcoePerMWh,
    lcoeNumeratorPV,
    lcoeEnergyPV: pvEnergy,
  };
}

// ── Portfolio roll-up ────────────────────────────────────────────────────────

export interface LocationResult {
  id: string;
  name: string;
  stationId: string | null;
  result: CostResult;
}

export interface TotalResult {
  locationCount: number;
  totalCapacityMW: number;
  totalCapex: number;
  capexPerW: number;
  avgPue: number;
  annualEnergyCost: number;
  annualOpex: number;
  annualRevenue: number;
  annualProfit: number;
  annualITMWh: number;
  annualFacilityMWh: number;
  cashFlow: CashFlowPoint[];
  paybackYears: number | null;
  roiPct: number;
  lcoePerMWh: number;
}

export interface PortfolioResult {
  perLocation: LocationResult[];
  total: TotalResult;
}

export function computePortfolio(
  inputs: CostInputs,
  weatherByStation: Map<string, HourlyWeather | null>,
): PortfolioResult {
  const perLocation: LocationResult[] = inputs.locations.map((loc) => {
    const weather = loc.stationId ? weatherByStation.get(loc.stationId) ?? null : null;
    return { id: loc.id, name: loc.name, stationId: loc.stationId, result: computeCost(loc, weather) };
  });

  const results = perLocation.map((p) => p.result);
  const sum = (sel: (r: CostResult) => number) => results.reduce((a, r) => a + sel(r), 0);

  const totalCapacityMW = sum((r) => r.capacityMW);
  const totalCapacityW = totalCapacityMW * 1e6;
  const totalCapex = sum((r) => r.totalCapex);
  const annualRevenue = sum((r) => r.annualRevenue);
  const annualOpex = sum((r) => r.annualOpex);
  const annualEnergyCost = sum((r) => r.annualEnergyCost);
  const annualProfit = sum((r) => r.annualProfit);
  const annualITMWh = sum((r) => r.annualITMWh);
  const annualFacilityMWh = sum((r) => r.annualFacilityMWh);

  // capacity-weighted average PUE
  const avgPue =
    totalCapacityMW > 0
      ? results.reduce((a, r) => a + r.avgPue * r.capacityMW, 0) / totalCapacityMW
      : 0;

  // blended LCOE: Σ PV numerator / Σ PV energy
  const lcoeNum = sum((r) => r.lcoeNumeratorPV);
  const lcoeDen = sum((r) => r.lcoeEnergyPV);
  const lcoePerMWh = lcoeDen > 0 ? lcoeNum / lcoeDen : 0;

  // combined cash flow over the longest horizon
  const maxYears = results.reduce((m, r) => Math.max(m, r.analysisYears), 0);
  const cashFlow: CashFlowPoint[] = [];
  let cumulative = 0;
  let lifetimeProfit = 0;
  for (let y = 0; y <= maxYears; y++) {
    let net = 0;
    for (const r of results) {
      const pt = r.cashFlow[y];
      if (pt) net += pt.net;
    }
    if (y > 0) lifetimeProfit += results.reduce((a, r) => a + (y <= r.analysisYears ? r.annualProfit : 0), 0);
    const prev = cumulative;
    cumulative += net;
    cashFlow.push({ year: y, net, cumulative });
    if (y > 0 && prev < 0 && cumulative >= 0 && !cashFlow.some((p) => p.year < y && p.net === 0)) {
      // payback handled below from the combined series
    }
  }

  // payback from combined cumulative
  let paybackYears: number | null = null;
  for (let i = 1; i < cashFlow.length; i++) {
    const prev = cashFlow[i - 1].cumulative;
    const cur = cashFlow[i].cumulative;
    if (prev < 0 && cur >= 0) {
      paybackYears = cashFlow[i - 1].year + (0 - prev) / (cur - prev);
      break;
    }
  }

  const roiPct = totalCapex > 0 ? ((lifetimeProfit - totalCapex) / totalCapex) * 100 : 0;

  return {
    perLocation,
    total: {
      locationCount: results.length,
      totalCapacityMW,
      totalCapex,
      capexPerW: totalCapacityW > 0 ? totalCapex / totalCapacityW : 0,
      avgPue,
      annualEnergyCost,
      annualOpex,
      annualRevenue,
      annualProfit,
      annualITMWh,
      annualFacilityMWh,
      cashFlow,
      paybackYears,
      roiPct,
      lcoePerMWh,
    },
  };
}

// ── Formatting helpers ───────────────────────────────────────────────────────

export function fmtUSD(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function fmtPerW(n: number): string {
  return `$${n.toFixed(2)}/W`;
}

export function fmtPerMWh(n: number): string {
  return `$${n.toFixed(0)}/MWh`;
}
