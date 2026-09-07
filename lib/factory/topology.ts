// ─────────────────────────────────────────────────────────────────────────────
// AI Factory power-topology GENERATOR — the "power expert agent" engine in-app.
//
// Turns a design brief into a sized, valid single-line. Pure entry points:
//   parseBrief(text)      → Spec   (deterministic NL → structured spec, client-side)
//   sizePowerChain(spec)  → Sizing (the quantitative equipment schedule)
//   buildTopology(spec)   → SldGraph (a laid-out single-line that passes sld.validate)
//   brief(spec)           → string  (a 1-page markdown brief for sales / investors)
//
// Switchboards only — no busbars: an MV main switchboard distributes to the
// transformer+UPS blocks, and the UPS tie into the LV distribution boards SWBD-A/B
// (every board output is a feeder breaker). Knowledge constants mirror
// data/power-equipment.json (cited inline). Primary source: SemiAnalysis
// "Datacenter Anatomy Part 1: Electrical Systems". The graph is the canonical
// SldGraph from ./sld, so a generated design loads straight into the editor.
// ─────────────────────────────────────────────────────────────────────────────

import { PAL, defaultBreakers, breakeredDefaults, validate, type SldArchitecture, type SldGraph, type SldNode } from "./sld";
import { DSX, buildDsx, briefDsx, sizeDsx, type DsxCounts } from "./dsx-topology";
import { buildGridDirect, briefGridDirect, sizeGridDirect } from "./grid-direct-topology";

// ── Knowledge constants (mirror data/power-equipment.json; [semi] = SemiAnalysis Part 1) ──
const K = {
  voltages: { hv: "230 kV", mv: "13.8 kV", lv: "480 V" }, // [semi] HV 138/230/345, MV 11/13.8/22/33, LV 415/480
  hvTransformerMVA: 75, // [semi] 50-100 MVA, GOES-core, 18-24 mo lead
  unitSubMVA: 2.5, //      [semi] MV→LV unit sub, 2.5-3 MVA
  gensetMW: 3, //          [semi] 2-3 MW hyperscale gensets
  upsModuleKVA: 400, //    [semi] 200/400 kVA modules, up to 27 MW/system
  podMW: 2.5, //           [semi] standardised pods 1.6 / 2.0 / 2.5 MW
  rackKW: 120, //          GB300 NVL72 (data/reference-architectures.json)
  gpusPerRack: 72,
  pue: 1.2,
};

export type GenScheme = "N" | "N+1" | "2N" | "2N+1";
export type UpsScheme = "N" | "2N" | "2N+1" | "N+1" | "distributed-4to3" | "distributed-3to2" | "catcher";
export type DistScheme = "2N" | "N";
export type Tier = "I" | "II" | "III" | "IV";

export interface Spec {
  name: string;
  itMW: number;
  pue: number;
  rackKW: number;
  gpusPerRack: number;
  podMW: number;
  cooling: "liquid" | "hybrid" | "air";
  tier: Tier;
  redundancy: { generation: GenScheme; ups: UpsScheme; distribution: DistScheme };
  voltages: { hv: string; mv: string; lv: string };
  /** On-site BESS at the MV interconnection (PCC) for grid services + ride-through. */
  bess: boolean;
  /** Standby-generator connection voltage: LV (480 V, default — SWBD-A/B transfer
   *  the UPS's source between the unit-sub transformer and the generator) or MV
   *  (generator lands upstream of every unit-sub transformer instead). */
  genVoltage: "LV" | "MV";
  /** Which reference architecture to generate. `ups-chain` is the legacy design
   *  this file builds; `dsx-vr` hands off to ./dsx-topology; `modular-pod` hands
   *  off to ./grid-direct-topology (a second grid-direct pattern — no UPS
   *  anywhere, single-corded racks, ATS backup for mechanical load only).
   *  Default stays `ups-chain` so every existing brief keeps producing the same
   *  graph. */
  architecture: SldArchitecture;
  /** DSX-VR only: draw the optional 75 MVA on-site base-generation block at each
   *  38 kV lineup (notes 2 & 3). Off unless the brief asks for it. */
  onsiteGen: boolean;
  /** DSX-VR only: size the BESS fleet to cover the whole facility load so the
   *  entire site is curtailable, instead of the 2-blocks-per-lineup the sheets
   *  draw. An [assumption] about note 6's intent, not a sourced quantity — opt in
   *  explicitly ("curtail the whole site", "bess covers facility load"). */
  bessCoverFacility: boolean;
}

/** What callers may pass: any subset of a Spec (incl. partial redundancy/voltages),
 *  plus `facilityMW` as an alternative to `itMW`. Everything unstated takes a default. */
export type SpecInput = Partial<Omit<Spec, "redundancy" | "voltages">> & {
  facilityMW?: number;
  redundancy?: Partial<Spec["redundancy"]>;
  voltages?: Partial<Spec["voltages"]>;
};

interface SchemeDef { label: string; group?: [number, number]; reserve?: boolean; blocks: (n: number) => number; }
const SCHEMES: Record<string, SchemeDef> = {
  N: { label: "N", blocks: (n) => n },
  "N+1": { label: "N+1", blocks: (n) => n + 1 },
  "2N": { label: "2N", blocks: (n) => 2 * n },
  "2N+1": { label: "2N+1", blocks: (n) => 2 * n + 1 },
  "distributed-4to3": { label: "distributed redundant (4-to-make-3)", group: [4, 3], blocks: (n) => Math.ceil(n / 3) * 4 },
  "distributed-3to2": { label: "distributed redundant (3-to-make-2)", group: [3, 2], blocks: (n) => Math.ceil(n / 2) * 3 },
  catcher: { label: "catcher / N+2C (isolated parallel, STS)", reserve: true, blocks: (n) => n + 1 },
};
const TIERS: Record<Tier, { downtime: string; attr: string }> = {
  I: { downtime: "28.8 h/yr", attr: "single path" },
  II: { downtime: "22 h/yr", attr: "redundant capacity" },
  III: { downtime: "1.6 h/yr", attr: "concurrently maintainable" },
  IV: { downtime: "0.43 h/yr", attr: "fault tolerant" },
};
function scheme(key: string): SchemeDef { return SCHEMES[key] || SCHEMES.N; }
const ceil = (x: number) => Math.ceil(x - 1e-9);
const round1 = (x: number) => Math.round(x * 10) / 10;

// Standard breaker/bus frame sizes, ascending — round a computed amp need up to
// the next one a real board actually ships in (mirrors grid-direct-topology.ts).
const STD_AMPS = [400, 600, 800, 1200, 1600, 2000, 2500, 3200, 4000, 5000, 6000, 8000];
function stdAmp(need: number): number { return STD_AMPS.find((a) => a >= need) ?? Math.ceil(need / 500) * 500; }
/** 3-phase amps from an MVA rating at a given line-line volts — nameplate, no pf derate. */
function xfoAmps(mva: number, volts: number): number { return (mva * 1e6) / (Math.sqrt(3) * volts); }
const lvV = (spec: Spec) => parseFloat(spec.voltages.lv) || 480; // "480 V" -> 480

// ── Deterministic NL parser: a design brief → Spec ──────────────────────────
// Heuristic (regex/keyword) so it runs instantly, client-side, with no API call.
// Understands: capacity (MW, IT vs facility), PUE, redundancy schemes, tier,
// rack platform (GB300/GB200/Rubin), and cooling. Anything unstated takes the default.
export function parseBrief(text: string): Spec {
  const t = (text || "").toLowerCase();
  const num = (re: RegExp) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };

  const mw = num(/(\d+(?:\.\d+)?)\s*mw/);
  const isFacility = /\b(facility|total|grid|utility|connected)\b/.test(t) && !/\bcritical\b/.test(t);

  // ── architecture gate ──
  // "vera rubin" alone only picks the rack platform — plenty of briefs want a
  // conventional UPS-chain campus full of VR200s. The DSX-VR generator is selected
  // by naming the reference design, or by asking for one of the things that only
  // it does: grid-direct compute, no UPS at all, a curtailable load, deployment
  // units as the unit of scale. "modular-pod" is a SECOND grid-direct pattern —
  // deliberately gated on different words (modular pods, single-corded, row
  // redundancy) so it never collides with dsx-vr's "grid-direct"/"no ups" triggers,
  // which stay pinned to dsx-vr by existing briefs.
  const architecture: SldArchitecture =
    /\bdsx\b|dsx[\s-]*vr|vera\s*rubin\s*(reference|ra\b|reference\s*architecture)|reference\s*(design|architecture).*vera\s*rubin|grid[\s-]*direct|\bno\s*ups\b|curtailab|deployment\s*unit/.test(t)
      ? "dsx-vr"
      : /modular\s*(pod|data\s*center)|pod[\s-]*based|single[\s-]*cord|row[\s-]*(level\s*)?redundan|\bmdc\b|panelboard/.test(t)
        ? "modular-pod"
        : "ups-chain";
  const isDsx = architecture === "dsx-vr";
  // An unstated PUE takes K.pue (1.2) for BOTH architectures. For DSX-VR that is the
  // FLOOR of the sourced 1.2-1.5 band, deliberate: Eric's call (2026-08-14) is to
  // default to the state-of-the-art end of the band, not the midpoint, because at
  // this scale (100 MW class) every 0.1 of PUE is real load-side energy, and the
  // whole point of grid-direct + BESS/curtailment is to buy into that floor. It
  // feeds facilityMW -> BESS count -> feeder count -> cost, and the brief prints it
  // as if it were specified.
  const pue = num(/pue\s*(?:of\s*)?(\d+(?:\.\d+)?)/) ?? K.pue;

  // rack platform — DSX-VR is a Vera Rubin design, so VR200 NVL144 is its default
  let rackKW = isDsx ? DSX.rackKW : K.rackKW, gpusPerRack = isDsx ? DSX.gpusPerRack : K.gpusPerRack;
  if (/gb200|nvl72/.test(t) && !/gb300/.test(t)) { rackKW = 132; gpusPerRack = 72; }
  if (/gb300/.test(t)) { rackKW = K.rackKW; gpusPerRack = K.gpusPerRack; }
  if (/\b(vr200|vera\s*rubin|rubin|nvl144)\b/.test(t)) { rackKW = 200; gpusPerRack = 144; }
  const rackOverride = num(/(\d+(?:\.\d+)?)\s*kw\s*(?:\/|per\s*)?rack/);
  if (rackOverride) rackKW = rackOverride;

  // DSX-VR: capacity may be given in whole deployment units instead of MW.
  const duAsked = num(/(\d+)\s*(?:deployment\s*units?|dus?\b)/) ?? (/\b(a|one|single)\s+deployment\s*unit\b/.test(t) ? 1 : null);
  // The optional 75 MVA per-lineup base-generation block (notes 2 & 3).
  const onsiteGen = /on[\s-]*site\s*(base\s*)?gener|base\s*generation|behind[\s-]*the[\s-]*meter|\bhrsg\b|fuel\s*cell/.test(t);
  // Opt in to sizing the BESS for whole-site curtailment (see Spec.bessCoverFacility).
  const bessCoverFacility = /curtail\s*(the\s*)?(whole|entire|full)\s*(site|load|facility)|bess\s*cover|fully\s*curtailable\s*site/.test(t);

  // redundancy — UPS layer
  let ups: UpsScheme = "distributed-4to3";
  if (/catcher|n\+2c|isolated\s*parallel/.test(t)) ups = "catcher";
  else if (/4[\s-]*to[\s-]*make[\s-]*3|distributed/.test(t)) ups = "distributed-4to3";
  else if (/3[\s-]*to[\s-]*make[\s-]*2/.test(t)) ups = "distributed-3to2";
  else if (/\b2n\s*ups|ups\s*2n\b/.test(t)) ups = "2N";
  else if (/\bn\+1\s*ups\b/.test(t)) ups = "N+1";

  // generation
  let generation: GenScheme = "N+1";
  if (/2n\s*(generation|gener|gen|genset)/.test(t)) generation = "2N";
  else if (/\bn\b\s*generation/.test(t)) generation = "N";

  // distribution to the rack
  const distribution: DistScheme = /\bn\b\s*(distribution|dist|to\s*the\s*rack)/.test(t) && !/2n/.test(t) ? "N" : "2N";

  // tier
  const tm = t.match(/tier\s*(iv|iii|ii|i|4|3|2|1)/);
  const tierMap: Record<string, Tier> = { "1": "I", "2": "II", "3": "III", "4": "IV", i: "I", ii: "II", iii: "III", iv: "IV" };
  const tier: Tier = tm ? tierMap[tm[1]] : "III";

  // cooling
  const cooling: Spec["cooling"] = /air[\s-]*cool/.test(t) ? "air" : /hybrid/.test(t) ? "hybrid" : "liquid";

  // BESS at the interconnection — on by default; opt out with "no bess/battery/storage"
  const bess = !/\bno\s+(bess|battery|batteries|storage)\b|\bwithout\s+(bess|battery|batteries|storage)\b/.test(t);
  // generator connection voltage — LV (480 V) by default, MV if explicitly asked
  const genVoltage: "LV" | "MV" = /\b(mv|medium[\s-]*voltage|13\.?8\s*kv|11\s*kv)\s*(gen|genset|generator)/.test(t) ? "MV" : "LV";

  // name — a quoted phrase, "<word> campus/factory", else default
  const qm = text.match(/["“]([^"”]{2,60})["”]/);
  const nm = text.match(/\b([A-Z][A-Za-z0-9-]+)\s+(?:campus|factory|cluster|datacenter|data\s*center|site)\b/);
  const name = (qm?.[1] || nm?.[1] || "AI factory").trim();

  // "give me one deployment unit" fixes capacity directly; an explicit MW figure
  // still wins, because it is the more specific statement of intent.
  const duMW = isDsx && duAsked != null && mw == null ? duAsked * DSX.duITMW : null;

  return normalizeSpec({
    name,
    itMW: duMW ?? (isFacility || mw == null ? undefined : mw),
    facilityMW: duMW == null && isFacility && mw != null ? mw : undefined,
    pue, rackKW, gpusPerRack, cooling, tier, bess, genVoltage, architecture, onsiteGen, bessCoverFacility,
    redundancy: { generation, ups, distribution },
  } as SpecInput);
}

// ── Spec normalisation ──────────────────────────────────────────────────────
export function normalizeSpec(input: SpecInput | undefined): Spec {
  const s = input || {};
  const r = s.redundancy || ({} as Spec["redundancy"]);
  const v = s.voltages || ({} as Spec["voltages"]);
  const architecture: SldArchitecture = s.architecture || "ups-chain";
  const isDsx = architecture === "dsx-vr";
  const pue = s.pue || K.pue;
  // An unqualified DSX-VR ask means "the reference design" — so it lands on the
  // sheets' own 103 MW / 8-DU site rather than the generic 10 MW fallback.
  const fallbackMW = isDsx ? DSX.itMWNominal : 10;
  const itMW = s.itMW != null ? Number(s.itMW) : s.facilityMW != null ? Number(s.facilityMW) / pue : fallbackMW;
  return {
    name: s.name || "AI factory",
    itMW,
    pue,
    rackKW: s.rackKW || (isDsx ? DSX.rackKW : K.rackKW),
    gpusPerRack: s.gpusPerRack || (isDsx ? DSX.gpusPerRack : K.gpusPerRack),
    podMW: s.podMW || K.podMW,
    cooling: s.cooling || "liquid",
    tier: s.tier || "III",
    redundancy: {
      generation: r.generation || "N+1",
      ups: r.ups || "distributed-4to3",
      distribution: r.distribution || "2N",
    },
    voltages: { hv: v.hv || K.voltages.hv, mv: v.mv || K.voltages.mv, lv: v.lv || K.voltages.lv },
    bess: s.bess ?? true,
    genVoltage: s.genVoltage || "LV",
    architecture,
    onsiteGen: s.onsiteGen ?? false,
    bessCoverFacility: s.bessCoverFacility ?? false,
  };
}

// ── Sizing: the quantitative power chain ────────────────────────────────────
export interface ScheduleRow { item: string; qty: number; rating: string; scheme: string; catalogKey: string; lead: string; risk: string; }
export interface Sizing {
  spec: Spec; facilityMW: number; itMW: number; racks: number; gpus: number;
  /** Legacy UPS-chain: pod count. DSX-VR: deployment-unit count. */
  podsNeeded: number;
  schedule: ScheduleRow[];
  /** Present only on `architecture: "dsx-vr"` sizings — the DU/ring/core counts
   *  the schedule and the drawn graph are both derived from. */
  dsx?: DsxCounts;
}

export function sizePowerChain(input: SpecInput): Sizing {
  const spec = normalizeSpec(input);
  if (spec.architecture === "dsx-vr") return sizeDsx(spec);
  if (spec.architecture === "modular-pod") return sizeGridDirect(spec);
  const facilityMW = round1(spec.itMW * spec.pue);
  const racks = ceil((spec.itMW * 1000) / spec.rackKW);
  const gpus = racks * spec.gpusPerRack;
  const podsNeeded = ceil(spec.itMW / spec.podMW);

  const ups = scheme(spec.redundancy.ups), gen = scheme(spec.redundancy.generation), dist = scheme(spec.redundancy.distribution);
  const upsBlocks = ups.blocks(podsNeeded);
  const upsModules = ups.blocks(ceil((podsNeeded * spec.podMW * 1000) / K.upsModuleKVA));
  const gensets = gen.blocks(ceil(facilityMW / K.gensetMW));
  const hvTransformers = gen.blocks(ceil(facilityMW / (K.hvTransformerMVA * 0.95)));
  const swbds = dist.blocks(podsNeeded);
  const rpps = (spec.redundancy.distribution === "2N" ? 4 : 2) * podsNeeded;

  const genRating = spec.genVoltage === "MV" ? K.gensetMW + " MW · " + spec.voltages.mv : K.gensetMW + " MW · " + spec.voltages.lv;
  return {
    spec, facilityMW, itMW: round1(spec.itMW), racks, gpus, podsNeeded,
    schedule: [
      { item: "HV substation transformer", qty: hvTransformers, rating: K.hvTransformerMVA + " MVA", scheme: gen.label, catalogKey: "transformers", lead: "18-24 mo", risk: "high" },
      { item: "MV switchboard (main-tie-main)", qty: 2, rating: spec.voltages.mv + " · A/B + tie", scheme: "main-tie-main", catalogKey: "switchgear", lead: "~50 wk", risk: "high" },
      ...(spec.bess ? [{ item: "BESS (grid interconnect / PCC)", qty: 1, rating: round1(facilityMW) + " MW · grid services + ride-through", scheme: "—", catalogKey: "bess", lead: "12-18 mo", risk: "med" }] : []),
      { item: "Standby genset", qty: gensets, rating: genRating, scheme: gen.label, catalogKey: "generators", lead: "18 mo", risk: "high" },
      ...(spec.genVoltage === "LV" ? [
        { item: "Normal-source aggregation switchboard (feeds SWBD-A/B's normal input)", qty: 2, rating: spec.voltages.lv + " · aggregated unit-sub secondaries", scheme: "—", catalogKey: "lv", lead: "—", risk: "low" },
        { item: "Generator transfer switchboard (SWBD-A/B, upstream of the UPS)", qty: 2, rating: spec.voltages.lv + " · transfer — normal (aggregation bus) / emergency (generator)", scheme: "—", catalogKey: "lv", lead: "—", risk: "low" },
      ] : []),
      { item: "Unit-sub transformer (MV→LV)", qty: upsBlocks, rating: spec.podMW + " MVA", scheme: ups.label, catalogKey: "transformers", lead: "—", risk: "med" },
      { item: "Static UPS block", qty: upsBlocks, rating: spec.podMW + " MVA", scheme: ups.label, catalogKey: "ups", lead: "—", risk: "med" },
      { item: "UPS power module", qty: upsModules, rating: K.upsModuleKVA + " kVA", scheme: ups.label, catalogKey: "ups", lead: "—", risk: "low" },
      { item: "LV distribution switchboard", qty: swbds, rating: spec.voltages.lv + " · 3200 A", scheme: spec.redundancy.distribution, catalogKey: "lv", lead: "—", risk: "low" },
      { item: "Remote power panel (RPP)", qty: rpps, rating: "415/240 V", scheme: spec.redundancy.distribution, catalogKey: "lv", lead: "—", risk: "low" },
      { item: "Compute rack", qty: racks, rating: spec.rackKW + " kW", scheme: spec.redundancy.distribution + " cords", catalogKey: "accel", lead: "—", risk: "—" },
    ],
  };
}

// ── Topology: a representative, VALID single-line (SldGraph) — switchboards only ──
export function buildTopology(input: SpecInput): SldGraph {
  const spec0 = normalizeSpec(input);
  if (spec0.architecture === "dsx-vr") return buildDsx(spec0);
  if (spec0.architecture === "modular-pod") return buildGridDirect(spec0);
  const sz = sizePowerChain(input);
  const spec = sz.spec;
  const ups = scheme(spec.redundancy.ups);
  const twoN = spec.redundancy.distribution === "2N";

  const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0 };
  const N = (type: string, name: string, x: number, y: number, extra?: Partial<SldNode>) => { g.uid++; const n = mk("n" + g.uid, type, name, x, y, extra); g.nodes.push(n); return n; };
  const E = (from: SldNode, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
  const EB = (from: SldNode, br: string, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };

  const util = N("utility", "Utility feed " + spec.voltages.hv, 180, 18, { rating: spec.voltages.hv });

  // main-tie-main MV: two main transformers → two MV switchboards + a normally-open tie
  const txMainA = N("transformer", "Main transformer A", 180, 96, { rating: K.hvTransformerMVA + " MVA · HV/MV" });
  const txMainB = N("transformer", "Main transformer B", 760, 96, { rating: K.hvTransformerMVA + " MVA · HV/MV" });
  const mvA = N("switchboard", "MV SWBD-A · " + spec.voltages.mv, 150, 176, { voltage: spec.voltages.mv, mainAmp: 1200, rating: spec.voltages.mv + " · 1200 A" });
  const mvB = N("switchboard", "MV SWBD-B · " + spec.voltages.mv, 760, 176, { voltage: spec.voltages.mv, mainAmp: 1200, rating: spec.voltages.mv + " · 1200 A" });
  const tieBrk = (mvA.breakers || []).find((b) => b.id === "b3"); if (tieBrk) { tieBrk.label = "TIE"; tieBrk.status = "open"; }
  E(util, txMainA); E(util, txMainB); E(txMainA, mvA); E(txMainB, mvB);
  EB(mvA, "b3", mvB); // normally-open bus tie

  // BESS at the MV interconnection (point of common coupling)
  if (spec.bess) { const bess = N("bess", "BESS · grid interconnect", 1120, 18, { rating: round1(sz.facilityMW) + " MW · PCC" }); E(bess, mvA); }

  // how many transformer+UPS blocks to draw, by scheme shape (≤4), split across MV-A/B
  let shown = 2;
  if (ups.group) shown = ups.group[0];
  else if (spec.redundancy.ups === "catcher") shown = 3;
  else if (spec.redundancy.ups === "N+1") shown = 3;
  shown = Math.min(shown, 4);

  const halfB = Math.ceil(shown / 2);
  const txX: SldNode[] = [], upsX: SldNode[] = [];
  const sideA: boolean[] = []; // parallel to txX/upsX: which MV side each unit's transformer homes on
  const boardIdx: Record<string, number> = {};
  for (let i = 0; i < shown; i++) {
    const onA = i < halfB;
    const home = onA ? mvA : mvB;
    const x = onA ? 150 + i * 190 : 760 + (i - halfB) * 190;
    const isReserve = spec.redundancy.ups === "catcher" && i === shown - 1;
    const tx = N("transformer", "Transformer " + (i + 1), x, 250, { rating: spec.podMW + " MVA" });
    const u = N("ups", isReserve ? "UPS R (reserve)" : "UPS " + (i + 1), x, 520, { rating: K.upsModuleKVA + " kVA modules", red: spec.redundancy.ups });
    boardIdx[home.id] = (boardIdx[home.id] ?? 0) + 1;
    EB(home, "b" + boardIdx[home.id], tx); // MV feeder breaker → unit-sub transformer
    // tx→ups wiring is deferred: with an LV-side generator, SWBD-A/B (below) sit
    // between them as the transfer source; with an MV-side generator there is no
    // second LV source to switch, so the wire goes straight through.
    txX.push(tx); upsX.push(u); sideA.push(onA);
  }

  // generators on the 480 V site-distribution voltage (or MV if requested).
  //
  // LV case: SWBD-A / SWBD-B sit UPSTREAM of the UPS, between that MV side's
  // unit-sub transformer(s) and the UPS units they feed — a TRANSFER board,
  // switching the UPS's source between normal (the transformers, aggregated
  // through a "Normal bus" when there's more than one) and emergency (the
  // generator), never paralleling the two. `transferSource: true` + exactly two
  // external incomers is checked structurally (sld.validate) — the aggregation
  // step exists specifically so a side with multiple unit-sub transformers still
  // presents as ONE normal-source incomer, keeping the board a genuine transfer
  // rather than an N-way permanently co-energized bus (a plain multi-incomer
  // edge set, tried first, is indistinguishable from paralleling — see
  // docs/dev-platform/status.md). SWBD-A/B sit upstream of the UPS, never at the
  // LV boards the UPS output feeds: landing there would strand the UPS during
  // the transfer and let load ride raw generator power with no conditioning.
  //
  // MV case: the generator already lands on mvA, upstream of every unit-sub
  // transformer, so there is no second LV-level source needing a transfer board.
  const gen = N("genset", "On-site generation", 540, 340, { rating: sz.schedule.find((r) => r.item === "Standby genset")!.qty + " × " + K.gensetMW + " MW · " + (spec.genVoltage === "MV" ? spec.voltages.mv : spec.voltages.lv) + " (" + spec.redundancy.generation + ")" });
  if (spec.genVoltage === "MV") {
    E(gen, mvA);
    txX.forEach((tx, i) => E(tx, upsX[i]));
  } else {
    const buildXfer = (label: string, x: number, members: number[]) => {
      const side = label.slice(-1); // "A" or "B"
      // Normal source: that side's unit-sub transformer(s). A single member
      // wires straight in via its own feeder breaker as the sole normal
      // incomer; more than one is aggregated first (a "Normal bus", plain
      // N-to-1 edges, same shape LV SWBD-A/B already uses for their UPS
      // incomers) so the transfer board still sees exactly one normal incomer
      // (+ the generator = exactly two, checked structurally below).
      // `spec.podMW` is used, by this Spec's own construction, as BOTH the
      // unit-sub transformer's MVA rating AND the paired UPS block's MVA rating
      // (see the "Unit-sub transformer" / "Static UPS block" schedule rows,
      // both `spec.podMW + " MVA"`) — so the same amp figure computed from it IS
      // simultaneously the normal-source aggregate capacity and the downstream
      // demand the board must deliver. This is a property of this Spec, not a
      // computed max of two independently-sized sources; the generator itself
      // carries no per-side amp rating in this model to compare against (its
      // sizing is aggregate/site-wide — see the "Standby genset" schedule row).
      // If podMW ever stops tying transformer and UPS block together 1:1, this
      // would need its own downstream-demand figure; sld.ts's hand-built seed()
      // already handles that general case (2.5 MVA tx paired with 1500 kVA UPS,
      // NOT 1:1), computing the transfer board's mainAmp from the UPS side only.
      const perTxAmps = xfoAmps(spec.podMW, lvV(spec));
      let normalSrc: SldNode;
      if (members.length > 1) {
        normalSrc = N("switchboard", "Normal bus " + side, x, 340, {
          voltage: spec.voltages.lv, mainAmp: stdAmp(perTxAmps * members.length),
          rating: spec.voltages.lv + " · aggregated unit-sub secondaries",
        });
        members.forEach((i) => E(txX[i], normalSrc));
      } else {
        normalSrc = txX[members[0]];
      }
      // NOT `interlocked: true` — that field is DSX-VR-specific (marks the site's
      // one exempted core block) and validateDsx reads it regardless of
      // architecture; a legacy graph mistakenly tagged dsx-vr must still fail.
      const swbd = N("switchboard", label, x, 430, {
        voltage: spec.voltages.lv, mainAmp: stdAmp(perTxAmps * members.length), transferSource: true,
        rating: spec.voltages.lv + " · transfer — normal (transformer) / emergency (generator)",
      });
      if (members.length > 1) EB(normalSrc, "b1", swbd); // Normal bus's single feed is its own feeder breaker
      else E(normalSrc, swbd); // a lone transformer has no breaker bank of its own — plain edge, as elsewhere
      E(gen, swbd); // emergency — the other of the two required external incomers
      members.forEach((i, k) => EB(swbd, "b" + (k + 1), upsX[i]));
      return swbd;
    };
    const idxA = sideA.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
    const idxB = sideA.map((a, i) => (!a ? i : -1)).filter((i) => i >= 0);
    buildXfer("SWBD-A", 150, idxA);
    if (idxB.length) buildXfer("SWBD-B", 900, idxB);
  }

  // LV distribution: the UPS output ties into the site's LV boards (distributed-redundant).
  const schemeTag = ups.group ? " (" + ups.group[0] + "-to-make-" + ups.group[1] + ")"
    : spec.redundancy.ups === "catcher" ? " (N + reserve catcher)"
    : spec.redundancy.ups === "N+1" ? " (N+1)" : spec.redundancy.ups === "2N" ? " (2N)" : "";
  const mult = sz.podsNeeded > 1 ? " · × " + sz.podsNeeded + " pods" : "";
  const swA = N("switchboard", twoN ? "LV SWBD-A" : "LV SWBD", 250, 540, { voltage: spec.voltages.lv, rating: spec.voltages.lv + " · 3200 A" + schemeTag + mult });
  const swB = twoN ? N("switchboard", "LV SWBD-B", 900, 540, { voltage: spec.voltages.lv, rating: spec.voltages.lv + " · 3200 A" + mult }) : null;
  upsX.forEach((u) => { E(u, swA); if (swB) E(u, swB); });

  const rA1 = N("rpp", twoN ? "RPP-A1" : "RPP-1", 150, 632);
  const rA2 = N("rpp", twoN ? "RPP-A2" : "RPP-2", 470, 632);
  const rB1 = twoN ? N("rpp", "RPP-B1", 800, 632) : null;
  const rB2 = twoN ? N("rpp", "RPP-B2", 1120, 632) : null;
  EB(swA, "b1", rA1); EB(swA, "b2", rA2);
  if (twoN && rB1 && rB2) { EB(swB!, "b1", rB1); EB(swB!, "b2", rB2); }

  const rackShow = Math.min(sz.racks, 8);
  const racks: SldNode[] = [];
  for (let i = 0; i < rackShow; i++) {
    const last = i === rackShow - 1 && sz.racks > rackShow;
    racks.push(N("rack", last ? "rack " + (i + 1) + " … (× " + sz.racks + ")" : "rack " + (i + 1), 150 + i * 112, 740, { rating: spec.rackKW + " kW" }));
  }
  const half = Math.ceil(rackShow / 2);
  for (let i = 0; i < rackShow; i++) {
    const aPanel = i < half ? rA1 : rA2;
    const bPanel = i < half ? rB1 : rB2;
    const br = "b" + ((i % half) + 1);
    EB(aPanel, br, racks[i]);
    if (twoN && bPanel) EB(bPanel, br, racks[i]);
  }

  const chiller = N("chiller", "Chiller plant", 1060, 740), cdu = N("cdu", "CDU", 1160, 740), crah = N("crah", "CRAH", 1250, 740);
  const spine = N("spine", "Spine", 1340, 740), leaf = N("leaf", "Leaf", 1430, 740);
  [chiller, cdu, crah, spine, leaf].forEach((l, i) => EB(swA, "b" + (i + 3), l));

  return g;
}

// Local mkNode (controls breaker banks/layout); mirrors sld.mkNode's node shape.
function mk(idStr: string, type: string, name: string | null, x: number, y: number, extra?: Partial<SldNode>): SldNode {
  const p = PAL[type];
  const n: SldNode = { id: idStr, type, name: name || p.label, x, y, kw: p.kw || 0, kind: p.kind, red: "2N", catalogKey: "", product: "", rating: "" };
  if (p.grp) n.grp = p.grp;
  if (p.breakered) { const d = breakeredDefaults(type); n.voltage = d.voltage; if (d.mainAmp != null) n.mainAmp = d.mainAmp; n.breakers = defaultBreakers(type); }
  return Object.assign(n, extra || {});
}

/** Build + self-validate in one call (used by the UI to refuse invalid output). */
export function design(input: SpecInput): { graph: SldGraph; sizing: Sizing; brief: string; ok: boolean; errors: string[] } {
  const sizing = sizePowerChain(input);
  const graph = buildTopology(input);
  const v = validate(graph);
  return { graph, sizing, brief: brief(sizing.spec), ok: v.ok, errors: v.errors };
}

// ── 1-page brief (markdown) ─────────────────────────────────────────────────
export function brief(spec: Spec): string {
  if (spec.architecture === "dsx-vr") return briefDsx(normalizeSpec(spec));
  if (spec.architecture === "modular-pod") return briefGridDirect(normalizeSpec(spec));
  const sz = sizePowerChain(spec);
  const t = TIERS[spec.tier] || TIERS.III;
  const ups = scheme(spec.redundancy.ups).label, gen = scheme(spec.redundancy.generation).label;
  const L: string[] = [];
  L.push("# " + spec.name);
  L.push("");
  L.push("**" + sz.facilityMW + " MW facility** · " + sz.itMW + " MW critical IT · " + sz.racks.toLocaleString() + " × " + spec.rackKW + " kW racks · " + sz.gpus.toLocaleString() + " GPUs · PUE " + spec.pue + " · " + spec.cooling + "-cooled");
  L.push("");
  L.push("## Topology");
  L.push("Utility " + spec.voltages.hv + " → two main transformers → **main-tie-main** MV switchboards (" + spec.voltages.mv + ", MV-A / MV-B + tie)" + (spec.bess ? ", with **BESS** at the interconnection (PCC)" : "") + " → unit-sub transformers (" + spec.podMW + " MVA)" + (spec.genVoltage === "MV" ? "" : " → **SWBD-A/B** transfer switchboards (normal: that side's unit-sub transformers, aggregated where there's more than one · emergency: generator)") + " → **" + ups + "** UPS → LV " + spec.voltages.lv + " distribution switchboards → RPP row panels → " + spec.redundancy.distribution + " dual-corded racks. Standby gensets land " + (spec.genVoltage === "MV" ? "on the " + spec.voltages.mv + " bus, upstream of every unit-sub transformer" : "at SWBD-A/B, upstream of the UPS, as the second of exactly two sources a real transfer switches between — never paralleled onto the normal source") + ".");
  L.push("");
  L.push("## Resilience — Tier " + spec.tier + " (" + t.attr + ", " + t.downtime + ")");
  L.push("- **MV substation:** main-tie-main (secondary-selective) — two mains + normally-open tie");
  L.push("- **Generation / transformers:** " + gen + " · gensets at " + (spec.genVoltage === "MV" ? spec.voltages.mv : spec.voltages.lv));
  L.push("- **UPS layer:** " + ups);
  L.push("- **Distribution to rack:** " + spec.redundancy.distribution + " (independent A/B cords per rack)");
  if (spec.bess) L.push("- **BESS:** at the point of common coupling — grid services + interconnection + ride-through");
  L.push("");
  L.push("## Major equipment schedule");
  L.push("| Equipment | Qty | Unit rating | Redundancy | Lead / risk |");
  L.push("|---|---:|---|---|---|");
  sz.schedule.forEach((r) => L.push("| " + r.item + " | " + r.qty.toLocaleString() + " | " + r.rating + " | " + r.scheme + " | " + r.lead + " · " + r.risk + " |"));
  L.push("");
  L.push("*Source: SemiAnalysis “Datacenter Anatomy Part 1: Electrical Systems” + data/power-equipment.json. Sized estimate — verify against the governing NVIDIA RA and project basis of design.*");
  return L.join("\n");
}

export { SCHEMES, TIERS, K };
