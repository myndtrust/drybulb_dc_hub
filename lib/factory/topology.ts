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

import { PAL, defaultBreakers, validate, type SldGraph, type SldNode } from "./sld";

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
  /** Standby-generator connection voltage: LV (480 V paralleling, default) or MV. */
  genVoltage: "LV" | "MV";
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

// ── Deterministic NL parser: a design brief → Spec ──────────────────────────
// Heuristic (regex/keyword) so it runs instantly, client-side, with no API call.
// Understands: capacity (MW, IT vs facility), PUE, redundancy schemes, tier,
// rack platform (GB300/GB200/Rubin), and cooling. Anything unstated takes the default.
export function parseBrief(text: string): Spec {
  const t = (text || "").toLowerCase();
  const num = (re: RegExp) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };

  const mw = num(/(\d+(?:\.\d+)?)\s*mw/);
  const isFacility = /\b(facility|total|grid|utility|connected)\b/.test(t) && !/\bcritical\b/.test(t);
  const pue = num(/pue\s*(?:of\s*)?(\d+(?:\.\d+)?)/) ?? K.pue;

  // rack platform
  let rackKW = K.rackKW, gpusPerRack = K.gpusPerRack;
  if (/gb200|nvl72/.test(t) && !/gb300/.test(t)) { rackKW = 132; gpusPerRack = 72; }
  if (/\b(vr200|vera\s*rubin|rubin|nvl144)\b/.test(t)) { rackKW = 200; gpusPerRack = 144; }
  const rackOverride = num(/(\d+(?:\.\d+)?)\s*kw\s*(?:\/|per\s*)?rack/);
  if (rackOverride) rackKW = rackOverride;

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

  return normalizeSpec({
    name,
    itMW: isFacility || mw == null ? undefined : mw,
    facilityMW: isFacility && mw != null ? mw : undefined,
    pue, rackKW, gpusPerRack, cooling, tier, bess, genVoltage,
    redundancy: { generation, ups, distribution },
  } as SpecInput);
}

// ── Spec normalisation ──────────────────────────────────────────────────────
export function normalizeSpec(input: SpecInput | undefined): Spec {
  const s = input || {};
  const r = s.redundancy || ({} as Spec["redundancy"]);
  const v = s.voltages || ({} as Spec["voltages"]);
  const pue = s.pue || K.pue;
  const itMW = s.itMW != null ? Number(s.itMW) : s.facilityMW != null ? Number(s.facilityMW) / pue : 10;
  return {
    name: s.name || "AI factory",
    itMW,
    pue,
    rackKW: s.rackKW || K.rackKW,
    gpusPerRack: s.gpusPerRack || K.gpusPerRack,
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
  };
}

// ── Sizing: the quantitative power chain ────────────────────────────────────
export interface ScheduleRow { item: string; qty: number; rating: string; scheme: string; catalogKey: string; lead: string; risk: string; }
export interface Sizing { spec: Spec; facilityMW: number; itMW: number; racks: number; gpus: number; podsNeeded: number; schedule: ScheduleRow[]; }

export function sizePowerChain(input: SpecInput): Sizing {
  const spec = normalizeSpec(input);
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
      ...(spec.genVoltage === "LV" ? [{ item: "Generator paralleling switchboard", qty: 2, rating: spec.voltages.lv + " · paralleling", scheme: "—", catalogKey: "lv", lead: "—", risk: "low" }] : []),
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
  const boardIdx: Record<string, number> = {};
  for (let i = 0; i < shown; i++) {
    const onA = i < halfB;
    const home = onA ? mvA : mvB;
    const x = onA ? 150 + i * 190 : 760 + (i - halfB) * 190;
    const isReserve = spec.redundancy.ups === "catcher" && i === shown - 1;
    const tx = N("transformer", "Transformer " + (i + 1), x, 250, { rating: spec.podMW + " MVA" });
    const u = N("ups", isReserve ? "UPS R (reserve)" : "UPS " + (i + 1), x, 322, { rating: K.upsModuleKVA + " kVA modules", red: spec.redundancy.ups });
    boardIdx[home.id] = (boardIdx[home.id] ?? 0) + 1;
    EB(home, "b" + boardIdx[home.id], tx); // MV feeder breaker → unit-sub transformer
    E(tx, u);
    txX.push(tx); upsX.push(u);
  }

  // LV distribution boards: the UPS tie into SWBD-A/B (distributed-redundant)
  const schemeTag = ups.group ? " (" + ups.group[0] + "-to-make-" + ups.group[1] + ")"
    : spec.redundancy.ups === "catcher" ? " (N + reserve catcher)"
    : spec.redundancy.ups === "N+1" ? " (N+1)" : spec.redundancy.ups === "2N" ? " (2N)" : "";
  const mult = sz.podsNeeded > 1 ? " · × " + sz.podsNeeded + " pods" : "";
  const swA = N("switchboard", twoN ? "SWBD-A" : "SWBD", 250, 452, { voltage: spec.voltages.lv, rating: spec.voltages.lv + " · 3200 A" + schemeTag + mult });
  const swB = twoN ? N("switchboard", "SWBD-B", 900, 452, { voltage: spec.voltages.lv, rating: spec.voltages.lv + " · 3200 A" + mult }) : null;
  upsX.forEach((u) => { E(u, swA); if (swB) E(u, swB); });

  // generators on the 480 V site-distribution voltage (or MV if requested)
  const gen = N("genset", "On-site generation", 540, 300, { rating: sz.schedule.find((r) => r.item === "Standby genset")!.qty + " × " + K.gensetMW + " MW · " + (spec.genVoltage === "MV" ? spec.voltages.mv : spec.voltages.lv) + " (" + spec.redundancy.generation + ")" });
  if (spec.genVoltage === "MV") { E(gen, mvA); }
  else { const genPar = N("switchboard", "GEN PARALLEL SWBD · " + spec.voltages.lv, 500, 376, { voltage: spec.voltages.lv, mainAmp: 4000, rating: spec.voltages.lv + " · paralleling" }); E(gen, genPar); EB(genPar, "b1", swA); if (swB) EB(genPar, "b2", swB); }

  const rA1 = N("rpp", twoN ? "RPP-A1" : "RPP-1", 150, 544);
  const rA2 = N("rpp", twoN ? "RPP-A2" : "RPP-2", 470, 544);
  const rB1 = twoN ? N("rpp", "RPP-B1", 800, 544) : null;
  const rB2 = twoN ? N("rpp", "RPP-B2", 1120, 544) : null;
  EB(swA, "b1", rA1); EB(swA, "b2", rA2);
  if (twoN && rB1 && rB2) { EB(swB!, "b1", rB1); EB(swB!, "b2", rB2); }

  const rackShow = Math.min(sz.racks, 8);
  const racks: SldNode[] = [];
  for (let i = 0; i < rackShow; i++) {
    const last = i === rackShow - 1 && sz.racks > rackShow;
    racks.push(N("rack", last ? "rack " + (i + 1) + " … (× " + sz.racks + ")" : "rack " + (i + 1), 150 + i * 112, 652, { rating: spec.rackKW + " kW" }));
  }
  const half = Math.ceil(rackShow / 2);
  for (let i = 0; i < rackShow; i++) {
    const aPanel = i < half ? rA1 : rA2;
    const bPanel = i < half ? rB1 : rB2;
    const br = "b" + ((i % half) + 1);
    EB(aPanel, br, racks[i]);
    if (twoN && bPanel) EB(bPanel, br, racks[i]);
  }

  const chiller = N("chiller", "Chiller plant", 1060, 652), cdu = N("cdu", "CDU", 1160, 652), crah = N("crah", "CRAH", 1250, 652);
  const spine = N("spine", "Spine", 1340, 652), leaf = N("leaf", "Leaf", 1430, 652);
  [chiller, cdu, crah, spine, leaf].forEach((l, i) => EB(swA, "b" + (i + 3), l));

  return g;
}

// Local mkNode (controls breaker banks/layout); mirrors sld.mkNode's node shape.
function mk(idStr: string, type: string, name: string | null, x: number, y: number, extra?: Partial<SldNode>): SldNode {
  const p = PAL[type];
  const n: SldNode = { id: idStr, type, name: name || p.label, x, y, kw: p.kw || 0, kind: p.kind, red: "2N", catalogKey: "", product: "", rating: "" };
  if (p.grp) n.grp = p.grp;
  if (p.breakered) { n.voltage = type === "rpp" ? "415/240 V" : "480 V"; n.mainAmp = type === "rpp" ? 400 : 3200; n.breakers = defaultBreakers(type); }
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
  const sz = sizePowerChain(spec);
  const t = TIERS[spec.tier] || TIERS.III;
  const ups = scheme(spec.redundancy.ups).label, gen = scheme(spec.redundancy.generation).label;
  const L: string[] = [];
  L.push("# " + spec.name);
  L.push("");
  L.push("**" + sz.facilityMW + " MW facility** · " + sz.itMW + " MW critical IT · " + sz.racks.toLocaleString() + " × " + spec.rackKW + " kW racks · " + sz.gpus.toLocaleString() + " GPUs · PUE " + spec.pue + " · " + spec.cooling + "-cooled");
  L.push("");
  L.push("## Topology");
  L.push("Utility " + spec.voltages.hv + " → two main transformers → **main-tie-main** MV switchboards (" + spec.voltages.mv + ", MV-A / MV-B + tie)" + (spec.bess ? ", with **BESS** at the interconnection (PCC)" : "") + " → unit-sub transformers (" + spec.podMW + " MVA) → **" + ups + "** UPS → LV " + spec.voltages.lv + " switchboards (SWBD-A/B) → RPP row panels → " + spec.redundancy.distribution + " dual-corded racks. Standby gensets parallel on a " + (spec.genVoltage === "MV" ? spec.voltages.mv + " bus" : spec.voltages.lv + " generator switchboard") + ".");
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
