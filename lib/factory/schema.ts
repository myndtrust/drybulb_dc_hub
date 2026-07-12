// ─────────────────────────────────────────────────────────────────────────────
// FactoryGraph — the topology overlay for the AI Factory configurator.
//
// The cost engine's LocationConfig (lib/cost/types.ts) stays canonical; this
// graph adds the structure LocationConfig can't hold: power/cooling/network
// SOURCES (roots), DISTRIBUTION (internal), PAYLOADS (rack→node→gpu) and
// WORKLOADS (jobs/traffic) as leaves, with typed one-to-many edges. A node's
// cost-relevant values are *bound* (FNode.bind) to a LocationConfig path; the
// adapters in project.ts move values both ways.
//
// A single-line is a TREE/DAG: roots = sources (grid ∥ on-site gen), leaves =
// payloads + workloads. One busway feeds many racks (one-to-many).
// ─────────────────────────────────────────────────────────────────────────────

export type FKind = "source" | "distribution" | "payload" | "workload" | "space";
export type FDomain = "power" | "cooling" | "network" | "compute" | "workload" | "space";
export type FEdgeKind = "powers" | "cools" | "connects" | "contains" | "runs-on";

export interface FNodeAttrs {
  qty: number;
  catalogKey?: string;
  product?: string;
  perW?: number;
  unit?: "perW" | "perMW" | "total";
  powerKW?: number; // per-unit IT/source power (kW)
  redundancy?: "N" | "N+1" | "2N";
  [k: string]: unknown;
}

export interface FNode {
  id: string;
  kind: FKind;
  type: string; // grid|genset|switchgear|ups|busway|chiller|cdu|spine|leaf|rack|node|gpu|service ...
  domain: FDomain;
  name: string;
  parentId?: string; // spatial containment (space tree)
  attrs: FNodeAttrs;
  bind?: { locPath: string }; // dotted path into LocationConfig (see project.ts BINDINGS)
}

export interface FEdge {
  id: string;
  from: string;
  to: string;
  kind: FEdgeKind;
  attrs?: { ratingKW?: number; redundancy?: string };
}

export interface FactoryGraph {
  id: string;
  name: string;
  ra: string; // reference-architecture key
  target?: { mode: "gpus" | "mw" | "su" | "budget"; value: number };
  boundary?: Record<string, number | string>;
  nodes: FNode[];
  edges: FEdge[];
  rows?: RowLibrary; // server-row layouts (RA-seeded + user templates)
  overlay?: { pos?: Record<string, { x: number; y: number }> };
}

// ── Server-row layout + library (space / power / cooling per object) ──────────
// A server row is an ordered sequence of physical objects (rack elevations, CDUs,
// end-of-row coolers, PDUs, blanking, or user-defined objects). Each object models
// the floor SPACE it takes, the POWER it draws, and the COOLING load it adds or
// serves. Rows are seeded per reference architecture and saved into a reusable
// library; a RowTemplate maps to a `space` sub-tree of the FactoryGraph.
export type RowObjectType =
  | "rack" | "cdu" | "endcap-cooler" | "network-rack" | "pdu" | "ups" | "blanking" | "custom";

export interface SpaceFootprint {
  rackU?: number; // elevation height in rack units (racks)
  widthMM?: number; // floor width along the row
  depthMM?: number;
  footprintM2?: number; // floor area (derived or explicit)
}

export interface RowObject {
  id: string;
  type: RowObjectType;
  name: string;
  qty?: number; // contiguous count (e.g., 8 identical racks)
  catalogKey?: string; // links to equipment-catalog for cost/products
  product?: string;
  space: SpaceFootprint;
  powerKW: number; // IT/aux power this object draws (0 for passive/space)
  coolingKW: number; // cooling load it adds (+) or capacity it serves (−)
  userDefined?: boolean;
}

export interface RowTemplate {
  key: string;
  label: string;
  ra?: string; // seeded from this RA key, or undefined for user-defined
  objects: RowObject[]; // ordered left → right
  userDefined?: boolean;
}

export interface RowLibrary {
  templates: RowTemplate[];
}

/** Row roll-up: total length, footprint, power and net cooling. */
export function rollupRow(t: RowTemplate): { lengthMM: number; footprintM2: number; powerKW: number; coolingKW: number; objects: number } {
  let lengthMM = 0, footprintM2 = 0, powerKW = 0, coolingKW = 0, objects = 0;
  for (const o of t.objects) {
    const q = o.qty ?? 1;
    objects += q;
    lengthMM += (o.space.widthMM ?? 0) * q;
    footprintM2 += (o.space.footprintM2 ?? 0) * q;
    powerKW += o.powerKW * q;
    coolingKW += o.coolingKW * q;
  }
  return { lengthMM, footprintM2, powerKW, coolingKW, objects };
}

// ── Validation ───────────────────────────────────────────────────────────────
export interface ValidationResult {
  errors: string[];
  warnings: string[];
  ok: boolean;
}

const SOURCE_TYPES = new Set(["grid", "genset", "solar", "bess", "utility"]);

/**
 * Structural validation. A valid graph is a tree/DAG per power & cooling domain,
 * every payload has a power path to a source and a cooling path, edges reference
 * existing nodes, and quantities are non-negative.
 */
export function validateGraph(g: FactoryGraph): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));

  // referential integrity + qty
  for (const n of g.nodes) {
    if ((n.attrs?.qty ?? 0) < 0) errors.push(`node ${n.id}: qty < 0`);
    if (n.parentId && !byId.has(n.parentId)) errors.push(`node ${n.id}: parentId ${n.parentId} missing`);
    if (n.bind && !n.bind.locPath) errors.push(`node ${n.id}: empty bind.locPath`);
  }
  for (const e of g.edges) {
    if (!byId.has(e.from)) errors.push(`edge ${e.id}: from ${e.from} missing`);
    if (!byId.has(e.to)) errors.push(`edge ${e.id}: to ${e.to} missing`);
  }

  // per-domain acyclicity (power, cooling) — a single-line must be acyclic
  for (const kind of ["powers", "cools"] as FEdgeKind[]) {
    const adj = new Map<string, string[]>();
    g.edges.filter((e) => e.kind === kind).forEach((e) => {
      (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);
    });
    if (hasCycle(adj)) errors.push(`cycle detected in '${kind}' graph (single-line must be acyclic)`);
  }

  // every payload reachable from a source via 'powers', and cooled via 'cools'
  const sources = g.nodes.filter((n) => n.kind === "source" || SOURCE_TYPES.has(n.type)).map((n) => n.id);
  const poweredFrom = reachable(g, sources, "powers");
  const cooled = endpoints(g, "cools");
  for (const n of g.nodes) {
    if (n.kind === "payload" && (n.type === "rack" || n.type === "node")) {
      if (!poweredFrom.has(n.id)) errors.push(`payload ${n.id} (${n.name}) has no power path to a source`);
      if (cooled.size > 0 && !cooled.has(n.id)) warnings.push(`payload ${n.id} (${n.name}) is not cooled`);
    }
  }
  if (sources.length === 0) errors.push("no source node (grid / on-site generation) at the root");

  return { errors, warnings, ok: errors.length === 0 };
}

function hasCycle(adj: Map<string, string[]>): boolean {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const dfs = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };
  for (const u of adj.keys()) if ((color.get(u) ?? WHITE) === WHITE && dfs(u)) return true;
  return false;
}

/** Nodes reachable from `roots` following edges of the given kind (downstream). */
function reachable(g: FactoryGraph, roots: string[], kind: FEdgeKind): Set<string> {
  const adj = new Map<string, string[]>();
  g.edges.filter((e) => e.kind === kind).forEach((e) => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  });
  const seen = new Set<string>(roots);
  const stack = [...roots];
  while (stack.length) {
    const u = stack.pop()!;
    for (const v of adj.get(u) ?? []) if (!seen.has(v)) { seen.add(v); stack.push(v); }
  }
  return seen;
}

/** Set of node ids that are the `to` endpoint of any edge of the given kind. */
function endpoints(g: FactoryGraph, kind: FEdgeKind): Set<string> {
  return new Set(g.edges.filter((e) => e.kind === kind).map((e) => e.to));
}
