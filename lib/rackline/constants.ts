// Rackline reference data: PDU catalog, cable types, default equipment library,
// pathway / cooling-unit / electrical-node kinds. All values are planning
// assumptions to be checked against vendor datasheets before issue.

import type {
  CableType, CoolerKind, ElecType, LibItem, PduKey, Redundancy, TrayKind,
} from "./types";

/** Product name shown to users (the codebase, routes and tables keep "rackline"). */
export const TOOL_NAME = "Drybulb AI Factory Infrastructure Management";

export const FT = 0.3048;
/** BTU/h per kW. */
export const BTU = 3412.14;
export const SQ3 = Math.sqrt(3);

/** Stock patch-cord lengths (m) that calculated runs round up to. */
export const STD_LEN = [1, 2, 3, 5, 7, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100];

export const PDU_TYPES: Record<PduKey, { name: string; amps: number }> = {
  "415-32": { name: "415Y/240V 3Ø 32A", amps: 32 },
  "415-60": { name: "415Y/240V 3Ø 60A", amps: 60 },
  "415-100": { name: "415Y/240V 3Ø 100A", amps: 100 },
  "415-125": { name: "415Y/240V 3Ø 125A", amps: 125 },
};

/** Cable types with outside diameter (mm) for tray-fill. */
export const CABLE_T: Record<CableType, { name: string; od: number }> = {
  fabric: { name: "800G fabric, OSFP / MPO fiber", od: 4.5 },
  storage: { name: "400G storage / N-S, fiber", od: 4.5 },
  mgmt: { name: "Management, Cat6A", od: 7.6 },
  bmc: { name: "BMC / OOB, Cat6A", od: 7.6 },
};

/**
 * Starter equipment catalog: public vendor products, so it is the same for every
 * user. A customer's layout, single line and chosen quantities live only in that
 * customer's saved project. Power is per-system design kW for planning; values
 * marked "est." are not published by the vendor and are derived as noted.
 * Verify against the current datasheet before issuing a design.
 */
export const DEF_LIB: LibItem[] = [
  // ── 8-GPU compute nodes, highest to lowest density ─────────────────────────
  { id: "b300-air", name: "NVIDIA DGX B300 (8× B300, air, 10U)", cat: "compute", u: 10, kw: 14.5, psu: 12, psuW: 3200, liq: 0, ports: { fabric: 8, storage: 2, mgmt: 1, bmc: 1 },
    note: "NVIDIA DGX B300 user guide: 10U, ~14.5 kW max, 12 × 3.2 kW PSUs (200–240 V, 16 A)." },
  { id: "b300-dlc", name: "HGX B300 8-GPU, DLC (4U class, est.)", cat: "compute", u: 4, kw: 13.0, psu: 6, psuW: 5500, liq: 0.8, ports: { fabric: 8, storage: 2, mgmt: 1, bmc: 1 },
    note: "OEM liquid-cooled HGX B300 class. kW, PSU count/rating and 80 % liquid share are planning estimates." },
  { id: "dgx-b200", name: "NVIDIA DGX B200 (8× B200, air, 10U)", cat: "compute", u: 10, kw: 14.3, psu: 6, psuW: 3300, liq: 0, ports: { fabric: 8, storage: 2, mgmt: 1, bmc: 1 },
    note: "NVIDIA DGX B200 user guide: 10U, 14.3 kW max, 6 × 3.3 kW PSUs in 5+1." },
  { id: "smc-b200-dlc", name: "Supermicro SYS-422GS-NBRT-LCC (8× B200, DLC, 4U)", cat: "compute", u: 4, kw: 12.0, psu: 4, psuW: 6600, liq: 0.87, ports: { fabric: 8, storage: 2, mgmt: 1, bmc: 1 },
    note: "Supermicro: 4U, 4 × 6.6 kW PSUs (2+2), up to 87 % heat to cold plates. kW est.: 8 × 1.0 kW GPU + CPUs, NICs, fans." },
  { id: "smc-mi355x-dlc", name: "Supermicro AS-4126GS-NMR-LCC (8× AMD MI355X, DLC, 4U)", cat: "compute", u: 4, kw: 13.5, psu: 4, psuW: 6600, liq: 0.85, ports: { fabric: 8, storage: 2, mgmt: 1, bmc: 1 },
    note: "Supermicro: 4U, 4 × 6.6 kW PSUs (2+2). AMD MI355X up to 1.4 kW board power. kW and 85 % liquid share est." },
  { id: "smc-mi350x-air", name: "Supermicro AS-8126GS-TNMR (8× AMD MI350X, air, 8U)", cat: "compute", u: 8, kw: 10.5, psu: 6, psuW: 5250, liq: 0, ports: { fabric: 8, storage: 2, mgmt: 1, bmc: 1 },
    note: "Supermicro: 8U air, 6 × 5.25 kW PSUs (3+3). AMD MI350X 1.0 kW board power. kW est.: 8 × 1.0 kW GPU + CPUs, fans." },
  { id: "xe9680-h200", name: "Dell PowerEdge XE9680 (8× H200, air, 6U)", cat: "compute", u: 6, kw: 11.5, psu: 6, psuW: 2800, liq: 0, ports: { fabric: 8, storage: 2, mgmt: 1, bmc: 1 },
    note: "Dell rack-integration guide: ~11.5 kW max (H100 config; H200 SXM is also 700 W TDP), 6 × 2.8 kW PSUs." },
  { id: "xe7745-pcie", name: "Dell PowerEdge XE7745 (8× 600 W PCIe GPUs, air, 4U)", cat: "compute", u: 4, kw: 7.5, psu: 4, psuW: 3200, liq: 0, ports: { fabric: 4, storage: 2, mgmt: 1, bmc: 1 },
    note: "Dell spec sheet: 4U air, up to 8 × 600 W double-wide PCIe GPUs (e.g. RTX PRO 6000), 3.2 kW Titanium PSUs. kW, PSU count and 4 fabric ports est." },
  // ── Network, storage, management, passive ──────────────────────────────────
  { id: "leaf-800", name: "800G fabric switch, 64-port", cat: "network", u: 2, kw: 2.2, psu: 2, psuW: 3000, liq: 0, ports: { mgmt: 1 } },
  { id: "ns-400", name: "400G storage / N-S switch, 64-port", cat: "network", u: 2, kw: 1.2, psu: 2, psuW: 2000, liq: 0, ports: { mgmt: 1 } },
  { id: "mgmt-sw", name: "Management switch, 48×10G", cat: "network", u: 1, kw: 0.35, psu: 2, psuW: 650, liq: 0, ports: {} },
  { id: "stor", name: "NVMe storage server, 2U", cat: "storage", u: 2, kw: 1.6, psu: 2, psuW: 2000, liq: 0, ports: { storage: 2, mgmt: 1, bmc: 1 } },
  { id: "head", name: "Head / management server, 1U", cat: "server", u: 1, kw: 0.8, psu: 2, psuW: 1200, liq: 0, ports: { storage: 1, mgmt: 1, bmc: 1 } },
  { id: "patch", name: "Fiber patch panel, 1U", cat: "passive", u: 1, kw: 0, psu: 0, psuW: 0, liq: 0, ports: {} },
  { id: "blank", name: "Blanking panel, 1U", cat: "passive", u: 1, kw: 0, psu: 0, psuW: 0, liq: 0, ports: {} },
];

export const TRAY_K: Record<TrayKind, { name: string; color: string }> = {
  fiber: { name: "Fiber duct", color: "var(--rl-tray-fiber)" },
  ladder: { name: "Ladder tray (data)", color: "var(--rl-tray-ladder)" },
  power: { name: "Power tray", color: "var(--rl-tray-power)" },
  busway: { name: "Overhead busway", color: "var(--rl-tray-busway)" },
};

export const COOL_K: Record<CoolerKind, { name: string; w: number; d: number; cap: number }> = {
  crah: { name: "CRAH", w: 2.6, d: 0.9, cap: 120 },
  inrow: { name: "In-row cooler", w: 0.6, d: 1.2, cap: 40 },
  cdu: { name: "CDU", w: 0.6, d: 1.2, cap: 250 },
  rdhxcdu: { name: "RDHx water CDU", w: 0.8, d: 1.0, cap: 300 },
};

export type ElecField = "v" | "vp" | "scc" | "amps" | "kva" | "z" | "eff" | "kw" | "auto";

export const ELEC_T: Record<ElecType, { name: string; f: ElecField[] }> = {
  utility: { name: "Utility", f: ["v", "scc"] },
  switch: { name: "MV switch", f: ["v", "amps"] },
  xfmr: { name: "Transformer", f: ["kva", "vp", "v", "z"] },
  gen: { name: "Generator", f: ["kva", "v"] },
  ats: { name: "ATS", f: ["amps", "v"] },
  swbd: { name: "Switchboard", f: ["amps", "v"] },
  ups: { name: "UPS", f: ["kva", "v", "eff"] },
  rpp: { name: "RPP / panel", f: ["amps", "v"] },
  busway: { name: "Busway", f: ["amps", "v"] },
  mech: { name: "Mechanical", f: ["amps", "v", "auto", "kw"] },
  load: { name: "Other load", f: ["kw", "v"] },
};

export const ELEC_F: Record<ElecField, string> = {
  v: "Voltage (V)",
  vp: "Primary (V)",
  scc: "Utility fault (MVA, 0 = infinite)",
  amps: "Rating (A)",
  kva: "Rating (kVA)",
  z: "Impedance (%Z)",
  eff: "Efficiency",
  kw: "Fixed load (kW)",
  auto: "Auto load from cooling",
};

/** Node types a rack PDU may be fed from. */
export const FEEDABLE: ElecType[] = ["rpp", "busway", "swbd", "ups", "ats"];

/** Breakered distribution carries the continuous derate on its rating. */
export const DERATED: ElecType[] = ["rpp", "swbd", "busway", "ats", "mech"];

export const REDUNDANCY: Redundancy[] = ["N", "N+1", "N+2", "2N"];

/** Spare units for a redundancy scheme over n required units. */
export const redN = (red: Redundancy, n: number) =>
  red === "N" ? 0 : red === "N+1" ? 1 : red === "N+2" ? 2 : n;

/** PDF sheet scales: [key, label, metres per drawing inch]. */
export const PDF_SCALES: [string, string, number][] = [
  ["", "Unknown, calibrate after loading", 0],
  ["1/16", "1/16″ = 1′-0″", 16 * FT],
  ["3/32", "3/32″ = 1′-0″", (32 / 3) * FT],
  ["1/8", "1/8″ = 1′-0″", 8 * FT],
  ["3/16", "3/16″ = 1′-0″", (16 / 3) * FT],
  ["1/4", "1/4″ = 1′-0″", 4 * FT],
  ["1/2", "1/2″ = 1′-0″", 2 * FT],
  ["1:10", "1″ = 10′", 10 * FT],
  ["1:20", "1″ = 20′", 20 * FT],
  ["1:30", "1″ = 30′", 30 * FT],
  ["1:40", "1″ = 40′", 40 * FT],
  ["1:50e", "1″ = 50′", 50 * FT],
  ["1:100e", "1″ = 100′", 100 * FT],
  ["m50", "1:50", 0.0254 * 50],
  ["m100", "1:100", 0.0254 * 100],
  ["m200", "1:200", 0.0254 * 200],
  ["m500", "1:500", 0.0254 * 500],
];

/** DXF $INSUNITS code → metres per drawing unit (unitless falls back to mm). */
export const DXF_UNITS: Record<number, number> = { 1: 0.0254, 2: FT, 4: 0.001, 5: 0.01, 6: 1 };
