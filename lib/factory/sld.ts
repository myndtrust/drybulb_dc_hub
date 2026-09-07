// ─────────────────────────────────────────────────────────────────────────────
// AI Factory single-line — canonical graph model + connector engine (pure).
//
// Typed promotion of the proven mockup engine (drafts/sld/engine.js). One source
// of truth for the single-line: the SldGraph plus pure operations that clone,
// validate, and return {ok, graph, reason?} without mutating their input.
//
// A single-line is a tree/DAG: sources (roots) → distribution → loads (leaves).
// Edges run from an OUTPUT port to an INPUT port; breakered cards (switchboard /
// RPP) expose one OUTPUT tap per feeder breaker (edge.fromBreaker). The React UI
// (React Flow) is only a view over this model; project.ts adapts it to the cost
// model's LocationConfig.
// ─────────────────────────────────────────────────────────────────────────────

import { RACK_SPEC_BY_KEY, type RackPower, type RackCooling, type RackSpec } from "./rack-specs.gen";

export type SldKind = "src" | "eq" | "load";
export type Port = "input" | "output";
export type BreakerStatus = "closed" | "open" | "spare";

export interface PalEntry {
  label: string;
  kw: number;
  kind: SldKind;
  grp?: "IT" | "MECH" | "NET";
  breakered?: boolean;
}

export interface Breaker {
  id: string;
  label: string;
  amp: number;
  poles: number;
  status: BreakerStatus;
}

export interface SldNode {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  kw: number;
  kind: SldKind;
  red: string;
  catalogKey: string;
  product: string;
  rating: string;
  grp?: "IT" | "MECH" | "NET";
  voltage?: string;
  mainAmp?: number;
  breakers?: Breaker[];
  /** Selected AI-rack spec key (generic rack = undefined). */
  aiRack?: string;
  /** Selected network-rack spec key (for NET racks). */
  netRack?: string;
  /** Rack power + cooling interface (copied from the rack/network spec, then editable). */
  powerIf?: RackPower;
  coolingIf?: RackCooling;
  /** Feeders on this card are sized by DIVERSITY, so Σ(feeder trips) exceeding the
   *  main is normal practice and not an over-subscription. Set on switchgear whose
   *  sourced schedule says so — a 38 kV lineup with 16 × 1200 A positions behind a
   *  2500 A bus, or the DSX-VR core board carrying UPS in/out, busways, RPPs and a
   *  load-bank breaker on a 5000 AT main. It suppresses the capacity WARNING only;
   *  `mainAmp` keeps its sourced value so the model and the inspector still carry it. */
  diversity?: boolean;
  /** Board with a dual interlocked incomer pair — the DSX-VR core-board pattern
   *  (transformer incomer / generator incomer). The model records the arrangement
   *  and checks the incomer count; the interlock itself (only one closed at a
   *  time) is not checked, because incoming breakers live on the feeding card.
   *  Checked only under `architecture: "dsx-vr"` (validateDsx) — do not reuse on
   *  a legacy graph; see `transferSource` for the architecture-agnostic version. */
  interlocked?: boolean;
  /** A TRANSFER board — e.g. a generator transfer switchboard upstream of a UPS,
   *  selecting the UPS's source between "normal" (utility/transformer-derived)
   *  and "emergency" (generator) — never both. Same shape as `interlocked`
   *  (exactly two external incomers, checked structurally) but checked in every
   *  architecture, not gated to dsx-vr: legacy `ups-chain` graphs use this one.
   *  As with `interlocked`, the exclusivity itself (only one source live) is NOT
   *  simulated via breaker state — the model records the arrangement and its
   *  incomer count only. */
  transferSource?: boolean;
}

export interface SldBus {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  kv: string;
  /** Aggregate rating (busbar/busway): the amps it can carry to its point loads. */
  ratingA?: number;
}

export interface SldEdge {
  id: string;
  from: string;
  to: string;
  fromBreaker?: string;
  /** Editable wire annotation/label (e.g. conductor size "600 A · 2×350 kcmil"). */
  size?: string;
  /** Hide this connector's label on the canvas. */
  labelHidden?: boolean;
  /** User-set wire color (hex). Falls back to the theme default when unset. */
  color?: string;
}

/** A logical group: a named tag over member node/bus ids, drawn as a labeled frame. */
export interface SldGroup {
  id: string;
  name: string;
  members: string[];
  color?: string;
}

/** Which reference architecture a graph is drawn to. Undefined = the legacy
 *  UPS-chain design, which validates under the structural rules only.
 *  `modular-pod`: a second grid-direct pattern (see validateGridDirect) — no
 *  UPS anywhere (not even a core block, unlike dsx-vr), single-corded racks,
 *  ATS backup reserved for mechanical load only. */
export type SldArchitecture = "ups-chain" | "dsx-vr" | "modular-pod";

export interface SldGraph {
  nodes: SldNode[];
  edges: SldEdge[];
  busbars: SldBus[];
  uid: number;
  groups?: SldGroup[];
  architecture?: SldArchitecture;
}

/** A self-contained, position-normalised subgraph saved to the group library. */
export interface GroupPayload {
  name: string;
  color?: string;
  nodes: SldNode[];
  busbars: SldBus[];
  edges: SldEdge[];
}

export interface OpResult {
  ok: boolean;
  graph: SldGraph;
  reason?: string;
  id?: string;
}
export interface ConnectCheck {
  ok: boolean;
  reason?: string;
}
export interface PortHit {
  id: string;
  port: Port;
  breaker?: string;
}

// ── Palette: type → {label, kw, kind, grp?, breakered?} ──────────────────────
export const PAL: Record<string, PalEntry> = {
  utility: { label: "Utility feed", kw: 0, kind: "src" },
  genset: { label: "On-site generation", kw: 0, kind: "src" },
  bess: { label: "BESS (battery energy storage)", kw: 0, kind: "src" },
  paralleling: { label: "Paralleling / ATS", kw: 0, kind: "eq" },
  rmu: { label: "RMU (ring main unit · 4-way)", kw: 0, kind: "eq", breakered: true },
  transformer: { label: "Transformer", kw: 0, kind: "eq" },
  ups: { label: "Transformer + UPS", kw: 0, kind: "eq" },
  switchboard: { label: "Switchboard", kw: 0, kind: "eq", breakered: true },
  rpp: { label: "RPP (remote power panel)", kw: 0, kind: "eq", breakered: true },
  busway: { label: "Busway (plug-in tap run)", kw: 0, kind: "eq", breakered: true },
  loadbank: { label: "Load bank (test connection)", kw: 0, kind: "load" },
  rack: { label: "AI compute rack (generic)", kw: 120, kind: "load", grp: "IT" },
  "netrack-ew": { label: "Network rack — East/West (compute fabric)", kw: 12, kind: "load", grp: "NET" },
  "netrack-ns": { label: "Network rack — North/South (front-end/storage/mgmt)", kw: 8, kind: "load", grp: "NET" },
  chiller: { label: "Chiller plant", kw: 300, kind: "load", grp: "MECH" },
  cdu: { label: "CDU", kw: 5, kind: "load", grp: "MECH" },
  crah: { label: "CRAH", kw: 40, kind: "load", grp: "MECH" },
  spine: { label: "Spine switch", kw: 8, kind: "load", grp: "NET" },
  leaf: { label: "Leaf switch", kw: 12, kind: "load", grp: "NET" },
};

// ── Geometry (kept in lock-step with the React node sizes) ───────────────────
export const EQW = 150, EQH = 52, BUSH = 10, BRKW = 26;
function loadW(n: SldNode): number { return n.grp === "IT" ? 96 : 88; }
export function isBreakered(node: { type: string } | null | undefined): boolean {
  return !!(node && PAL[node.type] && PAL[node.type].breakered);
}
export function nodeW(n: SldNode): number {
  if (n.kind === "load") return loadW(n);
  if (isBreakered(n)) return Math.max(EQW, BRKW * ((n.breakers && n.breakers.length) || 0) + 24);
  return EQW;
}
export function geo(n: SldNode) {
  const w = nodeW(n);
  return { x: n.x, y: n.y, w, h: EQH, cx: n.x + w / 2, top: n.y, bot: n.y + EQH };
}
export function busGeo(b: SldBus) {
  return { x: b.x, y: b.y, w: b.w, h: BUSH, cx: b.x + b.w / 2, top: b.y, bot: b.y + BUSH };
}

// Breaker-bank defaults per breakered type. `mainAmp` is the aggregate rating the
// over-subscription check measures served load against; omit it for gear that has
// no single limiting main.
interface BrkCfg { n: number; lab: string; amp: number; mainAmp?: number; voltage: string; }
const BRK_CFG: Record<string, BrkCfg> = {
  switchboard: { n: 8, lab: "F", amp: 800, mainAmp: 3200, voltage: "480 V" },
  rpp: { n: 4, lab: "C", amp: 100, mainAmp: 400, voltage: "415/240 V" },
  // Ring main unit: a switch, not a panel. Each way is independently rated (600 A
  // on the DSX-VR 34.5 kV skids) and the ring bus is continuous, so there is no
  // main-breaker rating to size the ways against.
  rmu: { n: 4, lab: "W", amp: 600, voltage: "34.5 kV" },
  // Only the run rating is sourced (DSX-VR core busway, 2000 A 415/240 V 3Ph-4W);
  // plug-in tap boxes vary by project, so the tap defaults are generic.
  busway: { n: 4, lab: "T", amp: 400, mainAmp: 2000, voltage: "415/240 V" },
};
function brkCfg(type: string): BrkCfg { return BRK_CFG[type] || { n: 4, lab: "F", amp: 400, mainAmp: 1000, voltage: "480 V" }; }
/** Default voltage + aggregate rating for a breakered card type — one source of
 *  truth for every builder that makes nodes (sld.mkNode and topology.mk). */
export function breakeredDefaults(type: string): { voltage: string; mainAmp?: number } {
  const c = brkCfg(type);
  return c.mainAmp != null ? { voltage: c.voltage, mainAmp: c.mainAmp } : { voltage: c.voltage };
}
export function defaultBreakers(type: string): Breaker[] {
  const c = brkCfg(type); const out: Breaker[] = [];
  for (let i = 1; i <= c.n; i++) out.push({ id: "b" + i, label: c.lab + i, amp: c.amp, poles: 3, status: "closed" });
  return out;
}

export interface Tap { breaker: string | null; x: number; y: number; }
/** Output taps: breakered → one per feeder breaker; else a single centre output; loads none. */
export function outTaps(node: SldNode): Tap[] {
  if (!node || node.kind === "load") return [];
  const g0 = geo(node);
  if (isBreakered(node) && node.breakers && node.breakers.length) {
    const n = node.breakers.length, pad = 16, span = g0.w - 2 * pad;
    return node.breakers.map((b, i) => ({ breaker: b.id, x: g0.x + pad + (n === 1 ? span / 2 : (span * i) / (n - 1)), y: g0.bot }));
  }
  return [{ breaker: null, x: g0.cx, y: g0.bot }];
}
export function tapPos(node: SldNode, breakerId?: string | null) {
  if (breakerId) { const t = outTaps(node).find((t) => t.breaker === breakerId); if (t) return { x: t.x, y: t.y }; }
  const g0 = geo(node); return { x: g0.cx, y: g0.bot };
}

// ── Lookups ───────────────────────────────────────────────────────────────────
export function findNode(g: SldGraph, id: string): SldNode | null { return g.nodes.find((n) => n.id === id) || null; }
export function findBus(g: SldGraph, id: string): SldBus | null { return g.busbars.find((b) => b.id === id) || null; }
export function ent(g: SldGraph, id: string): SldNode | SldBus | null { return findNode(g, id) || findBus(g, id); }

/** Ports by role. Sources output-only, loads input-only, equipment + buses both. */
export function ports(node: { kind?: SldKind } | null | undefined): { input: boolean; output: boolean } {
  if (!node) return { input: false, output: false };
  if (node.kind === "src") return { input: false, output: true };
  if (node.kind === "load") return { input: true, output: false };
  return { input: true, output: true };
}
export function hasOutput(g: SldGraph, id: string): boolean { const n = findNode(g, id); if (n) return ports(n).output; return !!findBus(g, id); }
export function hasInput(g: SldGraph, id: string): boolean { const n = findNode(g, id); if (n) return ports(n).input; return !!findBus(g, id); }

export function portPos(entity: SldNode | SldBus, which: Port, isBus?: boolean) {
  const gg = isBus ? busGeo(entity as SldBus) : geo(entity as SldNode);
  return { x: gg.cx, y: which === "input" ? gg.top : gg.bot };
}

// ── Pure helpers ──────────────────────────────────────────────────────────────
function clone(g: SldGraph): SldGraph { return JSON.parse(JSON.stringify(g)); }
function dist(ax: number, ay: number, bx: number, by: number): number { return Math.hypot(ax - bx, ay - by); }
function nextId(g: SldGraph, p: string): string { g.uid = (g.uid || 0) + 1; return p + g.uid; }

// ── Cycle checks ──────────────────────────────────────────────────────────────
export function wouldCycle(g: SldGraph, from: string, to: string): boolean {
  if (from === to) return true;
  const adj = new Map<string, string[]>();
  g.edges.forEach((e) => { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to); });
  const seen = new Set<string>([to]); const st = [to];
  while (st.length) { const u = st.pop()!; if (u === from) return true; for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
  return false;
}
export function hasCycleAll(g: SldGraph): boolean {
  const adj = new Map<string, string[]>();
  g.edges.forEach((e) => { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to); });
  const color = new Map<string, number>(); // 0 white 1 gray 2 black
  const dfs = (u: string): boolean => {
    color.set(u, 1);
    for (const v of adj.get(u) || []) { const c = color.get(v) || 0; if (c === 1) return true; if (c === 0 && dfs(v)) return true; }
    color.set(u, 2); return false;
  };
  for (const k of adj.keys()) if ((color.get(k) || 0) === 0 && dfs(k)) return true;
  return false;
}

// ── Connection rules ──────────────────────────────────────────────────────────
export function canConnect(g: SldGraph, fromId: string, toId: string, opts?: { fromBreaker?: string }): ConnectCheck {
  if (fromId === toId) return { ok: false, reason: "can't connect a card to itself" };
  if (!ent(g, fromId)) return { ok: false, reason: "source endpoint missing" };
  if (!ent(g, toId)) return { ok: false, reason: "target endpoint missing" };
  if (!hasOutput(g, fromId)) return { ok: false, reason: "source has no output port" };
  if (!hasInput(g, toId)) return { ok: false, reason: "target has no input port" };
  const fb = (opts && opts.fromBreaker) || undefined;
  // A load may have MANY feeders (e.g. GB300 = 8 whips). Only the SAME circuit —
  // same source + target + breaker/whip — is a duplicate.
  if (g.edges.some((e) => e.from === fromId && e.to === toId && (e.fromBreaker || undefined) === fb)) return { ok: false, reason: "already connected on this circuit" };
  if (g.edges.some((e) => e.from === toId && e.to === fromId)) return { ok: false, reason: "reverse connection exists" };
  if (wouldCycle(g, fromId, toId)) return { ok: false, reason: "would create a loop (single-line must be acyclic)" };
  if (fb) {
    const fn = findNode(g, fromId);
    if (!fn || !isBreakered(fn) || !(fn.breakers || []).some((b) => b.id === fb)) return { ok: false, reason: "breaker not found on source" };
    if (g.edges.some((e) => e.from === fromId && e.fromBreaker === fb)) return { ok: false, reason: "breaker already feeds a circuit" };
  }
  return { ok: true };
}

// ── Operations (pure: return {ok, graph, reason?}) ───────────────────────────
export function addEdge(g: SldGraph, fromId: string, toId: string, opts?: { fromBreaker?: string }): OpResult {
  const r = canConnect(g, fromId, toId, opts);
  if (!r.ok) return { ok: false, graph: g, reason: r.reason };
  const ng = clone(g);
  const edge: SldEdge = { id: nextId(ng, "e"), from: fromId, to: toId };
  if (opts && opts.fromBreaker) edge.fromBreaker = opts.fromBreaker;
  ng.edges.push(edge);
  return { ok: true, graph: ng };
}

export function removeEdge(g: SldGraph, edgeId: string): OpResult {
  if (!g.edges.some((e) => e.id === edgeId)) return { ok: false, graph: g, reason: "connector not found" };
  const ng = clone(g);
  ng.edges = ng.edges.filter((e) => e.id !== edgeId);
  return { ok: true, graph: ng };
}

/** Re-route one endpoint of an edge. 'from' onto a breakered card binds opts.fromBreaker. */
export function moveEdge(g: SldGraph, edgeId: string, end: "from" | "to", newId: string, opts?: { fromBreaker?: string }): OpResult {
  const e = g.edges.find((x) => x.id === edgeId);
  if (!e) return { ok: false, graph: g, reason: "connector not found" };
  const from = end === "from" ? newId : e.from;
  const to = end === "to" ? newId : e.to;
  let fromBreaker = e.fromBreaker;
  if (end === "from") { const fn = findNode(g, newId); fromBreaker = fn && isBreakered(fn) && opts && opts.fromBreaker ? opts.fromBreaker : undefined; }
  const without = clone(g);
  without.edges = without.edges.filter((x) => x.id !== edgeId);
  const r = canConnect(without, from, to, fromBreaker ? { fromBreaker } : undefined);
  if (!r.ok) return { ok: false, graph: g, reason: r.reason };
  const ng = clone(g);
  const te = ng.edges.find((x) => x.id === edgeId)!;
  te.from = from; te.to = to;
  if (fromBreaker) te.fromBreaker = fromBreaker; else delete te.fromBreaker;
  return { ok: true, graph: ng };
}

/** Build a node, omitting undefined keys so it survives a JSON round-trip cleanly. */
export function mkNode(idStr: string, type: string, name: string | null, x: number, y: number, extra?: Partial<SldNode>): SldNode {
  const p = PAL[type];
  const n: SldNode = { id: idStr, type, name: name || p.label, x, y, kw: p.kw || 0, kind: p.kind, red: "2N", catalogKey: "", product: "", rating: "" };
  if (p.grp) n.grp = p.grp;
  if (p.breakered) { const c = brkCfg(type); n.voltage = c.voltage; if (c.mainAmp != null) n.mainAmp = c.mainAmp; n.breakers = defaultBreakers(type); }
  return Object.assign(n, extra || {});
}

export function addNode(g: SldGraph, type: string, x: number, y: number, extra?: Partial<SldNode>): OpResult {
  if (!PAL[type]) return { ok: false, graph: g, reason: "unknown type " + type };
  const ng = clone(g);
  const n = mkNode(nextId(ng, "n"), type, null, x, y, extra);
  ng.nodes.push(n);
  return { ok: true, graph: ng, id: n.id };
}

/** A spec applicable to a rack node — both AI racks and network racks share this. */
export type SpecLike = { key: string; label: string; power: RackPower; cooling: RackCooling };

/** Specialise a generic rack from a full spec object (built-in OR custom; AI OR
 *  network rack): set kW + power/cooling interface, and auto-size its feeding
 *  circuit (each feeder breaker = one whip's circuit amps; edge conductor size). */
export function applyRackSpecObj(g: SldGraph, nodeId: string, spec: SpecLike): OpResult {
  const node = findNode(g, nodeId);
  if (!node || node.kind !== "load" || (node.grp !== "IT" && node.grp !== "NET")) return { ok: false, graph: g, reason: "select a compute or network rack first" };
  const ng = clone(g);
  const n = findNode(ng, nodeId)!;
  if (n.grp === "IT") n.aiRack = spec.key; else n.netRack = spec.key;
  n.kw = spec.power.rack_kw;
  n.powerIf = { ...spec.power };
  n.coolingIf = { ...spec.cooling };
  n.rating = `${spec.label}`;
  // each feeder of this rack is one whip; size its breaker to the per-whip amps.
  for (const e of ng.edges) {
    if (e.to !== nodeId) continue;
    e.size = spec.power.circuit_size;
    if (e.fromBreaker) {
      const b = findNode(ng, e.from)?.breakers?.find((x) => x.id === e.fromBreaker);
      if (b) b.amp = spec.power.circuit_amps;
    }
  }
  return { ok: true, graph: ng };
}

/** Apply a built-in AI-rack spec by key (convenience over `applyRackSpecObj`). */
export function applyRackSpec(g: SldGraph, nodeId: string, specKey: string): OpResult {
  const spec = RACK_SPEC_BY_KEY[specKey];
  if (!spec) return { ok: false, graph: g, reason: "unknown rack spec " + specKey };
  return applyRackSpecObj(g, nodeId, spec);
}

// ── Distribution capacity (RPP / busway / busbar serve the same point loads) ──
/** A load's per-whip circuit demand (amps) from its interface, else from kW. */
function loadSideAmps(n: SldNode): number {
  if (n.powerIf) return n.powerIf.circuit_amps;
  const v = 415;
  return n.kw > 0 ? Math.ceil((n.kw * 1000) / (Math.sqrt(3) * v)) : 0;
}
/** Aggregate rating (amps) of a distribution element: a breakered node's main
 *  breaker, or a busbar/busway's `ratingA`. */
export function aggregateRatingA(g: SldGraph, id: string): number | undefined {
  const n = findNode(g, id);
  if (n) return isBreakered(n) ? n.mainAmp : undefined;
  return findBus(g, id)?.ratingA;
}
/** A test connection carries no service load: a load bank is energised only with
 *  the board otherwise unloaded, so counting its breaker would over-subscribe every
 *  board that has one (the DSX-VR core board's load-bank breaker equals its main). */
function isTestConnection(n: SldNode | null): boolean { return n?.type === "loadbank"; }
/** Amps an element serves: a breakered node = Σ of its USED feeder breakers; a
 *  busbar/busway = Σ of the per-side demand of the loads it feeds. */
export function servedAmps(g: SldGraph, id: string): number {
  const n = findNode(g, id);
  if (n && isBreakered(n)) {
    let a = 0;
    for (const b of n.breakers || []) {
      const fed = g.edges.find((e) => e.from === id && e.fromBreaker === b.id);
      if (fed && !isTestConnection(findNode(g, fed.to))) a += b.amp || 0;
    }
    return a;
  }
  let a = 0;
  for (const e of g.edges) { if (e.from !== id) continue; const to = findNode(g, e.to); if (to && to.kind === "load" && !isTestConnection(to)) a += loadSideAmps(to); }
  return a;
}

/** Add a busbar — any element can tap onto it (in or out). */
export function addBus(g: SldGraph, x: number, y: number, name?: string): OpResult {
  const ng = clone(g);
  ng.busbars.push({ id: nextId(ng, "n"), name: name || "BUS", x, y, w: 420, kv: "480 V" });
  return { ok: true, graph: ng, id: "n" + ng.uid };
}

/** Copy any element (card or busbar) as a fresh, unconnected instance offset from
 *  the original (keeps all properties incl. breakers / power+cooling interface). */
export function duplicateNode(g: SldGraph, id: string): OpResult {
  const ng = clone(g);
  const src = findNode(ng, id);
  if (src) {
    const copy: SldNode = JSON.parse(JSON.stringify(src));
    copy.id = nextId(ng, "n"); copy.x = src.x + 36; copy.y = src.y + 28; copy.name = `${src.name} copy`;
    ng.nodes.push(copy);
    return { ok: true, graph: ng, id: copy.id };
  }
  const bus = findBus(ng, id);
  if (bus) {
    const copy: SldBus = JSON.parse(JSON.stringify(bus));
    copy.id = nextId(ng, "n"); copy.x = bus.x + 36; copy.y = bus.y + 28; copy.name = `${bus.name} copy`;
    ng.busbars.push(copy);
    return { ok: true, graph: ng, id: copy.id };
  }
  return { ok: false, graph: g, reason: "nothing to duplicate" };
}

export function removeNode(g: SldGraph, id: string): OpResult {
  if (!ent(g, id)) return { ok: false, graph: g, reason: "card not found" };
  const ng = clone(g);
  ng.nodes = ng.nodes.filter((n) => n.id !== id);
  ng.busbars = ng.busbars.filter((b) => b.id !== id);
  ng.edges = ng.edges.filter((e) => e.from !== id && e.to !== id);
  if (ng.groups) ng.groups = ng.groups.map((gr) => ({ ...gr, members: gr.members.filter((m) => m !== id) })).filter((gr) => gr.members.length > 0);
  return { ok: true, graph: ng };
}

// ── Groups (logical: a named tag over members, drawn as a labeled frame) ──────
export function createGroup(g: SldGraph, memberIds: string[], name?: string): OpResult {
  const ids = memberIds.filter((id) => ent(g, id));
  if (!ids.length) return { ok: false, graph: g, reason: "select elements to group" };
  const ng = clone(g);
  const id = nextId(ng, "g");
  (ng.groups || (ng.groups = [])).push({ id, name: name || "Group", members: ids });
  return { ok: true, graph: ng, id };
}
export function removeGroup(g: SldGraph, groupId: string): OpResult {
  const ng = clone(g);
  ng.groups = (ng.groups || []).filter((gr) => gr.id !== groupId);
  return { ok: true, graph: ng };
}
export function renameGroup(g: SldGraph, groupId: string, name: string): OpResult {
  const ng = clone(g); const gr = (ng.groups || []).find((x) => x.id === groupId);
  if (!gr) return { ok: false, graph: g, reason: "group not found" };
  gr.name = name; return { ok: true, graph: ng };
}
export function setGroupColor(g: SldGraph, groupId: string, color: string): OpResult {
  const ng = clone(g); const gr = (ng.groups || []).find((x) => x.id === groupId);
  if (!gr) return { ok: false, graph: g, reason: "group not found" };
  gr.color = color; return { ok: true, graph: ng };
}
export function moveGroup(g: SldGraph, groupId: string, dx: number, dy: number): OpResult {
  const ng = clone(g); const gr = (ng.groups || []).find((x) => x.id === groupId);
  if (!gr) return { ok: false, graph: g, reason: "group not found" };
  for (const id of gr.members) { const n = findNode(ng, id); if (n) { n.x += dx; n.y += dy; continue; } const b = findBus(ng, id); if (b) { b.x += dx; b.y += dy; } }
  return { ok: true, graph: ng };
}
export function groupOfNode(g: SldGraph, id: string): SldGroup | undefined {
  return (g.groups || []).find((gr) => gr.members.includes(id));
}
/** Bounding box of a group's members (+ padding + a top label band). */
export function groupBounds(g: SldGraph, group: SldGroup): { x: number; y: number; w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of group.members) {
    const n = findNode(g, id); if (n) { const gg = geo(n); minX = Math.min(minX, gg.x); minY = Math.min(minY, gg.top); maxX = Math.max(maxX, gg.x + gg.w); maxY = Math.max(maxY, gg.bot); continue; }
    const b = findBus(g, id); if (b) { const bg = busGeo(b); minX = Math.min(minX, bg.x); minY = Math.min(minY, bg.top); maxX = Math.max(maxX, bg.x + bg.w); maxY = Math.max(maxY, bg.bot); }
  }
  if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = 16, label = 16;
  return { x: minX - pad, y: minY - pad - label, w: (maxX - minX) + pad * 2, h: (maxY - minY) + pad * 2 + label };
}

/** Extract a group as a position-normalised, self-contained subgraph (members +
 *  only the edges whose both endpoints are members). */
export function extractGroup(g: SldGraph, groupId: string): GroupPayload | null {
  const gr = (g.groups || []).find((x) => x.id === groupId); if (!gr) return null;
  const mset = new Set(gr.members);
  const b = groupBounds(g, gr);
  const nodes = g.nodes.filter((n) => mset.has(n.id)).map((n) => ({ ...JSON.parse(JSON.stringify(n)), x: n.x - b.x, y: n.y - b.y }));
  const busbars = g.busbars.filter((bb) => mset.has(bb.id)).map((bb) => ({ ...JSON.parse(JSON.stringify(bb)), x: bb.x - b.x, y: bb.y - b.y }));
  const edges = g.edges.filter((e) => mset.has(e.from) && mset.has(e.to)).map((e) => JSON.parse(JSON.stringify(e)) as SldEdge);
  return { name: gr.name, color: gr.color, nodes, busbars, edges };
}

/** Instantiate a saved group payload as a fresh copy (new ids, offset) + a new group. */
export function instantiateGroup(g: SldGraph, payload: GroupPayload, at?: { x: number; y: number }): OpResult {
  const ng = clone(g);
  const ox = at?.x ?? 240, oy = at?.y ?? 220;
  const idmap = new Map<string, string>();
  const members: string[] = [];
  for (const n of payload.nodes) { const nid = nextId(ng, "n"); idmap.set(n.id, nid); ng.nodes.push({ ...JSON.parse(JSON.stringify(n)), id: nid, x: n.x + ox, y: n.y + oy }); members.push(nid); }
  for (const b of payload.busbars) { const nid = nextId(ng, "n"); idmap.set(b.id, nid); ng.busbars.push({ ...JSON.parse(JSON.stringify(b)), id: nid, x: b.x + ox, y: b.y + oy }); members.push(nid); }
  for (const e of payload.edges) { const from = idmap.get(e.from), to = idmap.get(e.to); if (!from || !to) continue; ng.edges.push({ ...JSON.parse(JSON.stringify(e)), id: nextId(ng, "e"), from, to }); }
  const gid = nextId(ng, "g");
  (ng.groups || (ng.groups = [])).push({ id: gid, name: payload.name, color: payload.color, members });
  return { ok: true, graph: ng, id: gid };
}

/** Duplicate a whole group on the canvas: clone its members + edges as a new group, offset. */
export function duplicateGroup(g: SldGraph, groupId: string): OpResult {
  const payload = extractGroup(g, groupId);
  const gr = (g.groups || []).find((x) => x.id === groupId);
  if (!payload || !gr) return { ok: false, graph: g, reason: "group not found" };
  const b = groupBounds(g, gr);
  return instantiateGroup(g, { ...payload, name: `${payload.name} copy` }, { x: b.x + 40, y: b.y + 40 });
}

// ── Breaker CRUD (pure) ───────────────────────────────────────────────────────
export function addBreaker(g: SldGraph, nodeId: string): OpResult {
  const n = findNode(g, nodeId); if (!n || !isBreakered(n)) return { ok: false, graph: g, reason: "not a breakered card" };
  const ng = clone(g); const nn = findNode(ng, nodeId)!;
  const list = nn.breakers || (nn.breakers = []);
  const nums = list.map((b) => parseInt(String(b.id).replace(/\D/g, ""), 10) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const c = brkCfg(nn.type);
  list.push({ id: "b" + next, label: c.lab + next, amp: c.amp, poles: 3, status: "closed" });
  return { ok: true, graph: ng, id: "b" + next };
}
export function removeBreaker(g: SldGraph, nodeId: string, brId: string): OpResult {
  const n = findNode(g, nodeId); if (!n || !isBreakered(n)) return { ok: false, graph: g, reason: "not a breakered card" };
  if (!(n.breakers || []).some((b) => b.id === brId)) return { ok: false, graph: g, reason: "breaker not found" };
  const ng = clone(g); const nn = findNode(ng, nodeId)!;
  nn.breakers = (nn.breakers || []).filter((b) => b.id !== brId);
  ng.edges = ng.edges.filter((e) => !(e.from === nodeId && e.fromBreaker === brId)); // cascade
  return { ok: true, graph: ng };
}
export function setBreaker(g: SldGraph, nodeId: string, brId: string, key: keyof Breaker, val: string | number): OpResult {
  const n = findNode(g, nodeId); if (!n || !isBreakered(n)) return { ok: false, graph: g, reason: "not a breakered card" };
  const ng = clone(g); const b = (findNode(ng, nodeId)!.breakers || []).find((b) => b.id === brId);
  if (!b) return { ok: false, graph: g, reason: "breaker not found" };
  (b as unknown as Record<string, unknown>)[key] = val;
  return { ok: true, graph: ng };
}

// ── DSX-VR architecture invariants ────────────────────────────────────────────
// The graph-checkable rules from docs/ai-factory/dsx-vr-architecture.md §5 (the
// distilled Siemens DSX Vera Rubin reference design). These apply ONLY to graphs
// tagged `architecture: "dsx-vr"` — a legacy UPS-chain design is a different, and
// still valid, topology, so it keeps validating under the structural rules alone.

/** Nominal (line-line) volts from a label like "38 kV", "415/240 V", "2.4/4.16 kV".
 *  Only number groups carrying a voltage unit count, so an annotated label such as
 *  "34.5 kV, 40 kA" or "480 V · 3200 A" reads as a voltage and not as its ampacity.
 *  Within one group ("2.4/4.16 kV") the values are a line-neutral/line-line pair,
 *  so the larger is nominal. */
export function nominalVolts(label?: string | null): number | null {
  if (!label) return null;
  let best: number | null = null;
  for (const m of label.matchAll(/(\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*)\s*(kv|v)\b/gi)) {
    const group = Math.max(...m[1].split("/").map((s) => parseFloat(s)));
    const volts = group * (m[2].toLowerCase() === "kv" ? 1000 : 1);
    best = best == null ? volts : Math.max(best, volts);
  }
  return best;
}

/** Voltage of a card or a busbar, in volts. */
export function voltageOf(g: SldGraph, id: string): number | null {
  const n = findNode(g, id);
  if (n) return nominalVolts(n.voltage);
  const b = findBus(g, id);
  return b ? nominalVolts(b.kv) : null;
}

/** §4 voltage discipline: the levels the reference design uses inside the fence.
 *  2400 is the line-neutral half of the 2.4/4.16 kV chiller system, accepted so a
 *  board labelled only "2.4 kV" is not reported as off-standard. The utility
 *  primary is deliberately absent — E5.0.1 leaves site utility ratings to
 *  project-specific analysis, and §4's table starts at the 38 kV lineup. */
const DSX_VOLTS = new Set([38000, 34500, 13800, 4160, 2400, 480, 415]);
const DSX_VOLTS_LABEL = "38 kV / 34.5 kV / 13.8 kV / 2.4-4.16 kV / 480 V / 415/240 V";
/** Site MV distribution level. 4.16 kV is a chiller utilization voltage, not a
 *  distribution level, so a DU chiller board must not satisfy an "at MV" test. */
const MV_SITE_MIN_V = 13800;
/** The level generation may connect at. §1 puts BOTH sourced blocks on the 38 kV
 *  substation — the 15 MVA backup block on the tie (through XFO-BU-Gen) and the
 *  optional 75 MVA on-site block at a lineup end. The 34.5 kV rings deliberately do
 *  NOT qualify: a ring is the compute path, and §5 invariant 3 allows generation
 *  only at a core board or the tie. Testing "is it MV?" would clear a genset teed
 *  straight onto a ring, which is exactly what the rule exists to stop. */
const GEN_SOURCE_MIN_V = 38000;
/** Equipment that must never appear on the compute path (§5.1). */
const NOT_ON_COMPUTE = new Set(["ups", "genset", "paralleling"]);

export function validateDsx(g: SldGraph): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nameOf = (id: string) => ent(g, id)?.name ?? id;

  // Two adjacency views. `all` is topology; `live` drops edges through an open
  // breaker, because an open breaker carries no power and so does not put what
  // lies beyond it on the path. The tie breakers and a ring's normal open point
  // are both normally open — that is what keeps the backup-generation block off
  // the compute path no matter which direction the bidirectional tie is drawn.
  const isOpen = (e: SldEdge) => (findNode(g, e.from)?.breakers || []).some((b) => b.id === e.fromBreaker && b.status === "open");
  const all = new Map<string, string[]>();
  const live = new Map<string, string[]>();
  const link = (m: Map<string, string[]>, e: SldEdge) => { if (!m.has(e.from)) m.set(e.from, []); m.get(e.from)!.push(e.to); };
  for (const e of g.edges) { link(all, e); if (!isOpen(e)) link(live, e); }
  const walk = (adj: Map<string, string[]>, roots: string[]): Set<string> => {
    const seen = new Set<string>(); const st = [...roots];
    while (st.length) { const u = st.pop()!; for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
    return seen;
  };

  // Grid-direct compute vs core IT. A dual interlocked incomer pair is the
  // signature of the core block and of nothing else in this design (§3), so it is
  // what separates the two — `grp: "IT"` cannot, because a core-IT rack is IT too
  // and is legitimately UPS-backed. A load counts as core only when EVERY path
  // feeding it passes through a core board; if any path from a source reaches it
  // without crossing one, it is grid-direct and §5.1 governs it. Asking the
  // simpler question — "is it downstream of a core board?" — would let a single
  // stray wire out of the core block reclassify a GPU rack and exempt it.
  const coreBoards = new Set(g.nodes.filter((n) => n.interlocked).map((n) => n.id));
  const gridDirect = new Set<string>();
  const roots = g.nodes.filter((n) => n.kind === "src").map((n) => n.id);
  while (roots.length) {
    const u = roots.pop()!;
    for (const v of all.get(u) || []) {
      if (coreBoards.has(v) || gridDirect.has(v)) continue;
      gridDirect.add(v); roots.push(v);
    }
  }
  const computeLoads = new Set(
    g.nodes.filter((n) => n.kind === "load" && n.grp === "IT" && gridDirect.has(n.id)).map((n) => n.id),
  );

  /** The voltage a connection lands on, looking through equipment that carries no
   *  voltage tag of its own. The BESS and backup-generation blocks connect through
   *  a step-up (XFO-BESS-Core, XFO-BU-Gen), so the level that matters is the board
   *  one hop past the transformer. Null means "not tagged anywhere downstream" —
   *  unknown, which the rules below treat as unproven rather than as a violation. */
  const landingVolts = (id: string, depth = 3): number | null => {
    const v = voltageOf(g, id);
    if (v != null) return v;
    if (depth <= 0) return null;
    for (const to of all.get(id) || []) { const dv = landingVolts(to, depth - 1); if (dv != null) return dv; }
    return null;
  };

  // §5.1 — compute is grid-direct: utility → lineup → ring → RMU → MVT → MSB-GPU
  // → RPP → rack, with no UPS, generator or ATS anywhere on that path. This is
  // what makes the 1.2–1.5 PUE band and the curtailable-load strategy possible.
  //
  // Checked per connection, because what the rule forbids is a backup device
  // INTERPOSED in the path, not a source at the head of it. Generation landing at
  // site MV — the 15 MVA backup block on the tie, or the optional 75 MVA on-site
  // base-generation block at a lineup (§1, notes 2 & 3) — is a source: it feeds the
  // whole site, compute included, and the reference design draws it that way. §5.3
  // governs where it may land. A genset on an LV board still fires here.
  for (const n of g.nodes) {
    if (!NOT_ON_COMPUTE.has(n.type)) continue;
    for (const e of g.edges) {
      if (e.from !== n.id || isOpen(e)) continue;
      if (n.type === "genset" && (landingVolts(e.to) ?? 0) >= GEN_SOURCE_MIN_V) continue;
      const hit = [e.to, ...walk(live, [e.to])].find((id) => computeLoads.has(id));
      if (hit) {
        errors.push(`${n.name} feeds compute load ${nameOf(hit)} — DSX-VR compute is grid-direct (no UPS, generator or ATS on the compute path)`);
        break;
      }
    }
  }

  // §5.2 — every 34.5 kV ring is dual-ended: it leaves an A-lineup feeder,
  // daisy-chains the same RMU position across the DUs, and lands on a B-lineup
  // feeder, with a normally-open point so the operating state stays radial.
  const rmuIds = new Set(g.nodes.filter((n) => n.type === "rmu").map((n) => n.id));
  const chain = new Map<string, number>();
  let chains = 0;
  for (const id of rmuIds) {
    if (chain.has(id)) continue;
    const c = chains++; const st = [id];
    while (st.length) {
      const u = st.pop()!; if (chain.has(u)) continue; chain.set(u, c);
      for (const e of g.edges) {
        if (e.from === u && rmuIds.has(e.to) && !chain.has(e.to)) st.push(e.to);
        if (e.to === u && rmuIds.has(e.from) && !chain.has(e.from)) st.push(e.from);
      }
    }
  }
  for (let c = 0; c < chains; c++) {
    const members = [...chain].filter(([, k]) => k === c).map(([id]) => id);
    const mset = new Set(members);
    const label = members.map(nameOf).join(" → ");
    const ends = new Set(g.edges.filter((e) => mset.has(e.to) && !rmuIds.has(e.from)).map((e) => e.from));
    if (ends.size < 2) {
      errors.push(`ring ${label}: fed from ${ends.size} source${ends.size === 1 ? "" : "s"} — a DSX-VR ring must be dual-ended, landing on a feeder at each end`);
    } else if (!g.edges.filter((e) => mset.has(e.to)).some(isOpen)) {
      // A closed 34.5 kV loop parallels two sources: fault duty and coordination
      // both change, so §5.2 states the open point as part of the invariant.
      errors.push(`ring ${label}: no normally-open point — a dual-ended ring must operate radially`);
    }
  }

  // §5.3 — the only UPS in the design sit on the interlocked 415 V core-IT boards,
  // and generators appear only as the interlocked second incomer of a core board
  // or as the MV backup block at the tie. Testing the board's *voltage* alone is
  // not enough: a DU MSB-SUPP is 415/240 V too, and a DU MSB-CHILLERS is at MV.
  // §2's defining rule is that a DU contains no UPS, generator or ATS at all.
  for (const n of g.nodes) {
    if (n.type === "ups") {
      for (const e of g.edges.filter((x) => x.to === n.id)) {
        const src = findNode(g, e.from);
        if (src?.interlocked && voltageOf(g, e.from) === 415) continue;
        errors.push(`${n.name} is fed from ${nameOf(e.from)} — the only DSX-VR UPS sit on the interlocked 415 V core-IT boards (a deployment unit carries none)`);
      }
    }
    if (n.type === "genset") {
      for (const e of g.edges.filter((x) => x.from === n.id)) {
        if (findNode(g, e.to)?.interlocked) continue;
        const v = landingVolts(e.to);
        if (v == null || v >= GEN_SOURCE_MIN_V) continue;
        errors.push(`${n.name} → ${nameOf(e.to)}: a DSX-VR generator must land on an interlocked core board, or on the 38 kV substation (tie or lineup) — never on a ring or inside a deployment unit`);
      }
    }
    // §5.6 — BESS connects at a dedicated MV feeder, never behind a DU transformer.
    if (n.type === "bess") {
      for (const e of g.edges.filter((x) => x.from === n.id)) {
        const v = landingVolts(e.to);
        if (v == null || v >= MV_SITE_MIN_V) continue;
        errors.push(`${n.name} → ${nameOf(e.to)}: BESS connects at a dedicated MV feeder, never behind a DU transformer`);
      }
    }
  }

  // §5.4 — voltage discipline, over the levels §4 governs.
  for (const n of g.nodes) {
    if (!n.voltage || n.type === "utility") continue;
    if (!DSX_VOLTS.has(nominalVolts(n.voltage) ?? -1)) errors.push(`${n.name}: ${n.voltage} is outside the DSX-VR voltage discipline (${DSX_VOLTS_LABEL})`);
  }
  for (const b of g.busbars) {
    if (!b.kv) continue;
    if (!DSX_VOLTS.has(nominalVolts(b.kv) ?? -1)) errors.push(`${b.name}: ${b.kv} is outside the DSX-VR voltage discipline (${DSX_VOLTS_LABEL})`);
  }

  // A ring main unit has a fixed number of ways (4 on the DSX-VR skids): ring-in +
  // ring-out + the transformer tee-offs must all fit the switch. The incoming
  // connection occupies a way even though the model gives it a separate port.
  for (const n of g.nodes) {
    if (n.type !== "rmu") continue;
    const ways = (n.breakers || []).length;
    if (!ways) continue;
    const incomers = g.edges.filter((e) => e.to === n.id).length;
    const teeOffs = (n.breakers || []).filter((b) => g.edges.some((e) => e.from === n.id && e.fromBreaker === b.id)).length;
    if (incomers + teeOffs > ways) errors.push(`${n.name}: ${incomers + teeOffs} circuits on a ${ways}-way ring main unit — ring-in, ring-out and tee-offs must fit the switch`);
  }

  // Core boards are dual-fed through a mechanical interlock (transformer incomer /
  // generator incomer). Only *external* incomers count: the sourced board also has
  // a dedicated output breaker per UPS, so a return path must not read as a third
  // source. (The DAG cannot draw that return today — see the M2 status note.)
  for (const n of g.nodes) {
    if (!n.interlocked) continue;
    const fed = walk(all, [n.id]);
    const incomers = g.edges.filter((e) => e.to === n.id && !fed.has(e.from)).length;
    if (incomers !== 2) errors.push(`${n.name}: interlocked board has ${incomers} incomer${incomers === 1 ? "" : "s"} — the DSX-VR core pattern is exactly two (transformer / generator)`);
  }

  return { errors, warnings };
}

/** The `modular-pod` half of the architecture-specific rules — a second
 *  grid-direct pattern generalized from field observation of large modular
 *  GPU-cluster builds (see lib/factory/grid-direct-topology.ts), distinct from
 *  DSX-VR in one respect that matters: there is no UPS ANYWHERE in this design,
 *  not even a single core block, and racks are single-corded rather than
 *  dual-fed. Redundancy lives at the row/pod level (switchboard A vs B), and the
 *  only backed-up load is mechanical. */
export function validateGridDirect(g: SldGraph): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];

  // Rule 1 — no UPS anywhere. This is the defining difference from dsx-vr, which
  // still UPS-backs its one core block.
  for (const n of g.nodes) {
    if (n.type === "ups") errors.push(`${n.name}: a UPS has no place in the modular-pod pattern — compute is grid-direct end to end, with no exception for a core block`);
  }

  // Rule 2 — an ATS/transfer switch (type "paralleling") exists here only to
  // back up mechanical load. If it can reach anything else — directly or through
  // whatever it feeds — that is the UPS-chain's generator-backup pattern
  // leaking into a design that deliberately does not have one.
  const adj = new Map<string, string[]>();
  for (const e of g.edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to); }
  const reach = (root: string): Set<string> => {
    const seen = new Set<string>(); const st = [root];
    while (st.length) { const u = st.pop()!; for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
    return seen;
  };
  for (const n of g.nodes) {
    if (n.type !== "paralleling") continue;
    for (const id of reach(n.id)) {
      const t = findNode(g, id);
      if (t && t.kind === "load" && t.grp !== "MECH") errors.push(`${n.name}: an ATS/transfer switch feeds ${t.name}, a non-mechanical load — this pattern reserves transfer-switch backup for mechanical (chiller) load only`);
    }
  }

  // Rule 3 — compute/network load is single-corded: exactly one feeder. A
  // second feeder would silently smuggle in 2N-to-rack, the pattern this
  // architecture deliberately replaces with row/pod-level (A vs B) redundancy.
  for (const n of g.nodes) {
    if (n.kind !== "load" || (n.grp !== "IT" && n.grp !== "NET")) continue;
    const incomers = g.edges.filter((e) => e.to === n.id).length;
    if (incomers !== 1) errors.push(`${n.name}: ${incomers} feeders — compute/network load in the modular-pod pattern is single-corded (row-level A/B redundancy, not 2N-to-rack)`);
  }

  return { errors, warnings: [] };
}

// ── Invariant checker ─────────────────────────────────────────────────────────
export interface ValidateResult { ok: boolean; errors: string[]; warnings: string[]; }
export function validate(g: SldGraph): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(g.nodes.map((n) => n.id).concat(g.busbars.map((b) => b.id)));
  const seenPair = new Set<string>();
  const seenBreaker = new Set<string>();
  for (const e of g.edges) {
    if (!ids.has(e.from)) errors.push(`edge ${e.id}: from ${e.from} missing`);
    if (!ids.has(e.to)) errors.push(`edge ${e.id}: to ${e.to} missing`);
    if (e.from === e.to) errors.push(`edge ${e.id}: self-loop`);
    const key = e.from + ">" + e.to + ">" + (e.fromBreaker || "");
    if (seenPair.has(key)) errors.push(`duplicate edge ${e.from}->${e.to}${e.fromBreaker ? " (" + e.fromBreaker + ")" : ""}`);
    seenPair.add(key);
    if (ids.has(e.from) && !hasOutput(g, e.from)) errors.push(`edge ${e.id}: ${e.from} has no output port`);
    if (ids.has(e.to) && !hasInput(g, e.to)) errors.push(`edge ${e.id}: ${e.to} has no input port`);
    if (e.fromBreaker) {
      const fn = findNode(g, e.from);
      if (!fn || !isBreakered(fn) || !(fn.breakers || []).some((b) => b.id === e.fromBreaker)) errors.push(`edge ${e.id}: breaker ${e.fromBreaker} missing on ${e.from}`);
      const fk = e.from + "/" + e.fromBreaker;
      if (seenBreaker.has(fk)) errors.push(`breaker ${e.fromBreaker} on ${e.from} feeds >1 circuit`);
      seenBreaker.add(fk);
    }
  }
  if (hasCycleAll(g)) errors.push("cycle detected (single-line must be acyclic)");
  for (const n of g.nodes) {
    if (n.kind === "load" && !g.edges.some((e) => e.to === n.id)) errors.push(`load ${n.id} (${n.name}) has no feeder`);
    if (n.kind === "src" && g.edges.some((e) => e.to === n.id)) errors.push(`source ${n.id} (${n.name}) must not have a feeder`);
  }
  // over-subscription: any RPP / switchboard / busway / busbar whose served point-load
  // amps exceed its aggregate rating (a non-blocking design warning).
  const distIds = g.nodes.filter((n) => isBreakered(n)).map((n) => n.id).concat(g.busbars.map((b) => b.id));
  for (const id of distIds) {
    if (findNode(g, id)?.diversity) continue; // feeders sized by diversity, not by sum
    const rating = aggregateRatingA(g, id);
    if (rating == null || rating <= 0) continue;
    const served = servedAmps(g, id);
    if (served > rating + 1e-6) warnings.push(`${ent(g, id)?.name ?? id} over-subscribed: served ${Math.round(served)} A > rating ${rating} A`);
  }
  // required power connectors: a specced rack must have all its whip feeds wired
  for (const n of g.nodes) {
    if (n.kind === "load" && n.powerIf && n.powerIf.feeds > 0) {
      const feeders = g.edges.filter((e) => e.to === n.id).length;
      if (feeders < n.powerIf.feeds) warnings.push(`${n.name}: ${n.powerIf.feeds - feeders} of ${n.powerIf.feeds} power connectors missing`);
    }
  }
  // transferSource: a generator-transfer board (normal source / emergency
  // generator, never both) must have exactly two EXTERNAL incomers — same shape
  // as DSX-VR's `interlocked` core-board check, but universal (every
  // architecture, not gated to dsx-vr) since this is the legacy ups-chain
  // generator's own pattern. "External" excludes anything downstream of the
  // board itself, matching the interlocked check's own return-path tolerance.
  if (g.nodes.some((n) => n.transferSource)) {
    const adjAll = new Map<string, string[]>();
    for (const e of g.edges) { if (!adjAll.has(e.from)) adjAll.set(e.from, []); adjAll.get(e.from)!.push(e.to); }
    const feedsOf = (root: string): Set<string> => {
      const seen = new Set<string>(); const st = [root];
      while (st.length) { const u = st.pop()!; for (const v of adjAll.get(u) || []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
      return seen;
    };
    for (const n of g.nodes) {
      if (!n.transferSource) continue;
      const fed = feedsOf(n.id);
      const incomers = g.edges.filter((e) => e.to === n.id && !fed.has(e.from)).length;
      if (incomers !== 2) errors.push(`${n.name}: transfer board has ${incomers} incomer${incomers === 1 ? "" : "s"} — a transfer selects between exactly two sources (normal / emergency)`);
    }
  }
  // architecture-specific invariants on top of the structural rules
  if (g.architecture === "dsx-vr") {
    const d = validateDsx(g);
    errors.push(...d.errors);
    warnings.push(...d.warnings);
  }
  if (g.architecture === "modular-pod") {
    const d = validateGridDirect(g);
    errors.push(...d.errors);
    warnings.push(...d.warnings);
  }
  return { ok: errors.length === 0, errors, warnings };
}

// ── Hit-testing (pure → testable headless) ───────────────────────────────────
export function hitTestPort(g: SldGraph, x: number, y: number, r = 11): PortHit | null {
  for (const n of g.nodes) {
    const p = ports(n), gg = geo(n);
    if (p.output) {
      for (const t of outTaps(n)) if (dist(x, y, t.x, t.y) <= r) return t.breaker ? { id: n.id, port: "output", breaker: t.breaker } : { id: n.id, port: "output" };
    }
    if (p.input && dist(x, y, gg.cx, gg.top) <= r) return { id: n.id, port: "input" };
  }
  for (const b of g.busbars) {
    if (x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + BUSH + r) {
      return { id: b.id, port: y < b.y + BUSH / 2 ? "input" : "output" };
    }
  }
  return null;
}

export function edgeEndpoints(g: SldGraph, e: SldEdge) {
  const fa = ent(g, e.from), ta = ent(g, e.to);
  if (!fa || !ta) return null;
  const fromBus = !!findBus(g, e.from), toBus = !!findBus(g, e.to);
  const fg = fromBus ? busGeo(fa as SldBus) : geo(fa as SldNode), tg = toBus ? busGeo(ta as SldBus) : geo(ta as SldNode);
  const fromX = !fromBus && e.fromBreaker ? tapPos(fa as SldNode, e.fromBreaker).x : fg.cx;
  return { from: { x: fromX, y: fg.bot }, to: { x: tg.cx, y: tg.top } };
}

export function hitTestWireEnd(g: SldGraph, x: number, y: number, r = 9): { edgeId: string; end: "from" | "to" } | null {
  let best: { edgeId: string; end: "from" | "to" } | null = null, bd = r;
  for (const e of g.edges) {
    const ep = edgeEndpoints(g, e); if (!ep) continue;
    const df = dist(x, y, ep.from.x, ep.from.y); if (df <= bd) { bd = df; best = { edgeId: e.id, end: "from" }; }
    const dt = dist(x, y, ep.to.x, ep.to.y); if (dt <= bd) { bd = dt; best = { edgeId: e.id, end: "to" }; }
  }
  return best;
}

// ── Serialization ─────────────────────────────────────────────────────────────
export function snap(g: SldGraph): string { return JSON.stringify(g); }
export function restore(s: string): SldGraph { return JSON.parse(s); }

// ── Seed: GB300 NVL72 single-line — NVIDIA DGX SuperPOD RA topology ───────────
// Real substation practice, switchboards only (no busbars):
//  • MAIN-TIE-MAIN (secondary-selective) MV: utility → two main transformers →
//    MV SWBD-A / MV SWBD-B, joined by a normally-open TIE breaker.
//  • BESS ties in at the MV interconnection (point of common coupling) for grid
//    services + faster interconnection.
//  • Each MV board feeds unit-sub transformers, which aggregate on a per-side
//    "Normal bus" (the normal-source input), before SWBD-A/B (a TRANSFER
//    switchboard per side, upstream of the UPS — see below) → UPS; the 4 UPS
//    tie into the LV distribution boards (4-to-make-3 distributed-redundant,
//    2N to rack).
//  • GENERATORS are on the 480 V site-distribution voltage. SWBD-A/B switch each
//    UPS's source between normal (that side's Normal bus, fed from the unit-sub
//    transformers) and emergency (the generator) — a TRANSFER function, not a
//    paralleling one: `transferSource: true` + exactly two external incomers is
//    checked structurally (sld.validate), which is what makes this a transfer
//    and not just two sources wired onto a common, permanently co-energized
//    bus. They sit upstream of the UPS, never at the LV boards the UPS output
//    feeds: landing there would strand the UPS during the transfer and let
//    load ride raw generator power with no conditioning, defeating the reason
//    a UPS is there. (As with DSX-VR's `interlocked` core board, the exclusivity
//    itself — only one source live — is not simulated via breaker state; the
//    model records the arrangement, not the switching action.)
// Every board output is a feeder BREAKER; extra breakers stay as user-editable spares.
export function seed(): SldGraph {
  const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0 };
  const N = (type: string, name: string, x: number, y: number, extra?: Partial<SldNode>) => { g.uid++; const n = mkNode("n" + g.uid, type, name, x, y, extra); g.nodes.push(n); return n; };
  const E = (from: SldNode, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
  const EB = (from: SldNode, br: string, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };
  // Relabel a breaker (used to turn a spare into the normally-open TIE).
  const setBrk = (n: SldNode, id: string, label: string, status: BreakerStatus) => { const b = (n.breakers || []).find((x) => x.id === id); if (b) { b.label = label; b.status = status; } };

  // sources
  const util = N("utility", "Utility feed 230 kV", 180, 18, { rating: "230 kV" });
  const bess = N("bess", "BESS · grid interconnect", 1120, 18, { rating: "PCC · grid services / ride-through" });

  // main-tie-main MV: two main transformers → two MV switchboards + a tie breaker
  const txMainA = N("transformer", "Main transformer A", 180, 96, { rating: "75 MVA · HV/MV" });
  const txMainB = N("transformer", "Main transformer B", 760, 96, { rating: "75 MVA · HV/MV" });
  const mvA = N("switchboard", "MV SWBD-A · 13.8 kV", 150, 176, { voltage: "13.8 kV", mainAmp: 1200, rating: "13.8 kV · 1200 A" });
  const mvB = N("switchboard", "MV SWBD-B · 13.8 kV", 760, 176, { voltage: "13.8 kV", mainAmp: 1200, rating: "13.8 kV · 1200 A" });
  setBrk(mvA, "b3", "TIE", "open"); // normally-open bus tie MV-A ↔ MV-B

  // unit-sub transformers → UPS (split across the two MV boards)
  const txX: SldNode[] = [], upsX: SldNode[] = [];
  const txHome = [mvA, mvA, mvB, mvB], txBrk = ["b1", "b2", "b1", "b2"];
  const xs = [150, 340, 760, 950];
  for (let i = 0; i < 4; i++) {
    txX.push(N("transformer", "Transformer " + (i + 1), xs[i], 250, { rating: "2.5 MVA" }));
    upsX.push(N("ups", "UPS " + (i + 1) + " (4N3)", xs[i], 520, { rating: "1500 kVA" }));
  }

  // Normal bus A/B: aggregates that side's unit-sub transformer secondaries
  // (~3007 A FLA each at 480 V, two per side ≈ 6014 A — standard-frame rounded
  // to 8000 A, the same rule topology.ts's stdAmp() applies to the identical
  // physical case, ceil not floor: a board must never be rated below its actual
  // incoming current) into the SINGLE normal-source incomer SWBD-A/B needs to
  // stay a genuine two-source transfer rather than an N-way bus. Plain edges
  // (unbreakered, N-to-1) — the same shape LV SWBD-A/B already uses for their 4
  // UPS incomers below.
  const normA = N("switchboard", "Normal bus A", 245, 340, { voltage: "480 V", mainAmp: 8000, rating: "480 V · 8000 A · aggregated unit-sub secondaries" });
  const normB = N("switchboard", "Normal bus B", 855, 340, { voltage: "480 V", mainAmp: 8000, rating: "480 V · 8000 A · aggregated unit-sub secondaries" });

  // generators on the 480 V site-distribution voltage, upstream of the UPS.
  const gen = N("genset", "On-site generation", 540, 340, { rating: "N × 3 MW · 480 V" });
  // SWBD-A/B: the transfer switchboards. `transferSource: true` (not DSX-VR's
  // `interlocked` — that field is read by validateDsx regardless of
  // architecture, and the legacy seed's own negative gate test relies on it
  // NOT firing here) requires exactly two external incomers: Normal bus (this
  // side's transformers) and the generator. mainAmp sized to what these boards
  // actually deliver downstream — 2 × 1500 kVA UPS @ 480 V ≈ 3608 A — not to
  // the (mutually exclusive, never-simultaneous) upstream source capacity.
  const swbdA = N("switchboard", "SWBD-A", 150, 430, { voltage: "480 V", mainAmp: 4000, transferSource: true, rating: "480 V · 4000 A · transfer — normal (transformer) / emergency (generator)" });
  const swbdB = N("switchboard", "SWBD-B", 900, 430, { voltage: "480 V", mainAmp: 4000, transferSource: true, rating: "480 V · 4000 A · transfer — normal (transformer) / emergency (generator)" });

  // LV distribution boards — the UPS OUTPUT feeds these, downstream of the UPS.
  const lvA = N("switchboard", "LV SWBD-A", 250, 630, { voltage: "480 V", rating: "480 V · 3200 A" });
  const lvB = N("switchboard", "LV SWBD-B", 900, 630, { voltage: "480 V", rating: "480 V · 3200 A" });

  const rA1 = N("rpp", "RPP-A1", 150, 722), rA2 = N("rpp", "RPP-A2", 470, 722);
  const rB1 = N("rpp", "RPP-B1", 800, 722), rB2 = N("rpp", "RPP-B2", 1120, 722);

  const racks: SldNode[] = []; for (let i = 0; i < 8; i++) racks.push(N("rack", "GB300 rack " + (i + 1), 150 + i * 112, 830));
  const chiller = N("chiller", "Chiller plant", 1060, 830), cdu = N("cdu", "CDU", 1160, 830), crah = N("crah", "CRAH", 1250, 830);
  const spine = N("spine", "Spine", 1340, 830), leaf = N("leaf", "Leaf", 1430, 830);

  // utility → main transformers → MV boards; BESS at the interconnection; MV tie
  E(util, txMainA); E(util, txMainB); E(txMainA, mvA); E(txMainB, mvB);
  E(bess, mvA);            // BESS at PCC (rides the tie to MV-B)
  EB(mvA, "b3", mvB);      // normally-open bus tie
  // MV boards → unit-sub transformers (feeder breakers) → Normal bus A/B
  // (aggregated) → SWBD-A/B (transfer: normal bus / emergency generator) → UPS.
  txX.forEach((tx, i) => EB(txHome[i], txBrk[i], tx));
  E(txX[0], normA); E(txX[1], normA); E(txX[2], normB); E(txX[3], normB);
  // Normal bus's single feed to its transfer board is its own feeder breaker
  // (per this file's own convention); the generator has no breaker bank of its
  // own (genset carries no breakers anywhere in this codebase), so its feed
  // stays a plain edge — same as every other genset output edge here.
  EB(normA, "b1", swbdA); setBrk(normA, "b1", "NORMAL", "closed");
  EB(normB, "b1", swbdB); setBrk(normB, "b1", "NORMAL", "closed");
  E(gen, swbdA); E(gen, swbdB); // the emergency source — exactly two external incomers per transfer board
  EB(swbdA, "b1", upsX[0]); EB(swbdA, "b2", upsX[1]);
  EB(swbdB, "b1", upsX[2]); EB(swbdB, "b2", upsX[3]);
  // 4 UPS tie into both LV boards (4-to-make-3 distributed-redundant)
  upsX.forEach((u) => { E(u, lvA); E(u, lvB); });

  const mechNet = [chiller, cdu, crah, spine, leaf];
  EB(lvA, "b1", rA1); EB(lvA, "b2", rA2); mechNet.forEach((l, i) => EB(lvA, "b" + (i + 3), l));
  EB(lvB, "b1", rB1); EB(lvB, "b2", rB2); mechNet.forEach((l, i) => EB(lvB, "b" + (i + 3), l));

  for (let i = 0; i < 4; i++) { EB(rA1, "b" + (i + 1), racks[i]); EB(rB1, "b" + (i + 1), racks[i]); }
  for (let i = 0; i < 4; i++) { EB(rA2, "b" + (i + 1), racks[i + 4]); EB(rB2, "b" + (i + 1), racks[i + 4]); }
  return g;
}
