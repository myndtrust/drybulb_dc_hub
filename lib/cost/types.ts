// ─────────────────────────────────────────────────────────────────────────────
// Data Center Cost Model — types, defaults, and sourced assumptions
//
// The model is a PORTFOLIO of locations. Each LocationConfig carries the full
// attribute set (services, cooling, capex build-up, AI capex, power/pricing,
// capacity + per-location finance). A chosen city's TMY3 weather drives hourly
// PUE through the real PUE cooling engine (lib/energy + lib/pue).
//
// Units note: $/W of critical IT == $M/MW. Methodology patterned on a public
// Crusoe presentation (illustrative) and McCalip's open-source (MIT) model.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  CoolingConfig,
  PowerSource,
  PriceMode,
  ProfileParams,
  ServiceChannel,
  SynthModel,
} from "@/lib/energy/types";
import { generateProfile } from "@/lib/energy/profile";
import { defaultCategoryMode, defaultComponentCosts } from "./catalog";

export type { PowerSource, PriceMode } from "@/lib/energy/types";

// ── Itemized BOM (per-category) ──────────────────────────────────────────────
/** How a per-component cost is expressed. $/W of IT, $/MW of IT, or absolute $. */
export type CostUnit = "perW" | "perMW" | "total";
export type CategoryMode = "lump" | "itemized";
export interface ComponentCost {
  value: number;
  unit: CostUnit;
  /** Chosen vendor product, as "Vendor · Model" — persisted with the saved project. */
  product?: string;
}

// ── Facility capex build-up (curated, theme-legible data palette) ────────────
export interface CapexLineItem {
  key: string;
  label: string;
  color: string; // Tailwind bg-* class
}

export const FACILITY_LINE_ITEMS: CapexLineItem[] = [
  { key: "labor", label: "Labor", color: "bg-slate-600" },
  { key: "materials", label: "Materials", color: "bg-amber-600" },
  { key: "tenantFitout", label: "Tenant fit-out", color: "bg-orange-500" },
  { key: "electrical", label: "Electrical equipment", color: "bg-sky-500" },
  { key: "mechanical", label: "Mechanical equipment", color: "bg-teal-600" },
  { key: "softCosts", label: "Soft costs", color: "bg-zinc-500" },
];

export const POWER_LINE_ITEM: CapexLineItem = {
  key: "power",
  label: "Power",
  color: "bg-stone-500",
};

export const AI_LINE_ITEMS: CapexLineItem[] = [
  { key: "gpus", label: "GPUs / accelerators", color: "bg-emerald-600" },
  { key: "otherAI", label: "Other AI infrastructure", color: "bg-violet-500" },
];

/** Colors for locations in the Total roll-up (capex-by-location bar/legend). */
export const LOCATION_COLORS = [
  "bg-emerald-600",
  "bg-sky-500",
  "bg-amber-600",
  "bg-violet-500",
  "bg-teal-600",
  "bg-orange-500",
  "bg-slate-600",
  "bg-rose-500",
];

// ── A single location ────────────────────────────────────────────────────────
export interface LocationConfig {
  id: string;
  name: string;

  capacityMW: number;
  analysisYears: number;
  discountRatePct: number;
  /** Flat PUE fallback used when no city/weather is selected. */
  pue: number;

  facility: {
    labor: number;
    materials: number;
    tenantFitout: number;
    electrical: number;
    mechanical: number;
    softCosts: number;
    power: number;
  };

  ai: { gpus: number; otherAI: number };
  gpuRefreshYears: number;

  /** Per-category cost mode: "lump" (the $/W slider) or "itemized" (sum of BOM). */
  categoryMode: Record<string, CategoryMode>;
  /** Per-component costs for itemized categories (keyed by catalog component key). */
  componentCosts: Record<string, ComponentCost>;

  powerSource: PowerSource;
  priceMode: PriceMode;
  gridPricePerKWh: number;
  touPeakPerKWh: number;
  touOffPeakPerKWh: number;
  touPeakStartHour: number;
  touPeakEndHour: number;
  heatRateBtuPerKWh: number;
  gasPricePerMMBtu: number;

  otherOpexPerMWYr: number;

  /** TMY3 station usaf; null = no city (flat PUE). */
  stationId: string | null;
  cooling: CoolingConfig;
  services: ServiceChannel[];
}

export interface CostInputs {
  locations: LocationConfig[];
}

// ── Default service channels ─────────────────────────────────────────────────
interface ServiceTemplate {
  id: string;
  label: string;
  peakDemandMW: number;
  profile: ProfileParams;
  unitPricePerMWh: number;
}

const SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    id: "training",
    label: "AI training",
    peakDemandMW: 0.7,
    profile: { shape: "flat", baseLoadPct: 95, peakLoadPct: 100, weekendFactor: 1 },
    unitPricePerMWh: 1800,
  },
  {
    id: "inference",
    label: "Inference / managed",
    peakDemandMW: 0.3,
    profile: { shape: "diurnal", baseLoadPct: 45, peakLoadPct: 100, weekendFactor: 0.7, peakHour: 15, troughHour: 4 },
    unitPricePerMWh: 4800,
  },
];

/** A sensible default statistical model (used until the user opens the model path). */
export function defaultSynthModel(): SynthModel {
  return {
    method: "additive",
    baseLevelPct: 75,
    diurnalAmpPct: 18,
    peakHour: 15,
    seasonalAmpPct: 6,
    peakMonth: 7,
    trendPct: 0,
    dist: "normal",
    spreadPct: 4,
    seed: 42,
    troughHour: 4,
  };
}

/** Materialize a service: fill its 8,760-hour demand from the preset profile. */
function makeService(t: ServiceTemplate, idSuffix = ""): ServiceChannel {
  return {
    id: `${t.id}${idSuffix}`,
    label: t.label,
    peakDemandMW: t.peakDemandMW,
    demand: generateProfile(t.profile),
    demandSource: "preset",
    profile: { ...t.profile },
    model: defaultSynthModel(),
    unitPricePerMWh: t.unitPricePerMWh,
  };
}

let locationSeq = 0;

/** A fresh location with default attributes. */
export function makeLocation(name: string, stationId: string | null = null): LocationConfig {
  locationSeq += 1;
  return {
    id: `loc-${Date.now()}-${locationSeq}`,
    name,
    capacityMW: 1,
    analysisYears: 6,
    discountRatePct: 8,
    pue: 1.2,
    facility: {
      labor: 4.7,
      materials: 3.9,
      tenantFitout: 2.6,
      electrical: 1.8,
      mechanical: 1.7,
      softCosts: 1.5,
      power: 3.0,
    },
    ai: { gpus: 30, otherAI: 10 },
    gpuRefreshYears: 0,
    categoryMode: defaultCategoryMode(),
    componentCosts: defaultComponentCosts(),
    powerSource: "gas",
    priceMode: "flat",
    gridPricePerKWh: 0.07,
    touPeakPerKWh: 0.12,
    touOffPeakPerKWh: 0.05,
    touPeakStartHour: 14,
    touPeakEndHour: 20,
    heatRateBtuPerKWh: 6200,
    gasPricePerMMBtu: 4.3,
    otherOpexPerMWYr: 0.55,
    stationId,
    cooling: { coolingType: "chw_water_cooled", supplyAirTemp: 24, liquidCoolingPct: 30 },
    services: SERVICE_TEMPLATES.map((t) => makeService(t, `-${locationSeq}`)),
  };
}

/** A fresh service with a default 8,760-hour demand (for "+ Add service"). */
export function makeBlankService(): ServiceChannel {
  return makeService(
    {
      id: "svc",
      label: "New service",
      peakDemandMW: 0.1,
      profile: { shape: "flat", baseLoadPct: 80, peakLoadPct: 100, weekendFactor: 1 },
      unitPricePerMWh: 2000,
    },
    `-${Date.now()}`,
  );
}

/** Default portfolio: one "NA" location (no city → flat PUE). */
export const DEFAULT_INPUTS: CostInputs = {
  locations: [makeLocation("NA", null)],
};

export const DEFAULT_POWER_CAPEX: Record<PowerSource, number> = {
  gas: 3.0,
  grid: 0.0,
};

export function powerLineLabel(source: PowerSource): string {
  return source === "gas" ? "Gas plant (behind-the-meter)" : "Grid interconnection";
}

// ── Sourced assumptions (Technical Notes) ────────────────────────────────────
export interface SourceNote {
  label: string;
  value: string;
  source: string;
}

export const SOURCE_NOTES: SourceNote[] = [
  {
    label: "Facility cost build-up",
    value: "≈ $19.2 / W with on-site gas plant",
    source:
      "Illustrative per-MW build-up patterned on a public Crusoe presentation. Tune to your project.",
  },
  {
    label: "AI infrastructure",
    value: "GPUs ≈ $30 / W · other ≈ $10 / W",
    source: "Accelerators plus networking/storage; ≈ $59M/MW upfront. Vendor-dependent.",
  },
  {
    label: "Energy (weather-coupled)",
    value: "hourly PUE from TMY3 + the PUE cooling engine",
    source:
      "When a city is selected, facility energy is integrated hour-by-hour from that location's typical-year weather; otherwise the flat PUE applies.",
  },
  {
    label: "Revenue",
    value: "per-service $/MW/yr, utilization-linked",
    source:
      "Each service channel earns its rate on its allocated capacity scaled by utilization (illustrative AI-services pricing).",
  },
  {
    label: "On-site generation (CCGT)",
    value: "$1–3 / W · heat rate ≈ 6,200 Btu/kWh",
    source: "U.S. EIA combined-cycle capital cost and performance.",
  },
  {
    label: "Energy price",
    value: "gas ≈ $4.30/MMBtu · grid $0.06–0.09/kWh",
    source: "U.S. EIA Henry Hub gas and average industrial retail electricity.",
  },
  {
    label: "PUE",
    value: "1.1–1.3 modern (flat fallback 1.20)",
    source: "Uptime Institute survey range for efficient large facilities.",
  },
];
