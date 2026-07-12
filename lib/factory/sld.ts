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

export interface SldGraph {
  nodes: SldNode[];
  edges: SldEdge[];
  busbars: SldBus[];
  uid: number;
  groups?: SldGroup[];
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
  transformer: { label: "Transformer", kw: 0, kind: "eq" },
  ups: { label: "Transformer + UPS", kw: 0, kind: "eq" },
  switchboard: { label: "Switchboard", kw: 0, kind: "eq", breakered: true },
  rpp: { label: "RPP (remote power panel)", kw: 0, kind: "eq", breakered: true },
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

// Breaker-bank defaults per breakered type.
interface BrkCfg { n: number; lab: string; amp: number; mainAmp: number; voltage: string; }
const BRK_CFG: Record<string, BrkCfg> = {
  switchboard: { n: 8, lab: "F", amp: 800, mainAmp: 3200, voltage: "480 V" },
  rpp: { n: 4, lab: "C", amp: 100, mainAmp: 400, voltage: "415/240 V" },
};
function brkCfg(type: string): BrkCfg { return BRK_CFG[type] || { n: 4, lab: "F", amp: 400, mainAmp: 1000, voltage: "480 V" }; }
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
  if (p.breakered) { const c = brkCfg(type); n.voltage = c.voltage; n.mainAmp = c.mainAmp; n.breakers = defaultBreakers(type); }
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
/** Amps an element serves: a breakered node = Σ of its USED feeder breakers; a
 *  busbar/busway = Σ of the per-side demand of the loads it feeds. */
export function servedAmps(g: SldGraph, id: string): number {
  const n = findNode(g, id);
  if (n && isBreakered(n)) {
    let a = 0;
    for (const b of n.breakers || []) if (g.edges.some((e) => e.from === id && e.fromBreaker === b.id)) a += b.amp || 0;
    return a;
  }
  let a = 0;
  for (const e of g.edges) { if (e.from !== id) continue; const to = findNode(g, e.to); if (to && to.kind === "load") a += loadSideAmps(to); }
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
//  • Each MV board feeds unit-sub transformers → UPS; the 4 UPS tie into the LV
//    distribution boards SWBD-A/B (4-to-make-3 distributed-redundant, 2N to rack).
//  • GENERATORS are on the 480 V site-distribution voltage: gensets parallel on a
//    GEN PARALLEL SWBD that backs up the LV boards (not the MV side).
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
    upsX.push(N("ups", "UPS " + (i + 1) + " (4N3)", xs[i], 322, { rating: "1500 kVA" }));
  }

  // generators on the 480 V site-distribution voltage
  const gen = N("genset", "On-site generation", 540, 300, { rating: "N × 3 MW · 480 V" });
  const genPar = N("switchboard", "GEN PARALLEL SWBD · 480 V", 500, 376, { voltage: "480 V", mainAmp: 4000, rating: "480 V · paralleling" });

  // LV distribution boards
  const swA = N("switchboard", "SWBD-A", 250, 452, { voltage: "480 V", rating: "480 V · 3200 A" });
  const swB = N("switchboard", "SWBD-B", 900, 452, { voltage: "480 V", rating: "480 V · 3200 A" });

  const rA1 = N("rpp", "RPP-A1", 150, 544), rA2 = N("rpp", "RPP-A2", 470, 544);
  const rB1 = N("rpp", "RPP-B1", 800, 544), rB2 = N("rpp", "RPP-B2", 1120, 544);

  const racks: SldNode[] = []; for (let i = 0; i < 8; i++) racks.push(N("rack", "GB300 rack " + (i + 1), 150 + i * 112, 652));
  const chiller = N("chiller", "Chiller plant", 1060, 652), cdu = N("cdu", "CDU", 1160, 652), crah = N("crah", "CRAH", 1250, 652);
  const spine = N("spine", "Spine", 1340, 652), leaf = N("leaf", "Leaf", 1430, 652);

  // utility → main transformers → MV boards; BESS at the interconnection; MV tie
  E(util, txMainA); E(util, txMainB); E(txMainA, mvA); E(txMainB, mvB);
  E(bess, mvA);            // BESS at PCC (rides the tie to MV-B)
  EB(mvA, "b3", mvB);      // normally-open bus tie
  // MV boards → unit-sub transformers (feeder breakers) → UPS
  txX.forEach((tx, i) => EB(txHome[i], txBrk[i], tx));
  txX.forEach((tx, i) => E(tx, upsX[i]));
  // 4 UPS tie into both LV boards (4-to-make-3 distributed-redundant)
  upsX.forEach((u) => { E(u, swA); E(u, swB); });
  // gensets → 480 V paralleling board → LV boards (LV backup)
  E(gen, genPar); EB(genPar, "b1", swA); EB(genPar, "b2", swB);

  const mechNet = [chiller, cdu, crah, spine, leaf];
  EB(swA, "b1", rA1); EB(swA, "b2", rA2); mechNet.forEach((l, i) => EB(swA, "b" + (i + 3), l));
  EB(swB, "b1", rB1); EB(swB, "b2", rB2); mechNet.forEach((l, i) => EB(swB, "b" + (i + 3), l));

  for (let i = 0; i < 4; i++) { EB(rA1, "b" + (i + 1), racks[i]); EB(rB1, "b" + (i + 1), racks[i]); }
  for (let i = 0; i < 4; i++) { EB(rA2, "b" + (i + 1), racks[i + 4]); EB(rB2, "b" + (i + 1), racks[i + 4]); }
  return g;
}
