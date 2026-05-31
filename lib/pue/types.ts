// ── PUE Calculator Types ──

export interface Station {
  id: string;
  name: string;
  state: string;
  stateCode: string;
  lat: number;
  lon: number;
  /** Major data center market flag */
  dcMarket?: boolean;
}

export interface MonthlyWeather {
  /** Dry-bulb temperature at 2m (°C) */
  T2M: Record<string, number>;
  /** Wet-bulb temperature at 2m (°C) */
  T2MWET: Record<string, number>;
  /** Dew point at 2m (°C) */
  T2MDEW: Record<string, number>;
  /** Relative humidity at 2m (%) */
  RH2M: Record<string, number>;
}

export type MonthKey =
  | "JAN" | "FEB" | "MAR" | "APR" | "MAY" | "JUN"
  | "JUL" | "AUG" | "SEP" | "OCT" | "NOV" | "DEC";

export const MONTH_KEYS: MonthKey[] = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

export const MONTH_LABELS: Record<MonthKey, string> = {
  JAN: "Jan", FEB: "Feb", MAR: "Mar", APR: "Apr",
  MAY: "May", JUN: "Jun", JUL: "Jul", AUG: "Aug",
  SEP: "Sep", OCT: "Oct", NOV: "Nov", DEC: "Dec",
};

// ── Cooling system types ──

export type CoolingType =
  | "dx_air_cooled"
  | "chw_air_cooled"
  | "chw_water_cooled"
  | "evaporative"
  | "airside_economizer";

export interface CoolingSystem {
  type: CoolingType;
  label: string;
  description: string;
  /** Rated COP at design conditions */
  ratedCOP: number;
  /** Design outdoor dry-bulb temp for rated COP (°C) */
  designOAT: number;
  /** COP degradation per °C above design (fraction) */
  copDegradationPerC: number;
  /** Whether this system uses wet-bulb temp for performance */
  usesWetBulb: boolean;
  /** Reference supply air temp at which ratedCOP applies (°C) */
  refSupplyAirTemp: number;
  /** Reference return-supply delta-T for rated auxiliary power (°C) */
  refDeltaT: number;
  /** Fan/pump power as fraction of IT load at reference delta-T */
  auxiliaryFraction: number;
}

// ── UPS types ──

export type UPSType =
  | "legacy_double_conversion"
  | "modern_double_conversion"
  | "eco_mode"
  | "lithium_ion";

export interface UPSConfig {
  type: UPSType;
  label: string;
  efficiency: number;
}

// ── IT Load presets ──

export type ITPreset = "small" | "medium" | "large" | "ai_hpc";

export interface ITConfig {
  preset: ITPreset;
  label: string;
  totalKW: number;
  kwPerRack: number;
  rackCount: number;
}

// ── User-configurable state ──

export interface PUEInputs {
  stationId: string;
  itLoadKW: number;
  kwPerRack: number;
  rackCount: number;
  coolingType: CoolingType;
  upsType: UPSType;
  /** Lighting & misc as % of IT load */
  lightingPct: number;
  /** PDU loss as % of IT load */
  pduLossPct: number;
  /** Supply air temperature setpoint (°C) */
  supplyAirTemp: number;
  /** Air-side temperature rise across IT equipment (°C) */
  temperatureRise: number;
  /** % of IT heat removed by air cooling */
  airCoolingPct: number;
  /** % of IT heat removed by direct-to-chip liquid cooling */
  liquidCoolingPct: number;
  /** Coolant inlet temperature to cold plates (°C) */
  waterInletTemp: number;
  /** Coolant temperature rise through cold plates (°C) */
  waterTempRise: number;
}

// ── Calculation results ──

export interface MonthlyPUEResult {
  month: MonthKey;
  oatDryBulb: number;
  oatWetBulb: number;
  humidity: number;
  /** Air-side cooling COP */
  airCoolingCOP: number;
  /** Liquid-side cooling COP */
  liquidCoolingCOP: number;
  /** Air-side cooling power (kW) */
  airCoolingKW: number;
  /** Liquid-side cooling power — pumps, dry cooler/chiller (kW) */
  liquidCoolingKW: number;
  /** Total cooling power (kW) */
  coolingKW: number;
  upsLossKW: number;
  pduLossKW: number;
  lightingKW: number;
  totalFacilityKW: number;
  pue: number;
  /** Air-side economizer active */
  airEconomizing: boolean;
  /** Liquid-side free cooling (dry cooler only, no chiller) */
  liquidFreeCooling: boolean;
  /** Coolant flow rate (L/min) */
  waterFlowLPM: number;
}

export interface AnnualPUEResult {
  monthly: MonthlyPUEResult[];
  annualPUE: number;
  bestMonth: MonthlyPUEResult;
  worstMonth: MonthlyPUEResult;
  annualCoolingKW: number;
  annualTotalKW: number;
  itLoadKW: number;
  /** Annual average water flow rate (L/min) */
  waterFlowLPM: number;
}
