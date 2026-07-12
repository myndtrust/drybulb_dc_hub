// ─────────────────────────────────────────────────────────────────────────────
// project.ts — the sync adapter between the single-line (SldGraph) and the cost
// model's canonical LocationConfig.
//
// Design principle: the single-line is a PROJECTION/GENERATOR of LocationConfig,
// not a second cost engine. The cost engine (lib/cost/model.ts) stays canonical.
// The graph drives the cost model only through quantities:
//   • capacityMW  = Σ IT rack power / 1000   (the critical IT capacity)
//   • gpus        = rack count × GPUs/rack   (from the reference architecture)
// LocationConfig owns quantities/costs; the graph owns topology + layout. Value
// sync is continuous graph→inputs; structural regeneration (inputs/RA → graph) is
// an explicit user action (locationToGraph / AutoBuild), so layout never echoes.
// ─────────────────────────────────────────────────────────────────────────────

import type { LocationConfig } from "../cost/types";
import { REFERENCE_ARCHITECTURES } from "./reference-architectures.gen";
import { RACK_SPEC_BY_KEY } from "./rack-specs.gen";
import { NETWORK_RACK_BY_KEY } from "./network-specs.gen";
import { mkNode, applyRackSpecObj, type SldGraph, type SldNode, type SldBus, type SldEdge, type OpResult } from "./sld";

export const DEFAULT_RA = "gb300-nvl72";
function ra(key: string = DEFAULT_RA) {
  return REFERENCE_ARCHITECTURES.find((r) => r.key === key) ?? REFERENCE_ARCHITECTURES[0];
}

// ── Roll-up: pure totals derived from the graph ──────────────────────────────
export interface GraphRollup {
  rackCount: number;
  gpus: number;
  itKW: number;
  mechKW: number;
  netKW: number;
  facilityLoadKW: number;
  busbars: number;
  breakerCount: number;
  netracksEW: number;
  netracksNS: number;
  counts: Record<string, number>; // by node type
}

export function rollupGraph(g: SldGraph, raKey: string = DEFAULT_RA): GraphRollup {
  const gpusPerRack = ra(raKey).system.gpus;
  const loads = g.nodes.filter((n) => n.kind === "load");
  const sum = (pred: (n: SldNode) => boolean) => loads.filter(pred).reduce((a, n) => a + (n.kw || 0), 0);
  const counts: Record<string, number> = {};
  for (const n of g.nodes) counts[n.type] = (counts[n.type] || 0) + 1;
  const breakerCount = g.nodes.reduce((a, n) => a + ((n.breakers && n.breakers.length) || 0), 0);
  const itKW = sum((n) => n.grp === "IT");
  const mechKW = sum((n) => n.grp === "MECH");
  const netKW = sum((n) => n.grp === "NET");
  const rackCount = counts["rack"] || 0;
  return {
    rackCount,
    gpus: rackCount * gpusPerRack,
    itKW, mechKW, netKW,
    facilityLoadKW: itKW + mechKW + netKW,
    busbars: g.busbars.length,
    breakerCount,
    netracksEW: counts["netrack-ew"] || 0,
    netracksNS: counts["netrack-ns"] || 0,
    counts,
  };
}

// ── Network-rack journey (east-west compute fabric + north-south front-end) ──
export interface NetworkNeed { computeRacks: number; suCount: number; ewRacks: number; nsRacks: number; racksPerSu: number; }

/** How many E-W / N-S network racks the current compute racks require. E-W = one
 *  compute-fabric (leaf/spine) network rack per scalable unit; N-S = front-end /
 *  storage / management, ~one per two SUs (min 1 when there are compute racks). */
export function requiredNetworkRacks(g: SldGraph): NetworkNeed {
  const compute = g.nodes.filter((n) => n.kind === "load" && n.grp === "IT");
  const computeRacks = compute.length;
  const specced = compute.find((n) => n.aiRack)?.aiRack;
  const racksPerSu = (specced && RACK_SPEC_BY_KEY[specced]?.network.racks_per_su) || 8;
  const suCount = computeRacks > 0 ? Math.ceil(computeRacks / racksPerSu) : 0;
  return {
    computeRacks, suCount, racksPerSu,
    ewRacks: suCount,
    nsRacks: computeRacks > 0 ? Math.max(1, Math.ceil(suCount / 2)) : 0,
  };
}

export type ArrangeMode = "dedicated" | "shared";

/** Pure + idempotent: replace the auto-managed network racks (and their auto NET-
 *  RPPs) with exactly the required E-W / N-S count, each specced to a default
 *  network-rack (so it carries power/cooling). `dedicated` (default) creates
 *  dedicated NET-RPPs fed from a switchboard; `shared` taps the compute RPP. Only
 *  touches netracks + NET-RPPs — never the user's compute/distribution layout. */
export function arrangeNetworkRacks(g: SldGraph, opts: { mode?: ArrangeMode } = {}): OpResult {
  const mode = opts.mode ?? "dedicated";
  const need = requiredNetworkRacks(g);
  let ng: SldGraph = JSON.parse(JSON.stringify(g));

  // remove prior auto netracks + auto NET-RPPs
  const drop = new Set(
    ng.nodes.filter((n) => n.type === "netrack-ew" || n.type === "netrack-ns" || (n.type === "rpp" && /^NET-RPP/.test(n.name))).map((n) => n.id),
  );
  ng.nodes = ng.nodes.filter((n) => !drop.has(n.id));
  ng.edges = ng.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to));

  const sw = ng.nodes.find((n) => n.type === "switchboard") || null;
  const mk = (type: string, name: string, x: number, y: number) => { ng.uid++; const id = "n" + ng.uid; ng.nodes.push(mkNode(id, type, name, x, y, undefined)); return id; };
  const link = (from: string, to: string) => {
    ng.uid++;
    const e: SldEdge = { id: "e" + ng.uid, from, to };
    const node = ng.nodes.find((n) => n.id === from);
    if (node?.breakers) { const used = new Set(ng.edges.filter((x) => x.from === from).map((x) => x.fromBreaker)); const free = node.breakers.find((b) => !used.has(b.id)); if (free) e.fromBreaker = free.id; }
    ng.edges.push(e);
  };

  // feeder for each domain
  let ewFeeder: string | null = null, nsFeeder: string | null = null;
  if (mode === "dedicated") {
    if (need.ewRacks > 0) { ewFeeder = mk("rpp", "NET-RPP-EW", 150, 712); if (sw) link(sw.id, ewFeeder); }
    if (need.nsRacks > 0) { nsFeeder = mk("rpp", "NET-RPP-NS", 700, 712); if (sw) link(sw.id, nsFeeder); }
  } else {
    const computeRpp = ng.nodes.find((n) => n.type === "rpp" && !/^NET-RPP/.test(n.name));
    ewFeeder = nsFeeder = computeRpp?.id ?? sw?.id ?? ng.busbars[0]?.id ?? null;
  }

  const ewSpec = NETWORK_RACK_BY_KEY["ew-ib-quantum"];
  const nsSpec = NETWORK_RACK_BY_KEY["ns-mgmt"];
  const made: { id: string; spec?: typeof ewSpec }[] = [];
  for (let k = 0; k < need.ewRacks; k++) { const id = mk("netrack-ew", `NET E-W ${k + 1}`, 150 + k * 120, 772); if (ewFeeder) link(ewFeeder, id); made.push({ id, spec: ewSpec }); }
  for (let k = 0; k < need.nsRacks; k++) { const id = mk("netrack-ns", `NET N-S ${k + 1}`, 700 + k * 120, 772); if (nsFeeder) link(nsFeeder, id); made.push({ id, spec: nsSpec }); }

  // spec each netrack (sets kW + power/cooling + sizes its feeding breaker)
  for (const m of made) { if (!m.spec) continue; const r = applyRackSpecObj(ng, m.id, m.spec); if (r.ok) ng = r.graph; }
  return { ok: true, graph: ng };
}

// ── graph → LocationConfig (continuous value sync) ───────────────────────────
/** The patch the single-line contributes to its bound location: the critical IT
 *  capacity. (Itemized electrical/mechanical componentCosts is a later refinement.) */
export function graphToLocation(g: SldGraph, _base: LocationConfig, raKey: string = DEFAULT_RA): Partial<LocationConfig> {
  const roll = rollupGraph(g, raKey);
  return { capacityMW: roll.itKW / 1000 };
}

/** Merge a patch into a location (shallow — patches are top-level scalars here). */
export function applyLocationPatch(loc: LocationConfig, patch: Partial<LocationConfig>): LocationConfig {
  return { ...loc, ...patch };
}

// ── LocationConfig → graph (explicit AutoBuild) ──────────────────────────────
/** Build a valid, sized single-line for `rackCount` racks per the RA: sources →
 *  4-to-make-3 UPS → 2N switchboards → RPP rows (≤4 racks each) → dual-corded racks. */
export function buildGraphForRacks(rackCount: number, raKey: string = DEFAULT_RA): SldGraph {
  const r = ra(raKey);
  const racksPerRpp = 4;
  const n = Math.max(1, Math.round(rackCount));
  const rppPerSide = Math.ceil(n / racksPerRpp);

  const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0 };
  const N = (type: string, name: string, x: number, y: number, extra?: Partial<SldNode>) => {
    g.uid++; const node = mkNode("n" + g.uid, type, name, x, y, extra); g.nodes.push(node); return node;
  };
  const E = (from: SldNode, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
  const EB = (from: SldNode, br: string, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };
  const ensureBreakers = (node: SldNode, count: number) => {
    const list = node.breakers || (node.breakers = []);
    while (list.length < count) { const i = list.length + 1; list.push({ id: "b" + i, label: "F" + i, amp: 800, poles: 3, status: "closed" }); }
  };

  const util = N("utility", "Utility feed 230 kV", 180, 18, { rating: "230 kV" });
  // main-tie-main MV: two main transformers → MV SWBD-A/B + a normally-open tie
  const txMainA = N("transformer", "Main transformer A", 180, 96, { rating: "75 MVA · HV/MV" });
  const txMainB = N("transformer", "Main transformer B", 760, 96, { rating: "75 MVA · HV/MV" });
  const mvA = N("switchboard", "MV SWBD-A · 13.8 kV", 150, 176, { voltage: "13.8 kV", mainAmp: 1200, rating: "13.8 kV · 1200 A" });
  const mvB = N("switchboard", "MV SWBD-B · 13.8 kV", 760, 176, { voltage: "13.8 kV", mainAmp: 1200, rating: "13.8 kV · 1200 A" });
  ensureBreakers(mvA, 3); ensureBreakers(mvB, 2);
  const tie = mvA.breakers!.find((b) => b.id === "b3"); if (tie) { tie.label = "TIE"; tie.status = "open"; }
  E(util, txMainA); E(util, txMainB); E(txMainA, mvA); E(txMainB, mvB);
  EB(mvA, "b3", mvB); // normally-open bus tie
  // BESS at the MV interconnection (PCC)
  const bess = N("bess", "BESS · grid interconnect", 1120, 18, { rating: "PCC · grid services / ride-through" });
  E(bess, mvA);

  // unit-sub transformers → UPS, split across the two MV boards
  const ups: SldNode[] = [];
  const txHome = [mvA, mvA, mvB, mvB], txBrk = ["b1", "b2", "b1", "b2"], xs = [150, 340, 760, 950];
  for (let i = 0; i < 4; i++) {
    const tx = N("transformer", "Transformer " + (i + 1), xs[i], 250);
    const u = N("ups", "UPS " + (i + 1) + " (4N3)", xs[i], 322);
    EB(txHome[i], txBrk[i], tx); E(tx, u); ups.push(u);
  }

  // LV distribution boards: SWBD-A/B; the 4 UPS tie into both (4-to-make-3)
  const swA = N("switchboard", "SWBD-A", 250, 452, { voltage: "480 V", rating: "480 V · 3200 A" });
  const swB = N("switchboard", "SWBD-B", 900, 452, { voltage: "480 V", rating: "480 V · 3200 A" });
  ensureBreakers(swA, rppPerSide); ensureBreakers(swB, rppPerSide);
  ups.forEach((u) => { E(u, swA); E(u, swB); });

  // generators on the 480 V site-distribution voltage → paralleling board → LV boards
  const gen = N("genset", "On-site generation", 540, 300, { rating: "N × 3 MW · 480 V" });
  const genPar = N("switchboard", "GEN PARALLEL SWBD · 480 V", 500, 376, { voltage: "480 V", mainAmp: 4000, rating: "480 V · paralleling" });
  E(gen, genPar); EB(genPar, "b1", swA); EB(genPar, "b2", swB);

  const rppA: SldNode[] = [], rppB: SldNode[] = [];
  for (let k = 0; k < rppPerSide; k++) {
    rppA.push(N("rpp", "RPP-A" + (k + 1), 150 + k * 320, 544));
    rppB.push(N("rpp", "RPP-B" + (k + 1), 800 + k * 320, 544));
    EB(swA, "b" + (k + 1), rppA[k]);
    EB(swB, "b" + (k + 1), rppB[k]);
  }

  for (let i = 0; i < n; i++) {
    const rack = N("rack", "GB300 rack " + (i + 1), 150 + (i % racksPerRpp) * 112 + Math.floor(i / racksPerRpp) * 480, 652);
    const k = Math.floor(i / racksPerRpp);
    const br = "b" + ((i % racksPerRpp) + 1);
    EB(rppA[k], br, rack);
    EB(rppB[k], br, rack);
  }
  return g;
}

/** AutoBuild a single-line sized to a location's IT capacity (rack count from RA). */
export function locationToGraph(loc: LocationConfig, raKey: string = DEFAULT_RA): SldGraph {
  const kwPerRack = ra(raKey).racking.kw_per_rack;
  const rackCount = Math.max(1, Math.round((loc.capacityMW * 1000) / kwPerRack));
  return buildGraphForRacks(rackCount, raKey);
}
