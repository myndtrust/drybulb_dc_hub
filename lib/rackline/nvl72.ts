// NVIDIA GB300 NVL72 pods: rack-scale library items, network sizing from the
// NVIDIA NVL72 AI Factory enterprise reference architecture (GB300 NVL72 basis),
// the power and cooling choice points of the guided setup, and a generator that
// turns those choices into a complete scenario (compute racks with their in-rack
// OOB switches, network racks, control plane, CDUs, CRAHs, trays, and a room
// single line with every rack fed).
//
// Sources (see docs/rackline/gb300-nvl72.md for the full notes):
//  [ra]   NVIDIA Enterprise RA "NVL72 AI Factory" (GB300 NVL72 + Spectrum-X):
//         Overview (SU = 1 NVL72 rack, tested to 8 SUs), System Hardware &
//         Components (18 compute trays, 9 NVLink switch trays, 2 in-rack SN2201,
//         "up to 142 kW", 8 power shelves of 33 kW with 6 x 5.5 kW PSUs, liquid
//         cooled, 12 management nodes), Network Logical Architecture Tables 6-7.
//  [len]  Lenovo Press LP2357 (GB300 NVL72): 135 kW TDP, up to 155 kW peak; 6 or 8
//         × 33 kW shelves, one 60 A IEC 60309 whip each, 346–480 V WYE; ~90 %
//         of heat to liquid; 25–45 °C allowable supply, rack flow per Table 27;
//         48U MGX rack 600 × 1,068 mm.
//  [hpe]  HPE QuickSpecs GB300 NVL72: 132 kW nominal TDP, ~155 kW peak.
//  [cat]  data/equipment-catalog.json - the Cost Model's MEP catalog.
// Loaded rack weight and switch / management-node power are planning
// estimates. Verify against the OEM site-preparation guide and the project
// basis of design.

import { analyze, cableAnalysis } from "./analysis";
import { DEFAULT_NETS } from "./network";
import { COOL_K } from "./constants";
import { addDevice, autoLayoutElectrical, choosePDU, libIndex, newRack, newScenario, uid } from "./model";
import type { ElecBasis, Electrical, ElecNode, LibItem, NetTier, Rack, Redundancy, Scenario } from "./types";

// ── Library ──────────────────────────────────────────────────────────────────

const GB300_NOTE =
  "NVIDIA GB300 NVL72 (RA): 72 Blackwell Ultra GPUs, 36 Grace CPUs, 18 compute trays (4× ConnectX-8 800G + " +
  "1× BlueField-3 B3240 each), 9 NVLink 5 switch trays, liquid cooled MGX rack. Power: 8 power shelves of 33 kW " +
  "(6 × 5.5 kW PSUs each), each on one 60 A whip, 4 per feed (Lenovo LP2357). Ports per rack: 144 × 400G compute, " +
  "36 × 400G converged, 54 × 1G BMC (3 per tray). ~90 % of heat to liquid, ~10 % to air (Lenovo LP2357).";

const VR200_NOTE =
  "NVIDIA Vera Rubin NVL72: 72 Rubin GPUs, 36 Vera CPUs, 18 compute trays (8 ConnectX-9 at 800G and 1 BlueField-4 each), " +
  "9 NVLink 6 switch trays, third-generation MGX rack, fully liquid cooled, 45 °C inlet (NVIDIA; SemiAnalysis). Power: 4 × 110 kW " +
  "power shelves N+1, each on two 100 A whips at 415–480 V 3φ (SemiAnalysis), modelled as 8 three-phase inputs, 4 per feed. " +
  "Ports per rack: 144 × 800G compute, 18 × 800G BlueField-4, 54 × 1G BMC (BMC count est.).";

export const NVL72_LIB: LibItem[] = [
  { id: "gb300-nvl72", name: "NVIDIA GB300 NVL72, RA maximum 142 kW", cat: "compute", u: 40, kw: 142, psu: 8, psuW: 33000, liq: 0.9, phase3: true,
    ports: { fabric: 144, storage: 36, bmc: 54 }, note: GB300_NOTE + " 142 kW: the RA's 'full rack requiring up to 142 kW'." },
  { id: "gb300-nvl72-nom", name: "NVIDIA GB300 NVL72, TDP 135 kW", cat: "compute", u: 40, kw: 135, psu: 8, psuW: 33000, liq: 0.9, phase3: true,
    ports: { fabric: 144, storage: 36, bmc: 54 }, note: GB300_NOTE + " 135 kW: Lenovo LP2357 TDP (peak up to 155 kW; HPE quotes 132 kW nominal)." },
  { id: "sn5600", name: "NVIDIA Spectrum-X SN5600 (64×800G, 2U)", cat: "network", u: 2, kw: 2.3, psu: 2, psuW: 3000, liq: 0, ports: { mgmt: 1 }, swPorts: 128,
    note: "NVIDIA NVL72 RA leaf / spine switch (SN5600, 128×400G). kW is an estimate." },
  { id: "sn2201", name: "NVIDIA SN2201 OOB (48×1G + 4×100G, 1U)", cat: "network", u: 1, kw: 0.15, psu: 2, psuW: 400, liq: 0, ports: {}, swPorts: 48,
    note: "NVIDIA NVL72 RA out-of-band switch. kW is an estimate." },
  { id: "sn2201-dc", name: "NVIDIA SN2201 OOB, in-rack (DC from rack busbar)", cat: "network", u: 1, kw: 0, psu: 0, psuW: 0, liq: 0, ports: {}, swPorts: 48,
    note: "NVIDIA NVL72 RA: 2 SN2201 per GB300 NVL72 rack, DC powered in the rack; their power is inside the rack's rating." },
  // ── Vera Rubin NVL72 (modular reference design basis; see lib/rackline/vr200.ts) ──
  { id: "vr200-nvl72", name: "NVIDIA Vera Rubin NVL72 (VR200)", cat: "compute", u: 42, kw: 227, kwMaxQ: 187, kwMaxP: 227, psu: 8, psuW: 55000, liq: 1, phase3: true,
    ports: { fabric: 144, storage: 18, bmc: 54 },
    note: VR200_NOTE + " Power profiles: Max-Q 187 kW, Max-P 227 kW per rack (project basis; SemiAnalysis reports 180–220 kW, the reference design plans 200 kW nominal). The design load (kW) follows the chosen profile." },
  { id: "sn6810", name: "NVIDIA Spectrum-X SN6810 (128×800G, CPO, liquid)", cat: "network", u: 2, kw: 3, psu: 2, psuW: 3000, liq: 1, ports: {}, swPorts: 128,
    note: "NVIDIA Spectrum-6 SN6810: 102.4 Tb/s, 128 × 800G with co-packaged optics, liquid cooled (NVIDIA). U and kW are estimates." },
  { id: "vr-support-block", name: "Support equipment block, 2.5 kW (storage / management / services)", cat: "storage", u: 2, kw: 2.5, psu: 2, psuW: 3000, liq: 0, ports: { bmc: 1 },
    note: "Fills a support rack (35 kW nominal: network, storage, management) to its design load. Contents are a placeholder; replace with the real equipment." },
  { id: "ra-mgmt-node", name: "RA management / control-plane node (2-socket, 4× CX-7 200G)", cat: "server", u: 2, kw: 1.2, psu: 2, psuW: 2000, liq: 0, ports: { storage: 4, bmc: 1 },
    note: "NVIDIA NVL72 RA: 12 management nodes for the control plane, 4 × 200G each to the converged fabric. U and kW are estimates." },
];

/** 48U MGX rack, 600 × 1,068 mm (Lenovo LP2357); loaded weight (~3,000 lb) is an estimate. */
export const NVL72_RACK = { w: 0.6, d: 1.068, u: 48, gpus: 72, kgEst: 1360 } as const;

/** [len] Table 27: rack coolant flow (L/min) by supply temperature (°C), for a 135 kW rack. */
const GB300_FLOW: [number, number][] = [[25, 59], [30, 71], [35, 89], [40, 119], [45, 177]];

/** Rack coolant flow per kW (L/min·kW) at a supply temperature, interpolated from Lenovo's table. */
export function gb300LpmPerKW(supplyC: number): number {
  const t = Math.min(45, Math.max(25, supplyC));
  const i = Math.max(0, GB300_FLOW.findIndex(([c]) => c >= t) - 1);
  const [c0, f0] = GB300_FLOW[i], [c1, f1] = GB300_FLOW[Math.min(i + 1, GB300_FLOW.length - 1)];
  return (c1 === c0 ? f0 : f0 + ((f1 - f0) * (t - c0)) / (c1 - c0)) / 135;
}

/** Air load one network rack may carry (kW): beyond this it is split into more racks. */
export const NET_RACK_KW = 20;

/** Add any GB300 NVL72 library items the project doesn't have yet (in place). */
export function ensureNvl72Lib(lib: LibItem[]): void {
  for (const l of NVL72_LIB) {
    const have = lib.find((x) => x.id === l.id);
    if (!have) lib.push({ ...l, ports: { ...l.ports } });
    else if (have.swPorts == null && l.swPorts != null) have.swPorts = l.swPorts; // added after first release
  }
}

// ── Network: NVIDIA NVL72 AI Factory RA, Tables 6–7 ──────────────────────────

const RA_COMPUTE: Record<2 | 4 | 8, { leaf: number; spine: number }> = { 2: { leaf: 8, spine: 4 }, 4: { leaf: 16, spine: 8 }, 8: { leaf: 32, spine: 12 } };
const RA_CONVERGED: Record<2 | 4 | 8, { leaf: number; spine: number }> = { 2: { leaf: 2, spine: 0 }, 4: { leaf: 4, spine: 2 }, 8: { leaf: 7, spine: 4 } };

export interface RaNetwork {
  /** RA design size the counts come from (2, 4 or 8 racks); null beyond the RA. */
  design: 2 | 4 | 8 | null;
  pods: number;
  computeLeaf: number;
  computeSpine: number;
  superSpine: number;
  convLeaf: number;
  convSpine: number;
  oob: number;
  notes: string[];
}

/**
 * Switch counts for `racks` GB300 NVL72 racks (1 SU = 1 rack, ConnectX-8 at
 * 800 Gb/s per GPU as 2 × 400G planes). Up to 8 racks the counts are the RA's
 * 2/4/8-rack designs (a design covers 1–2, 3–4 and 7–8 SUs; 5–6 use the 8-rack
 * design). The RA is tested to 8 SUs; beyond that the counts are an estimate
 * (8-rack pods joined by a super-spine). OOB switches sit in the compute racks.
 */
export function raNetwork(racks: number): RaNetwork {
  const notes: string[] = [];
  const n = Math.max(1, Math.round(racks));
  const design: RaNetwork["design"] = n <= 2 ? 2 : n <= 4 ? 4 : n <= 8 ? 8 : null;
  if (n >= 5 && n <= 6) notes.push("The RA defines 2-, 4- and 8-rack designs; 5–6 racks use the 8-rack design.");
  const pods = design ? 1 : Math.ceil(n / 8);
  const c = design ? RA_COMPUTE[design] : { leaf: 4 * n, spine: 12 * pods };
  const v = design ? RA_CONVERGED[design] : { leaf: 7 * pods, spine: 4 * pods };
  const superSpine = design ? 0 : 6 * pods;
  if (!design) notes.push(`The RA is tested to 8 SUs: ${pods} pods of up to 8 racks joined by a super-spine tier. Counts beyond 8 racks are an estimate.`);
  return { design, pods, computeLeaf: c.leaf, computeSpine: c.spine, superSpine, convLeaf: v.leaf, convSpine: v.spine, oob: 2 * n, notes };
}

// ── Catalog ratings ──────────────────────────────────────────────────────────

/** Largest rating in a catalog spec string, in `unit` ("kW" also reads MW; "kVA" also MVA). */
export function specRating(spec: string, unit: "kW" | "kVA" | "A"): number | null {
  const big = unit === "kW" ? "MW" : unit === "kVA" ? "MVA" : null;
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(MVA|MW|kVA|kW|A)\b/g;
  let best: number | null = null;
  for (const m of spec.matchAll(re)) {
    const v = parseFloat(m[1].replace(/,/g, ""));
    const u = m[2];
    const val = u === unit ? v : big && u === big ? v * 1000 : null;
    // "105 kW-2.5 MW": a range's first number may carry the second's unit only.
    if (val != null && (best == null || val > best)) best = val;
  }
  if (best == null && unit !== "A") {
    const r = spec.match(/(\d[\d,]*(?:\.\d+)?)\s*[-–]\s*(\d[\d,]*(?:\.\d+)?)\s*(MVA|MW|kVA|kW)/);
    if (r) best = parseFloat(r[2].replace(/,/g, "")) * (r[3].startsWith("M") ? 1000 : 1);
  }
  return best;
}

// ── Guided-setup options ─────────────────────────────────────────────────────

export type PowerArch = "power-pods" | "dsx-grid-direct" | "ups-2n" | "dr-4to3";
/** The rack platform and the reference design it follows. */
export type Platform = "gb300" | "vr200";
export const PLATFORMS: Record<Platform, { label: string; ra: string; summary: string }> = {
  gb300: {
    label: "GB300 NVL72",
    ra: "NVIDIA NVL72 AI Factory enterprise RA",
    summary: "72 Blackwell Ultra GPUs per rack at 135–142 kW, ~90 % liquid. Pods of 2–8 racks sized from NVIDIA's network tables.",
  },
  vr200: {
    label: "Vera Rubin NVL72 (VR200)",
    ra: "VR200 modular reference design",
    summary: "72 Rubin GPUs per rack at ~200 kW, fully liquid, 45 °C water. 3.36 MW AI Modules of 14 GPU + 16 support racks, Power Pods, hybrid cooling.",
  },
};
export type RackFeed = "busway" | "rpp";
export type HeatRejection = "drycooler" | "chiller";

/** Which platforms offer each architecture (the DSX grid-direct design is drawn for Vera Rubin). */
export const POWER_ARCH: Record<PowerArch, { label: string; summary: string; voltage: 415 | 480; platforms: Platform[] }> = {
  "power-pods": {
    label: "Power Pods, 4-to-make-3 (480 V)",
    summary: "One Power Pod per AI Module: 5 MVA 34.5 kV→480Y/277 V transformer, 5 MW generator and ATS, 6,000 A main switchboard, 2 × 2,000 kVA UPS, 6,000 A UPS distribution board and four 1,600 A feeders to busway. Every rack takes two feeders from two different Pods. UPS and generator are optional.",
    voltage: 480,
    platforms: ["vr200"],
  },
  "dsx-grid-direct": {
    label: "NVIDIA DSX Vera Rubin: grid-direct compute (480 V)",
    summary: "Siemens UL reference design for DSX Vera Rubin: compute is fed grid-direct (no UPS or generator on the GPU path) from 4.2 MVA 34.5 kV→480 V transformers, 5000 A MSB-GPU switchboards and 1000 A RPPs. A 1.5 MVA core UPS backs only network and support racks. Lowest losses and cost; the workload must tolerate grid events (pair with BESS / power smoothing).",
    voltage: 480,
    platforms: ["vr200"],
  },
  "ups-2n": {
    label: "2N UPS, A/B distribution",
    summary: "Classic enterprise design: two independent A and B paths, each with transformer, standby generator, UPS and switchboard, sized to carry the whole load alone. Highest availability; roughly double the UPS and distribution capacity.",
    voltage: 415,
    platforms: ["gb300", "vr200"],
  },
  "dr-4to3": {
    label: "Distributed redundant, 4-to-make-3 (NVIDIA SuperPOD style)",
    summary: "Four transformer / UPS blocks each sized for a third of the load; every rack takes its two feeds from two different blocks, so any one block can fail. About 33 % spare instead of 100 %.",
    voltage: 415,
    platforms: ["gb300"],
  },
};

export interface Nvl72PodOptions {
  name: string;
  platform: Platform;
  /** GPU (NVL72) racks. */
  racks: number;
  /** "max": the RA's 142 kW full-rack figure; "nominal": 135 kW TDP (Lenovo LP2357). */
  profile: "max" | "nominal";
  /** The RA's 12-node control plane in its own rack. */
  mgmtNodes: boolean;
  // Vera Rubin (reference design) only
  /** VR200 power profile used as the rack's design load, and the two ratings (kW, editable). */
  vrProfile: "maxq" | "maxp";
  maxQKW: number;
  maxPKW: number;
  /** AI Module: GPU racks and support racks per module, and support rack load (kW). */
  gpuPerModule: number;
  supportPerModule: number;
  supportKW: number;
  /** Power Pods: UPS and generator are optional; feeders per Pod; mechanical powertrain transformer (kVA). */
  ups: boolean;
  gen: boolean;
  feedersPerPod: number;
  mechXfmrKva: number;
  // Layout
  perRow: number;
  pattern: "pod" | "single";
  cold: number;
  hot: number;
  netPos: "end" | "middle";
  /** Hot aisle containment over each two-row pod (the network racks are air cooled). */
  contain: boolean;
  cduPos: "in-row" | "gallery";
  floor: "slab" | "raised";
  // Power
  power: PowerArch;
  voltage: 415 | 480;
  feed: RackFeed;
  /** Distribution ratings (A) and equipment ratings (kVA / kW). */
  busAmps: number;
  rppAmps: number;
  upsKva: number;
  xfmrKva: number;
  genKw: number;
  /** Chosen catalog products, shown in node names and the bill of materials. */
  picks: Partial<Record<"ups" | "busway" | "transformers" | "lv" | "generators" | "cdus" | "chillers" | "crah", string>>;
  // Cooling
  cduKW: number;
  cduRed: Redundancy;
  heatRej: HeatRejection;
  supplyC: number;
  deltaC: number;
  ambC: number;
  ox?: number;
  oy?: number;
  // Automatic rules (all editable in the setup, and on the result afterwards)
  /** Most air load one network rack may carry before a new rack is started (kW). */
  netRackKW: number;
  /** Mechanical load for sizing its panel and transformer, % of IT (0 = by heat rejection: 50 % chillers, 25 % dry coolers). */
  mechPct: number;
  /** Upsize fiber ducts until their fill passes. */
  sizeDucts: boolean;
  /** Compute / converged fabrics: each rack reaches every leaf rack (rail-optimised) or its nearest. */
  fabricAttach: "spread" | "nearest";
  /** Leaf-to-spine uplinks per endpoint cable (1 = non-blocking). */
  uplink: number;
}

export function defaultNvl72Options(platform: Platform = "gb300"): Nvl72PodOptions {
  const vr = {
    vrProfile: "maxp" as const, maxQKW: 187, maxPKW: 227, gpuPerModule: 14, supportPerModule: 16, supportKW: 35, ups: true, gen: true, feedersPerPod: 4, mechXfmrKva: 3250,
  };
  if (platform === "vr200") return {
    // Modular reference design: 4 AI Modules of 14 GPU + 16 support racks, Power Pods, hybrid cooling.
    name: "Vera Rubin NVL72 hall", platform, racks: 56, profile: "max", mgmtNodes: false, ...vr,
    perRow: 7, pattern: "pod", cold: 1.2, hot: 1.2, netPos: "end", contain: true, cduPos: "in-row", floor: "slab",
    power: "power-pods", voltage: 480, feed: "busway", busAmps: 1600, rppAmps: 1000, upsKva: 2000, xfmrKva: 5000, genKw: 5000,
    // Dry / fluid coolers primary (104/122 °F loop), chillers for CRAHs and assist; IT coolant < 45 °C at ~10 K ΔT.
    picks: {}, cduKW: 3000, cduRed: "N+1", heatRej: "drycooler", supplyC: 45, deltaC: 10, ambC: 35, ox: 3, oy: 4,
    netRackKW: NET_RACK_KW, mechPct: 0, sizeDucts: true, fabricAttach: "spread", uplink: 1,
  };
  return {
    name: "GB300 NVL72 pod", platform, racks: 8, profile: "max", mgmtNodes: true, ...vr,
    perRow: 8, pattern: "pod", cold: 1.2, hot: 1.2, netPos: "end", contain: true, cduPos: "in-row", floor: "slab",
    power: "ups-2n", voltage: 415, feed: "rpp", busAmps: 1250, rppAmps: 800, upsKva: 1200, xfmrKva: 3000, genKw: 2500,
    // Lenovo LP2357: 25–45 °C allowable supply. 35 °C keeps rack flow moderate (89 L/min per rack).
    picks: {}, cduKW: 1350, cduRed: "N+1", heatRej: "chiller", supplyC: 35, deltaC: 10, ambC: 35, ox: 3, oy: 4,
    netRackKW: NET_RACK_KW, mechPct: 0, sizeDucts: true, fabricAttach: "spread", uplink: 1,
  };
}

/** Dry coolers can serve the loop only while ambient + approaches stay under the supply temperature. */
export const CDU_APPROACH_C = 3;
export const DRY_APPROACH_C = 7;
export const maxDryAmbientC = (supplyC: number) => supplyC - CDU_APPROACH_C - DRY_APPROACH_C;


export const kva = (kw: number) => kw / 0.95;
export const rating = (vLL: number, amps: number, derate = 0.8) => (Math.sqrt(3) * vLL * amps * derate) / 1000;

// ── Single lines ─────────────────────────────────────────────────────────────

export interface Built { e: Electrical; feeds: (rack: Rack, i: number, row: number, net: boolean) => void; notes: string[] }

export function node(type: ElecNode["type"], name: string, o: Partial<ElecNode>): ElecNode {
  return { id: uid(), type, name, x: 0, y: 0, ...o };
}
export const pickName = (base: string, pick?: string) => (pick ? `${base} (${pick})` : base);

/**
 * Room single line for the chosen architecture, and a function that sets each
 * rack's A/B feeds. Compute racks are spread so no distribution node exceeds
 * its derated rating when the other side is lost.
 */
export function buildPower(o: Nvl72PodOptions, computeKW: number, rackKW: number, rows: number[], netKW: number): Built {
  const V = o.voltage;
  const e: Electrical = { nodes: [], links: [] };
  const add = (n: ElecNode) => { e.nodes.push(n); return n; };
  const link = (a: ElecNode, b: ElecNode) => e.links.push({ id: uid(), from: a.id, to: b.id });
  const notes: string[] = [];
  const rackKVA = kva(rackKW);

  // Distribution unit capacity and how many compute racks one unit may carry
  // (worst case: the other side lost, so one unit carries each rack in full).
  const unitAmps = o.feed === "busway" ? o.busAmps : o.rppAmps;
  const unitKVA = rating(V, unitAmps);
  const perUnit = Math.max(1, Math.floor(unitKVA / rackKVA));
  if (rackKVA > unitKVA) notes.push(`One rack (${Math.round(rackKVA)} kVA) exceeds a ${unitAmps} A ${o.feed === "busway" ? "busway" : "RPP"} (${Math.round(unitKVA)} kVA derated). Choose a larger rating.`);
  const unitLabel = o.feed === "busway" ? "Busway" : "RPP";
  const unitType = o.feed === "busway" ? "busway" : "rpp";

  /** Units for one side, filled row by row so a unit never spans two rows. */
  const sideUnits = (side: string, parentFor: (k: number, n: number) => ElecNode) => {
    const units: { n: ElecNode; row: number; left: number }[] = [];
    rows.forEach((cnt, row) => {
      for (let k = 0; k < Math.ceil(cnt / perUnit); k++) {
        const n = add(node(unitType, `${unitLabel}-${side}${row + 1}${String.fromCharCode(97 + k)}`, { v: V, amps: unitAmps }));
        units.push({ n, row, left: perUnit });
      }
    });
    units.forEach((u, k) => link(parentFor(k, units.length), u.n));
    return units;
  };
  const take = (units: { n: ElecNode; row: number; left: number }[], row: number) => {
    const u = units.find((x) => x.row === row && x.left > 0) ?? units.find((x) => x.left > 0) ?? units[units.length - 1];
    u.left--;
    return u.n.id;
  };

  // Amps (rounded up to `step`) for a breakered board that must carry `kvaLoad`, derated.
  const ampsFor = (kvaLoad: number, v: number, step = 400, min = 800) =>
    Math.max(min, Math.ceil((kvaLoad * 1000) / (Math.sqrt(3) * v * 0.8) / step) * step);
  // Mechanical plant has its own transformer (est. 50 % of IT with chillers, 25 % with dry coolers: pumps, fans, compressors).
  const mechKVA = ((computeKW + netKW) * (o.mechPct > 0 ? o.mechPct / 100 : o.heatRej === "chiller" ? 0.5 : 0.25)) / 0.9;
  const mech = node("mech", "Mechanical panel (CDUs, dry coolers / chillers, CRAH)", { v: V, amps: ampsFor(mechKVA, V, 200, 400), auto: true, kw: 0 });
  const mechXfmr = (vp: number) => node("xfmr", "Mechanical transformer", { kva: Math.max(1500, Math.ceil(mechKVA / 500) * 500), vp, v: V, z: 5.75 });

  if (o.power === "dsx-grid-direct") {
    // [dsx] 34.5 kV ring → RMU skid → 4.2 MVA compute MVT → MSB-GPU 5000 A → 8× RPP 1000 A.
    const util = add(node("utility", "Utility / 34.5 kV ring", { v: 34500, scc: 0 }));
    const rmu = add(node("switch", "RMU skid 34.5 kV, 600 A", { v: 34500, amps: 600 }));
    link(util, rmu);
    const msbKVA = rating(480, 5000);
    const sideKVA = (computeKW / 0.95) * 1.05;
    const unitsPerSide = rows.reduce((a, c) => a + Math.ceil(c / perUnit), 0);
    const msbPerSide = Math.max(1, Math.ceil(unitsPerSide / 8), Math.ceil(sideKVA / msbKVA));
    const msbs = (side: string) => Array.from({ length: msbPerSide }, (_, i) => {
      const t = add(node("xfmr", pickName(`Compute MVT-${side}${i + 1} 4.2 MVA`, o.picks.transformers), { kva: 4200, vp: 34500, v: 480, z: 5.75 }));
      const m = add(node("swbd", pickName(`MSB-GPU-${side}${i + 1} 5000 A`, o.picks.lv), { v: 480, amps: 5000 }));
      link(rmu, t); link(t, m);
      return m;
    });
    const A = msbs("A"), B = msbs("B");
    // Consecutive units (whole rows) share a switchboard, so each carries an even share of racks.
    const ua = sideUnits("A", (k, n) => A[Math.floor((k * A.length) / n)]);
    const ub = sideUnits("B", (k, n) => B[Math.floor((k * B.length) / n)]);
    // Core: support MVT → ATS (+ core generator) → MSB-SUPP → 2× 1.5 MVA core UPS → core RPPs for network racks.
    const coreKVA = kva(netKW) * 1.1;
    const tS = add(node("xfmr", "Support MVT 2.0 MVA", { kva: Math.max(2000, Math.ceil(coreKVA / 500) * 500), vp: 34500, v: 480, z: 5.75 }));
    const gen = add(node("gen", pickName("Core generator", o.picks.generators), { kva: Math.max(Math.round(o.genKw / 0.8), Math.ceil(coreKVA / 250) * 250), v: 480 }));
    const ats = add(node("ats", "ATS core", { v: 480, amps: ampsFor(coreKVA, 480) }));
    const sw = add(node("swbd", "MSB-SUPP", { v: 480, amps: ampsFor(coreKVA, 480) }));
    const coreUps = Math.max(1500, Math.ceil(coreKVA / 500) * 500);
    const upsA = add(node("ups", pickName(`Core UPS-A ${coreUps / 1000} MVA`, o.picks.ups), { v: 480, kva: coreUps, eff: 0.96 }));
    const upsB = add(node("ups", pickName(`Core UPS-B ${coreUps / 1000} MVA`, o.picks.ups), { v: 480, kva: coreUps, eff: 0.96 }));
    // Each core RPP carries every network rack when the other side is lost.
    const coreAmps = ampsFor(kva(netKW) * 1.1, 480, 100, 225);
    const coreA = add(node("rpp", "RPP-CORE-A", { v: 480, amps: coreAmps }));
    const coreB = add(node("rpp", "RPP-CORE-B", { v: 480, amps: coreAmps }));
    const tM = add(mechXfmr(34500));
    add(mech);
    link(rmu, tS); link(tS, ats); link(gen, ats); link(ats, sw); link(sw, upsA); link(sw, upsB); link(upsA, coreA); link(upsB, coreB);
    link(rmu, tM); link(tM, mech);
    notes.push(`Compute is grid-direct per the DSX Vera Rubin reference design: no UPS or generator on the GPU path; ${msbPerSide} MSB-GPU per side. Only network and support racks are on UPS.`);
    autoLayoutElectrical(e);
    return {
      e, notes,
      feeds: (r, _i, row, net) => {
        if (net) { r.feedA = coreA.id; r.feedB = coreB.id; return; }
        r.feedA = take(ua, row); r.feedB = take(ub, row);
      },
    };
  }

  const util = add(node("utility", "Utility service", { v: 13800, scc: 0 }));
  const mv = add(node("switch", "MV switchgear", { v: 13800, amps: 1200 }));
  link(util, mv);
  const tM = add(mechXfmr(13800));
  add(mech);
  link(mv, tM); link(tM, mech);
  const itKVA = ((computeKW + netKW) / 0.95) * 1.05; // 5 % design margin

  /**
   * One source path: transformer group → ATS ← standby generator group →
   * switchboard → UPS group. Parallel units are one node each, rated at the
   * group's N capacity (the spare generator is not counted).
   */
  const path = (label: string, loadKVA: number) => {
    const nX = Math.max(1, Math.ceil(loadKVA / 0.96 / 0.985 / o.xfmrKva));
    const nG = Math.max(1, Math.ceil((loadKVA * 0.95) / o.genKw));
    const nU = Math.max(1, Math.ceil(loadKVA / o.upsKva));
    const t = add(node("xfmr", pickName(`${label} T (${nX}× ${o.xfmrKva} kVA)`, o.picks.transformers), { kva: nX * o.xfmrKva, vp: 13800, v: V, z: 5.75 }));
    const g = add(node("gen", pickName(`${label} GEN (${nG}+1× ${o.genKw} kW)`, o.picks.generators), { kva: Math.round((nG * o.genKw) / 0.8), v: V }));
    const ats = add(node("ats", `${label} ATS`, { v: V, amps: ampsFor(loadKVA / 0.96, V) }));
    const sw = add(node("swbd", pickName(`${label} SWBD`, o.picks.lv), { v: V, amps: ampsFor(loadKVA / 0.96, V) }));
    const ups = add(node("ups", pickName(`${label} UPS (${nU}× ${o.upsKva} kVA)`, o.picks.ups), { v: V, kva: nU * o.upsKva, eff: 0.96 }));
    link(mv, t); link(t, ats); link(g, ats); link(ats, sw); link(sw, ups);
    return { ups, nX, nG, nU };
  };

  if (o.power === "ups-2n") {
    // Each side carries everything alone.
    const A = path("A", itKVA), B = path("B", itKVA);
    const ua = sideUnits("A", () => A.ups);
    const ub = sideUnits("B", () => B.ups);
    notes.push(`Each side: ${A.nX}× ${o.xfmrKva} kVA transformer(s), ${A.nG}+1× ${o.genKw} kW generators, ${A.nU}× ${o.upsKva} kVA UPS, sized to carry the whole IT load alone.`);
    autoLayoutElectrical(e);
    return {
      e, notes,
      feeds: (r, _i, row, net) => {
        if (net) { r.feedA = A.ups.id; r.feedB = B.ups.id; return; }
        r.feedA = take(ua, row); r.feedB = take(ub, row);
      },
    };
  }

  // Distributed redundant 4-to-make-3: four blocks, each sized for a third of the load.
  const blockKVA = itKVA / 3;
  const blocks = Array.from({ length: 4 }, (_, b) => path(`Block ${b + 1}`, blockKVA).ups);
  // One distribution unit per (block, row, k); racks pair blocks (b, b+1) round robin.
  const per = blocks.map((ups, b) => sideUnits(`${b + 1}-`, () => ups));
  notes.push(`Four blocks of ~${Math.round(blockKVA)} kVA: any three carry the load. Racks alternate block pairs 1-2, 2-3, 3-4, 4-1.`);
  autoLayoutElectrical(e);
  return {
    e, notes,
    feeds: (r, i, row, net) => {
      // Network racks take blocks 1 and 2 at their UPS output.
      if (net) { r.feedA = blocks[0].id; r.feedB = blocks[1].id; return; }
      const a = i % 4, b = (i + 1) % 4;
      r.feedA = take(per[a], row);
      r.feedB = take(per[b], row);
    },
  };
}

// ── Generator ────────────────────────────────────────────────────────────────

/** "R101: msg", "R102: msg" … → "8 racks (R101 … R108): msg". */
export function groupWarnings(msgs: string[]): string[] {
  const by = new Map<string, string[]>();
  const out: string[] = [];
  for (const m of msgs) {
    const i = m.indexOf(": ");
    if (i < 0) { if (!out.includes(m)) out.push(m); continue; }
    const k = m.slice(i + 2);
    (by.get(k) ?? by.set(k, []).get(k)!).push(m.slice(0, i));
  }
  for (const [k, names] of by) {
    out.push(names.length === 1 ? `${names[0]}: ${k}` : `${names.length} items (${names[0]} … ${names[names.length - 1]}): ${k}`);
  }
  return out;
}

export interface Nvl72Bom { item: string; qty: number; detail: string }
export interface Nvl72PodResult {
  scenario: Scenario;
  /** The library the result uses, when the build changed an item (e.g. a rack's power-profile ratings). */
  lib?: LibItem[];
  elec: ElecBasis;
  net: RaNetwork;
  bom: Nvl72Bom[];
  summary: { racks: number; gpus: number; computeKW: number; netKW: number; itKW: number; cduTot: number; crahTot: number; mechKW: number; pue: number; areaM2: number };
  warnings: string[];
  notes: string[];
}

/**
 * Build a GB300 NVL72 pod scenario from the guided-setup choices. `lib` must
 * already contain NVL72_LIB (see ensureNvl72Lib); `elec` is the project basis, whose
 * voltage is replaced by the architecture's (returned in `elec`).
 */
export function buildNvl72Pod(o: Nvl72PodOptions, libItems: LibItem[], elecIn: ElecBasis): Nvl72PodResult {
  const lib = libIndex(libItems);
  const elec: ElecBasis = { ...elecIn, vLL: o.voltage, vLN: o.voltage === 480 ? 277 : 240 };
  const warnings: string[] = [];
  const s = newScenario(o.name);
  // RA fabrics are rail-optimised: each rack reaches every leaf of the compute and converged
  // fabrics. OOB goes to the two SN2201 in its own rack.
  s.nets = DEFAULT_NETS.map((n) => {
    const fabric = n.id === "net-fabric" || n.id === "net-storage";
    return { ...n, cables: [...n.cables], racks: [], attach: fabric ? o.fabricAttach : "nearest", uplink: fabric ? o.uplink : n.uplink };
  });
  const model = o.profile === "nominal" ? "gb300-nvl72-nom" : "gb300-nvl72";
  const L = lib[model];
  if (!L) throw new Error("GB300 NVL72 library items are missing");
  const nRacks = Math.max(1, Math.round(o.racks));
  const net = raNetwork(nRacks);

  // Rows of compute racks.
  const perRow = Math.max(1, Math.min(o.perRow, nRacks));
  const nRows = Math.ceil(nRacks / perRow);
  const rows = Array.from({ length: nRows }, (_, i) => Math.min(perRow, nRacks - i * perRow));

  // Network switches, split per row by compute share; spines in their own rack.
  const share = (total: number, row: number) => Math.round((total * rows.slice(0, row + 1).reduce((a, c) => a + c, 0)) / nRacks) - Math.round((total * rows.slice(0, row).reduce((a, c) => a + c, 0)) / nRacks);
  // Each switch is tagged with its network system and tier (see network.ts).
  type NetDev = { lib: string; net?: string; tier?: NetTier };
  const sw = (n: number, libId: string, net: string, tier: NetTier): NetDev[] => Array.from({ length: n }, () => ({ lib: libId, net, tier }));
  const netRacks: { row: number; name: string; devs: NetDev[]; mgmt?: boolean }[] = [];
  const fillNet = (row: number, base: string, devs: NetDev[]) => {
    let cur: { row: number; name: string; devs: NetDev[] } | null = null, used = 0, kw = 0, k = 0;
    for (const d of devs) {
      const u = lib[d.lib]?.u ?? 1, dk = lib[d.lib]?.kw ?? 0;
      if (!cur || used + u > NVL72_RACK.u - 4 || kw + dk > Math.max(5, o.netRackKW)) {
        cur = { row, name: `${base}${k ? `-${String.fromCharCode(97 + k)}` : ""}`, devs: [] };
        netRacks.push(cur); used = 0; kw = 0; k++;
      }
      cur.devs.push(d); used += u; kw += dk;
    }
  };
  rows.forEach((_, row) => {
    const devs: NetDev[] = [
      { lib: "patch" }, { lib: "patch" },
      ...sw(share(net.computeLeaf, row), "sn5600", "net-fabric", "leaf"),
      ...sw(share(net.convLeaf, row), "sn5600", "net-storage", "leaf"),
    ];
    fillNet(row, `NET-${row + 1}`, devs);
  });
  const spines = net.computeSpine + net.convSpine + net.superSpine;
  if (spines) fillNet(0, "NET-SPINE", [
    { lib: "patch" }, { lib: "patch" },
    ...sw(net.computeSpine + net.superSpine, "sn5600", "net-fabric", "spine"),
    ...sw(net.convSpine, "sn5600", "net-storage", "spine"),
  ]);

  // Geometry: rows face each other across a shared hot aisle in pods of two.
  const W = NVL72_RACK.w, D = 1.2, H = o.hot, C = o.cold;
  const podDepth = o.pattern === "pod" ? D + H + D + C : D + C;
  const rowY = (row: number) => o.pattern === "pod" ? Math.floor(row / 2) * podDepth + (row % 2 ? D + H : 0) : row * podDepth;
  const rowRot = (row: number) => (o.pattern === "pod" && row % 2 ? 180 : 0);
  let maxLen = 0;
  let rackIdx = 0;

  const placed: { r: Rack; row: number; net: boolean; i: number }[] = [];
  // [ra] 12 management nodes for the control plane, in their own rack beside row 1's network racks.
  if (o.mgmtNodes) netRacks.push({ row: 0, name: "MGMT-1", devs: Array.from({ length: 12 }, () => ({ lib: "ra-mgmt-node" })), mgmt: true });
  rows.forEach((cnt, row) => {
    const nets = netRacks.filter((n) => n.row === row);
    const seq: ({ net: true; n: (typeof netRacks)[number] } | { net: false })[] = Array.from({ length: cnt }, () => ({ net: false as const }));
    const at = o.netPos === "middle" ? Math.floor(cnt / 2) : cnt;
    seq.splice(at, 0, ...nets.map((n) => ({ net: true as const, n })));
    seq.forEach((slot, i) => {
      const x = i * W + W / 2, y = rowY(row);
      if (slot.net) {
        const r = newRack(slot.n.name, x, y, rowRot(row));
        r.role = slot.n.mgmt ? "compute" : "network";
        for (const d of slot.n.devs) {
          const dev = addDevice(r, d.lib, lib, true);
          if (dev && d.net) { dev.net = d.net; dev.tier = d.tier; }
        }
        placed.push({ r, row, net: true, i: -1 });
      } else {
        const r = newRack(`R${row + 1}${String(placed.filter((p) => p.row === row && !p.net).length + 1).padStart(2, "0")}`, x, y, rowRot(row));
        r.d = NVL72_RACK.d;
        addDevice(r, model, lib);
        // [ra] two SN2201 OOB switches in every rack, DC powered from the rack.
        for (let k = 0; k < 2; k++) {
          const d = addDevice(r, "sn2201-dc", lib, true);
          if (d) { d.net = "net-oob"; d.tier = "leaf"; }
        }
        placed.push({ r, row, net: false, i: rackIdx++ });
      }
    });
    maxLen = Math.max(maxLen, seq.length * W);
  });

  const computeKW = nRacks * L.kw;
  const netKW = placed.filter((p) => p.net).reduce((a, p) => a + p.r.devs.reduce((b, d) => b + (lib[d.lib]?.kw ?? 0), 0), 0);
  const pw = buildPower(o, computeKW, L.kw, rows, netKW);
  s.electrical = pw.e;
  for (const p of placed) {
    pw.feeds(p.r, p.i, p.row, p.net);
    if (!choosePDU(p.r, lib, elec, 1)) warnings.push(`${p.r.name}: no PDU size passes the feed-loss check at ${o.voltage} V.`);
    s.racks.push(p.r);
  }

  // Cooling basis: ~90 % liquid racks (est.), residual air from compute, network and control-plane racks.
  s.cool.cduKW = o.cduKW;
  s.cool.cduRed = o.cduRed;
  s.cool.dlcRej = o.heatRej;
  s.cool.ambF = Math.round((o.ambC * 9) / 5 + 32);
  // Rack (TCS) flow from the OEM's flow-vs-supply table; ΔT is the facility water side.
  s.cool.tcsLpm = +gb300LpmPerKW(o.supplyC).toFixed(3);
  s.cool.fwDtF = Math.round((o.deltaC * 9) / 5);
  s.cool.red = "N+1";

  if (o.contain && o.pattern === "pod") {
    for (let row = 0; row + 1 < nRows; row += 2) {
      const len = Math.max(placed.filter((p) => p.row === row).length, placed.filter((p) => p.row === row + 1).length) * W;
      s.hacs.push({ id: uid(), name: `HAC-${row / 2 + 1}`, x: len / 2, y: rowY(row) + D / 2 + H / 2, w: len, d: H, rot: 0 });
    }
  }

  // Trays: fiber duct on the cold side and a busway / power tray over each row; a fiber spine joins the rows.
  rows.forEach((_, row) => {
    const y = rowY(row), sgn = rowRot(row) ? -1 : 1, len = (placed.filter((p) => p.row === row).length) * W;
    s.trays.push({ id: uid(), name: `Fiber row ${row + 1}`, kind: "fiber", wmm: 600, dmm: 150, elev: 2.9, pts: [[-0.9, y - 0.15 * sgn], [len + 0.3, y - 0.15 * sgn]] });
    s.trays.push({ id: uid(), name: `${o.feed === "busway" ? "Busway" : "Power"} row ${row + 1}`, kind: o.feed === "busway" ? "busway" : "power", wmm: o.feed === "busway" ? 250 : 600, dmm: 150, elev: 2.6, pts: [[0, y + 0.35 * sgn], [len, y + 0.35 * sgn]] });
  });
  if (nRows > 1) s.trays.push({ id: uid(), name: "Fiber spine", kind: "fiber", wmm: 600, dmm: 150, elev: 2.9, pts: [[-0.9, rowY(0) - 0.15], [-0.9, rowY(nRows - 1) + 0.15]] });

  // CDUs and CRAHs from the cooling analysis.
  // Size each fiber duct for the cables it actually carries (endpoint + leaf-to-spine).
  const DUCTS: [number, number][] = [[600, 150], [900, 150], [900, 200], [1200, 200]];
  for (let pass = 0; o.sizeDucts && pass < DUCTS.length; pass++) {
    const over = new Set(cableAnalysis(s, lib).segs.filter((g) => g.fill > s.cable.fillMax).map((g) => g.t.id));
    if (!over.size) break;
    for (const t of s.trays) {
      if (!over.has(t.id)) continue;
      const i = DUCTS.findIndex(([w, d]) => w * d > t.wmm * t.dmm);
      if (i >= 0) [t.wmm, t.dmm] = DUCTS[i];
    }
  }
  const an = analyze(s, { lib, elec });
  const cduK = COOL_K.cdu;
  if (o.cduPos === "in-row") {
    // Spread CDUs over the rows, at the far end of each row.
    for (let i = 0; i < an.cduTot; i++) {
      const row = i % nRows, k = Math.floor(i / nRows);
      const len = placed.filter((p) => p.row === row).length * W;
      s.coolers.push({ id: uid(), name: `CDU-${i + 1}`, kind: "cdu", x: len + 0.3 + cduK.w / 2 + k * cduK.w, y: rowY(row), w: cduK.w, d: cduK.d, rot: rowRot(row), cap: o.cduKW });
    }
  } else {
    const gy = rowY(nRows - 1) + D + C + 1.2;
    for (let i = 0; i < an.cduTot; i++)
      s.coolers.push({ id: uid(), name: `CDU-${i + 1}`, kind: "cdu", x: i * 1.0 + 0.5, y: gy, w: cduK.w, d: cduK.d, rot: 0, cap: o.cduKW });
  }
  const crahY = -D / 2 - C - 0.45;
  for (let i = 0; i < an.crahTot; i++) {
    const k = COOL_K.crah;
    s.coolers.push({ id: uid(), name: `CRAH-${i + 1}`, kind: "crah", x: maxLen / 2 + (i - (an.crahTot - 1) / 2) * 3.2, y: crahY, w: k.w, d: k.d, rot: 180, cap: s.cool.crahKW });
  }

  // Offset onto the plan.
  const ox = o.ox || 0, oy = o.oy || 0;
  for (const r of s.racks) { r.x += ox; r.y += oy; }
  for (const c of s.coolers) { c.x += ox; c.y += oy; }
  for (const h of s.hacs) { h.x += ox; h.y += oy; }
  for (const t of s.trays) t.pts = t.pts.map((p) => [p[0] + ox, p[1] + oy]);

  // Checks.
  const maxAmb = maxDryAmbientC(o.supplyC);
  if (o.heatRej === "drycooler" && o.ambC > maxAmb)
    warnings.push(`Design ambient ${o.ambC} °C is above the ${maxAmb} °C a dry cooler can serve for ${o.supplyC} °C supply (CDU ${CDU_APPROACH_C} K + dry cooler ${DRY_APPROACH_C} K approach). Add trim chillers or adiabatic assist, or raise the supply temperature.`);
  if (o.supplyC > 45 || o.supplyC < 25) warnings.push(`${o.supplyC} °C supply is outside the 25–45 °C GB300 NVL72 allowable range (Lenovo LP2357).`);
  else if (o.supplyC >= 40) warnings.push(`${o.supplyC} °C supply needs ${Math.round(gb300LpmPerKW(o.supplyC) * 135)} L/min per rack (Lenovo LP2357 Table 27): size CDU pumps and manifolds for it.`);
  if (o.floor === "raised")
    warnings.push(`Each GB300 NVL72 rack is ~${Math.round(NVL72_RACK.kgEst * 2.20462)} lb (~${NVL72_RACK.kgEst} kg est.) on ${(NVL72_RACK.w * NVL72_RACK.d).toFixed(2)} m²: confirm raised-floor concentrated and rolling load ratings, or use slab on grade.`);
  if (o.cduKW < L.kw) warnings.push(`A ${o.cduKW} kW CDU is smaller than one rack (${L.kw} kW).`);
  warnings.push(...groupWarnings(an.warns.map((w) => w.msg)));

  const notes = [
    ...net.notes, ...pw.notes,
    `Coolant supply ${o.supplyC} °C (25–45 °C allowable): ${Math.round(gb300LpmPerKW(o.supplyC) * L.kw)} L/min per rack (Lenovo LP2357 Table 27).`,
    `About ${Math.round((1 - L.liq) * L.kw)} kW per rack goes to room air (${Math.round((1 - L.liq) * 100)} % air share, est.): containment and CRAH capacity cover it.`,
  ];
  const nNet = netRacks.filter((n) => !n.mgmt).length;
  s.notes = `${nRacks}× GB300 NVL72 (${L.kw} kW), ${nRacks * NVL72_RACK.gpus} GPUs, ${nRows} row(s), ${POWER_ARCH[o.power].label}, ${o.heatRej === "drycooler" ? "dry coolers" : "chillers"} at ${o.supplyC} °C supply. Guided setup from the NVIDIA NVL72 AI Factory RA (GB300); estimates to verify.`;

  const cnt = (t: ElecNode["type"]) => s.electrical.nodes.filter((n) => n.type === t).length;
  const bom: Nvl72Bom[] = [
    { item: "GB300 NVL72 rack", qty: nRacks, detail: `${L.kw} kW each (${o.profile === "nominal" ? "TDP, Lenovo" : "RA maximum"}), 2 in-rack SN2201 OOB` },
    { item: "Network racks", qty: nNet, detail: `${net.computeLeaf + net.convLeaf} leaf, ${spines} spine${net.superSpine ? " / super-spine (est.)" : ""} SN5600` },
    ...(o.mgmtNodes ? [{ item: "Control-plane rack", qty: 1, detail: "12 management nodes (RA)" }] : []),
    { item: "CDU", qty: an.cduTot, detail: `${o.picks.cdus ?? "CDU"} · ${o.cduKW} kW · ${o.cduRed}` },
    { item: "CRAH (network racks)", qty: an.crahTot, detail: o.picks.crah ?? `${s.cool.crahKW} kW chilled-water CRAH` },
    { item: o.heatRej === "drycooler" ? "Dry coolers" : "Chillers", qty: 0, detail: `${Math.round(an.liq * (1 + s.cool.margin))} kW heat rejection${o.picks.chillers && o.heatRej === "chiller" ? ` · ${o.picks.chillers}` : ""}` },
    { item: "Transformers", qty: cnt("xfmr"), detail: o.picks.transformers ?? "" },
    { item: "Switchboards", qty: cnt("swbd"), detail: o.picks.lv ?? "" },
    { item: "UPS", qty: cnt("ups"), detail: o.picks.ups ?? "" },
    { item: "Generators", qty: cnt("gen"), detail: o.picks.generators ?? "" },
    { item: o.feed === "busway" ? "Busway runs" : "RPPs", qty: cnt(o.feed === "busway" ? "busway" : "rpp"), detail: `${o.feed === "busway" ? o.busAmps : o.rppAmps} A${o.feed === "busway" && o.picks.busway ? ` · ${o.picks.busway}` : ""}` },
  ];

  return {
    scenario: s, elec, net, bom, warnings, notes,
    summary: {
      racks: nRacks, gpus: nRacks * NVL72_RACK.gpus, computeKW, netKW, itKW: an.it, cduTot: an.cduTot, crahTot: an.crahTot,
      mechKW: an.mechKW, pue: an.pue, areaM2: an.area,
    },
  };
}
