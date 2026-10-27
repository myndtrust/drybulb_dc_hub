// Network systems: the separate networks a room carries (compute fabric,
// storage / converged, in-band management, out-of-band). Each endpoint cable
// type belongs to one system; each switch is tagged with its system and tier.
// Cable routing (analysis.ts) runs per system from these rules, so the Cable
// pathways schedule and the Network topology are the same data.

import type { LibIndex } from "./model";
import type { CableGroup, CableType, LibItem, NetSystem, NetTier, Rack, Scenario } from "./types";

export const DEFAULT_NETS: NetSystem[] = [
  { id: "net-fabric", name: "Compute fabric (east–west)", color: "#6d4bd1", cables: ["fabric"], racks: [], uplink: 1 },
  { id: "net-storage", name: "Storage / converged (north–south)", color: "#1f8a70", cables: ["storage"], racks: [], uplink: 1 },
  { id: "net-mgmt", name: "In-band management", color: "#2575b5", cables: ["mgmt"], racks: [], uplink: 0.25 },
  { id: "net-oob", name: "Out-of-band (BMC)", color: "#b8741a", cables: ["bmc"], racks: [], uplink: 0.1 },
];

/** Cable types no system carries are routed under this one, to any network rack. */
export const UNASSIGNED: NetSystem = { id: "net-none", name: "Unassigned", color: "#7b847f", cables: [], racks: [], uplink: 0 };

export const NET_COLORS = ["#6d4bd1", "#1f8a70", "#2575b5", "#b8741a", "#c2417a", "#3f7f2a", "#8a5a2b", "#0f6f8f"];

export const netSystems = (s: Scenario): NetSystem[] => (s.nets?.length ? s.nets : DEFAULT_NETS);

/** The system that carries a cable type (the first listing it), or UNASSIGNED. */
export function systemFor(nets: NetSystem[], t: CableType): NetSystem {
  return nets.find((n) => n.cables.includes(t)) ?? UNASSIGNED;
}

export const netById = (nets: NetSystem[], id: string): NetSystem =>
  nets.find((n) => n.id === id) ?? (id === UNASSIGNED.id ? UNASSIGNED : { ...UNASSIGNED, id, name: "Removed system" });

/** A switch's tier when untagged: leaf. */
export const tierOf = (t: NetTier | undefined): NetTier => t ?? "leaf";

const isNet = (r: Rack) => r.role === "network";

/** Switches of `sys` at `tier` in a rack. */
export function switchesIn(r: Rack, lib: LibIndex, sysId: string, tier: NetTier) {
  return r.devs.filter((d) => lib[d.lib]?.cat === "network" && d.net === sysId && tierOf(d.tier) === tier);
}

/**
 * Racks whose leaves take this system's endpoint cables: the system's chosen
 * network racks, else any rack holding its leaf switches (e.g. the in-rack OOB
 * switches of an NVL72), else every network rack.
 */
export function servedRacks(s: Scenario, lib: LibIndex, sys: NetSystem): Rack[] {
  const nets = s.racks.filter(isNet);
  const pick = nets.filter((r) => sys.racks.includes(r.id));
  if (pick.length) return pick;
  const withLeaf = s.racks.filter((r) => switchesIn(r, lib, sys.id, "leaf").length);
  return withLeaf.length ? withLeaf : nets;
}

/** Racks holding this system's spine switches. */
export const spineRacks = (s: Scenario, lib: LibIndex, sys: NetSystem) =>
  s.racks.filter((r) => switchesIn(r, lib, sys.id, "spine").length);

/**
 * Split `n` cables over targets in proportion to `w` (largest remainder; equal
 * when all weights are 0). Ties go to targets starting at `offset`, so many
 * splits (one per rack) don't all round up onto the same first targets.
 */
export function apportion(n: number, w: number[], offset = 0): number[] {
  const tot = w.reduce((a, v) => a + v, 0);
  const ws = tot ? w : w.map(() => 1), t = tot || w.length;
  const raw = ws.map((v) => (n * v) / t), out = raw.map(Math.floor);
  let left = n - out.reduce((a, v) => a + v, 0);
  const len = w.length || 1, rot = (i: number) => (i - (offset % len) + len) % len;
  const frac = (v: number) => Math.round((v - Math.floor(v)) * 1e6);
  const order = raw.map((v, i) => [frac(v), i]).sort((a, b) => b[0] - a[0] || rot(a[1]) - rot(b[1])).map((x) => x[1]);
  for (const i of order) { if (left-- <= 0) break; out[i]++; }
  return out;
}

/**
 * `apportion` across many splits with error diffusion: each target's rounding
 * remainder carries into the next split (`carry` is updated in place), so the
 * running totals stay proportional to `w` however many racks are split.
 */
export function apportionCarry(n: number, w: number[], carry: number[]): number[] {
  const tot = w.reduce((a, v) => a + v, 0);
  const ws = tot ? w : w.map(() => 1), t = tot || w.length;
  const raw = ws.map((v, i) => (n * v) / t + (carry[i] ?? 0));
  const out = raw.map((v) => Math.max(0, Math.floor(v)));
  let left = n - out.reduce((a, v) => a + v, 0);
  const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  for (const i of order) { if (left <= 0) break; out[i]++; left--; }
  for (let i = order.length - 1; left < 0 && i >= 0; i--) { const k = order[i]; if (out[k] > 0) { out[k]--; left++; i++; } }
  raw.forEach((v, i) => { carry[i] = v - out[i]; });
  return out;
}

/** Leaf-to-spine uplinks from a leaf rack taking `access` endpoint cables, spread evenly over the spine racks. */
export function uplinks(r: Rack, access: number, sys: NetSystem, spines: Rack[]): { to: Rack; count: number }[] {
  const total = Math.round(access * sys.uplink);
  const to = spines.filter((x) => x.id !== r.id);
  if (!total || !to.length) return [];
  return to.map((t, i) => ({ to: t, count: Math.floor(total / to.length) + (i < total % to.length ? 1 : 0) })).filter((u) => u.count);
}

export interface NetSummary {
  sys: NetSystem;
  /** Endpoint racks with cables on this system. */
  endpoints: number;
  leafRacks: Rack[];
  spineRacks: Rack[];
  leaves: number;
  spines: number;
  /** Switch ports on its leaves (where the library states them). */
  leafPorts: number;
  access: number;
  uplink: number;
  length: number;
  longest: number;
  noPath: number;
}

/** Per-system totals from the cable groups (the same groups the Cable pathways tab lists). */
export function netSummaries(s: Scenario, lib: LibIndex, groups: CableGroup[]): NetSummary[] {
  const nets = netSystems(s);
  const all = [...nets, ...(groups.some((g) => g.net === UNASSIGNED.id) ? [UNASSIGNED] : [])];
  return all.map((sys) => {
    const gs = groups.filter((g) => g.net === sys.id);
    const acc = gs.filter((g) => g.link === "access");
    const leafRacks = [...new Map(acc.map((g) => [g.to.id, g.to])).values()];
    const sp = spineRacks(s, lib, sys);
    const leafDevs = s.racks.flatMap((r) => switchesIn(r, lib, sys.id, "leaf"));
    return {
      sys,
      endpoints: new Set(acc.map((g) => g.from.id)).size,
      leafRacks, spineRacks: sp,
      leaves: leafDevs.length,
      spines: s.racks.reduce((a, r) => a + switchesIn(r, lib, sys.id, "spine").length, 0),
      leafPorts: leafDevs.reduce((a, d) => a + (lib[d.lib]?.swPorts ?? 0), 0),
      access: acc.reduce((a, g) => a + g.count, 0),
      uplink: gs.filter((g) => g.link === "uplink").reduce((a, g) => a + g.count, 0),
      length: gs.reduce((a, g) => a + g.count * g.len, 0),
      longest: gs.reduce((a, g) => Math.max(a, g.len), 0),
      noPath: gs.filter((g) => g.via === "direct").length,
    };
  });
}

/**
 * Best guess at an untagged switch's system and tier from its library name and
 * its rack's name ("…SPINE…" racks hold spines). Undefined when nothing matches.
 */
export function guessNet(L: LibItem, rack: Rack, nets: NetSystem[]): { net: string; tier: NetTier } | undefined {
  const n = L.name;
  const t: CableType | null =
    /\bOOB\b|SN2201|BMC|\b1G\b/i.test(n) ? "bmc"
      : /manage|mgmt/i.test(n) ? "mgmt"
      : /storage|N-S|north|converged/i.test(n) ? "storage"
      : /fabric|800G|1\.6T|SN5600|Spectrum|Quantum|InfiniBand/i.test(n) ? "fabric"
      : null;
  if (!t) return undefined;
  const sys = systemFor(nets, t);
  if (sys.id === UNASSIGNED.id) return undefined;
  return { net: sys.id, tier: /spine/i.test(rack.name) ? "spine" : "leaf" };
}

// ── Graph model: every switch and endpoint device is a node ─────────────────

export type NetNodeKind = "endpoint" | "leaf" | "spine";

export interface NetNode {
  /** Device id, or `rack:<rack id>:<system id>` for a rack whose switches aren't tagged. */
  id: string;
  kind: NetNodeKind;
  label: string;
  rack: Rack;
  /** Library item (empty for an untagged rack placeholder). */
  lib: string;
  /** Systems it is on: its own for a switch, every system it reaches for an endpoint. */
  nets: string[];
  /** Placeholder for a network rack whose switches aren't tagged. */
  placeholder?: boolean;
}

export interface NetEdge {
  id: string;
  /** Lower-tier node (endpoint, or leaf for an uplink)… */
  a: string;
  /** …and the switch it lands on (leaf, or spine). */
  b: string;
  net: string;
  link: CableGroup["link"];
  type: CableType;
  /** Cables (links) between the two nodes. */
  count: number;
  len: number;
  via: CableGroup["via"];
}

export interface NetGraph {
  nodes: NetNode[];
  edges: NetEdge[];
}

/**
 * The node-level graph behind the cable groups. A group's endpoint cables are
 * split over the rack's devices by their port counts and dealt round robin over
 * the leaf rack's leaf switches (one rail per leaf when the counts match); a leaf rack's
 * uplinks are spread evenly over its leaves and over the spine rack's spines
 * (a full leaf–spine mesh). Edge counts add up to the cable groups' counts.
 */
export function netGraph(s: Scenario, lib: LibIndex, groups: CableGroup[]): NetGraph {
  const nodes = new Map<string, NetNode>();
  const edges = new Map<string, NetEdge>();
  const node = (id: string, n: Omit<NetNode, "id" | "nets">, net: string) => {
    const x = nodes.get(id) ?? nodes.set(id, { id, nets: [], ...n }).get(id)!;
    if (!x.nets.includes(net)) x.nets.push(net);
    return x;
  };
  const sw = (r: Rack, net: string, tier: NetTier): NetNode[] => {
    const devs = switchesIn(r, lib, net, tier);
    if (!devs.length) return [node(`rack:${r.id}:${net}`, { kind: tier, label: `${r.name} (untagged)`, rack: r, lib: "", placeholder: true }, net)];
    return devs.map((d, k) => node(d.id, { kind: tier, label: `${r.name} ${tier === "leaf" ? "L" : "S"}${k + 1}`, rack: r, lib: d.lib }, net));
  };
  // Devices that send cables from a rack (as in cableAnalysis), bottom up.
  const endpointDevs = (r: Rack) => r.devs
    .filter((d) => { const L = lib[d.lib]; return L && Object.values(L.ports ?? {}).some(Boolean) && !(r.role === "network" && L.cat === "network"); })
    .sort((a, b) => a.u - b.u);
  const link = (a: string, b: string, g: CableGroup, count: number) => {
    if (!count) return;
    const k = [a, b, g.net, g.type].join("|");
    const e = edges.get(k);
    if (e) { e.count += count; e.len = Math.max(e.len, g.len); if (g.via === "direct") e.via = "direct"; }
    else edges.set(k, { id: k, a, b, net: g.net, link: g.link, type: g.type, count, len: g.len, via: g.via });
  };

  for (const g of groups) {
    if (g.link === "access") {
      const leaves = sw(g.to, g.net, "leaf");
      const all = endpointDevs(g.from);
      // The group's cables (all, or this leaf rack's share when spread) split over the devices by their ports.
      const ends = all.filter((d) => lib[d.lib]!.ports[g.type]);
      const share = apportion(g.count, ends.map((d) => lib[d.lib]!.ports[g.type]!));
      let k = 0;
      ends.forEach((d, i) => {
        const label = all.length > 1 ? `${g.from.name}.${all.indexOf(d) + 1}` : g.from.name;
        const e = node(d.id, { kind: "endpoint", label, rack: g.from, lib: d.lib }, g.net);
        const per = new Map<string, number>();
        for (let j = 0; j < share[i]; j++) { const l = leaves[k++ % leaves.length]; per.set(l.id, (per.get(l.id) || 0) + 1); }
        for (const [l, c] of per) link(e.id, l, g, c);
      });
    } else {
      const leaves = sw(g.from, g.net, "leaf"), spines = sw(g.to, g.net, "spine");
      const per = new Map<string, number>();
      for (let k = 0; k < g.count; k++) {
        const key = leaves[k % leaves.length].id + "|" + spines[Math.floor(k / leaves.length) % spines.length].id;
        per.set(key, (per.get(key) || 0) + 1);
      }
      for (const [key, c] of per) { const [a, b] = key.split("|"); link(a, b, g, c); }
    }
  }
  // Switches with no cables still show (e.g. a spine nothing reaches yet).
  for (const r of s.racks) for (const d of r.devs) {
    const L = lib[d.lib];
    if (L?.cat !== "network" || !d.net || nodes.has(d.id)) continue;
    const tier = tierOf(d.tier), same = switchesIn(r, lib, d.net, tier);
    node(d.id, { kind: tier, label: `${r.name} ${tier === "leaf" ? "L" : "S"}${same.indexOf(d) + 1}`, rack: r, lib: d.lib }, d.net);
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
