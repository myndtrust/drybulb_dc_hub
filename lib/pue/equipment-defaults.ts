import type {
  CoolingSystem,
  CoolingType,
  ITConfig,
  ITPreset,
  UPSConfig,
  UPSType,
} from "./types";

// ── IT Load Presets ──

export const IT_PRESETS: Record<ITPreset, ITConfig> = {
  small: {
    preset: "small",
    label: "Small / Edge (50 kW)",
    totalKW: 50,
    kwPerRack: 5,
    rackCount: 10,
  },
  medium: {
    preset: "medium",
    label: "Medium Enterprise (500 kW)",
    totalKW: 500,
    kwPerRack: 10,
    rackCount: 50,
  },
  large: {
    preset: "large",
    label: "Large Colocation (2 MW)",
    totalKW: 2000,
    kwPerRack: 15,
    rackCount: 133,
  },
  ai_hpc: {
    preset: "ai_hpc",
    label: "AI / HPC Dense (5 MW)",
    totalKW: 5000,
    kwPerRack: 40,
    rackCount: 125,
  },
};

// ── Cooling Systems ──

export const COOLING_SYSTEMS: Record<CoolingType, CoolingSystem> = {
  dx_air_cooled: {
    type: "dx_air_cooled",
    label: "DX Air-Cooled (CRAC/CRAH)",
    description:
      "Direct expansion, air-cooled condensers. Common in small-medium facilities.",
    ratedCOP: 2.8,
    designOAT: 35,
    copDegradationPerC: 0.03,
    usesWetBulb: false,
    refSupplyAirTemp: 20,
    refDeltaT: 15,
    auxiliaryFraction: 0.04,
  },
  chw_air_cooled: {
    type: "chw_air_cooled",
    label: "Chilled Water — Air-Cooled Chiller",
    description:
      "Central chilled water plant with air-cooled chillers. Good for medium-large facilities.",
    ratedCOP: 3.2,
    designOAT: 35,
    copDegradationPerC: 0.025,
    usesWetBulb: false,
    refSupplyAirTemp: 20,
    refDeltaT: 15,
    auxiliaryFraction: 0.05,
  },
  chw_water_cooled: {
    type: "chw_water_cooled",
    label: "Chilled Water — Water-Cooled Chiller + Cooling Tower",
    description:
      "Central plant with water-cooled chillers and cooling towers. Best mechanical efficiency for large facilities.",
    ratedCOP: 5.5,
    designOAT: 25,
    copDegradationPerC: 0.02,
    usesWetBulb: true,
    refSupplyAirTemp: 20,
    refDeltaT: 15,
    auxiliaryFraction: 0.06,
  },
  evaporative: {
    type: "evaporative",
    label: "Evaporative / Indirect Evaporative Cooling",
    description:
      "Uses water evaporation to cool air. Very efficient in dry climates. Performance depends on wet-bulb temperature.",
    ratedCOP: 12.0,
    designOAT: 20,
    copDegradationPerC: 0.04,
    usesWetBulb: true,
    refSupplyAirTemp: 20,
    refDeltaT: 15,
    auxiliaryFraction: 0.03,
  },
  airside_economizer: {
    type: "airside_economizer",
    label: "Airside Economizer + DX Backup",
    description:
      "Uses filtered outside air for free cooling when conditions allow. DX backup for warm periods.",
    ratedCOP: 3.0,
    designOAT: 35,
    copDegradationPerC: 0.03,
    usesWetBulb: false,
    refSupplyAirTemp: 20,
    refDeltaT: 15,
    auxiliaryFraction: 0.03,
  },
};

// ── UPS Configurations ──

export const UPS_CONFIGS: Record<UPSType, UPSConfig> = {
  legacy_double_conversion: {
    type: "legacy_double_conversion",
    label: "Legacy Double Conversion (90%)",
    efficiency: 0.90,
  },
  modern_double_conversion: {
    type: "modern_double_conversion",
    label: "Modern Double Conversion (95%)",
    efficiency: 0.95,
  },
  eco_mode: {
    type: "eco_mode",
    label: "Eco-Mode / Line Interactive (98.5%)",
    efficiency: 0.985,
  },
  lithium_ion: {
    type: "lithium_ion",
    label: "Li-Ion Double Conversion (96.5%)",
    efficiency: 0.965,
  },
};

// ── Default Input Values ──

export const DEFAULT_INPUTS = {
  stationId: "VA-IAD",
  itLoadKW: 500,
  kwPerRack: 10,
  rackCount: 50,
  coolingType: "chw_water_cooled" as CoolingType,
  upsType: "modern_double_conversion" as UPSType,
  lightingPct: 1.5,
  pduLossPct: 2.0,
  supplyAirTemp: 20,
  temperatureRise: 15,
  airCoolingPct: 100,
  liquidCoolingPct: 0,
  waterInletTemp: 35,
  waterTempRise: 10,
};
