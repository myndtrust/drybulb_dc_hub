"use client";

import { useMemo, useState } from "react";
import { CABLE_T } from "@/lib/rackline/constants";
import { fLen, n0 } from "@/lib/rackline/format";
import type { LibIndex } from "@/lib/rackline/model";
import { netById, type NetEdge, type NetGraph, type NetNode, type NetNodeKind } from "@/lib/rackline/network";
import type { NetSystem, Rack, Units } from "@/lib/rackline/types";
import { Btn, Chip, Hint, Table } from "./ui";

// Geometry (px): node pitch, switch square, endpoint radius, box padding / header, gaps.
const SP = 14, NS = 9, ER = 5, CP = 6, CH = 17, GAPC = 14, PAD = 24, TIER_GAP = 110;
const COLS: Record<NetNodeKind, number> = { spine: 12, leaf: 12, endpoint: 6 };
const TIER_LABEL: Record<NetNodeKind, string> = { spine: "SPINE SWITCHES", leaf: "LEAF SWITCHES", endpoint: "ENDPOINT DEVICES" };

interface Box { rack: Rack; tier: NetNodeKind; nodes: NetNode[]; x: number; y: number; w: number; h: number; cols: number }

const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label, undefined, { numeric: true });

/**
 * Node-level network graph: every switch and endpoint device is a node, every
 * node pair with cables between them an edge. Nodes are grouped in their racks,
 * tiered spine / leaf / endpoint, with racks ordered to keep edges short.
 */
export function NetGraphView({ graph, nets, shown, lib, units }: {
  graph: NetGraph;
  nets: NetSystem[];
  /** System ids to draw. */
  shown: Set<string>;
  lib: LibIndex;
  units: Units;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [linkF, setLinkF] = useState<"all" | NetEdge["link"]>("all");

  const view = useMemo(() => {
    const edges = graph.edges.filter((e) => shown.has(e.net) && (linkF === "all" || e.link === linkF));
    const used = new Set(edges.flatMap((e) => [e.a, e.b]));
    const nodes = graph.nodes.filter((n) => used.has(n.id) || (n.kind !== "endpoint" && n.nets.some((x) => shown.has(x)) && linkF === "all"));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const adj = new Map<string, NetEdge[]>();
    for (const e of edges) for (const id of [e.a, e.b]) (adj.get(id) ?? adj.set(id, []).get(id)!).push(e);

    // Boxes per rack per tier.
    const boxes: Box[] = [];
    const tiers: NetNodeKind[] = ["spine", "leaf", "endpoint"];
    const tierBoxes = (t: NetNodeKind) => {
      const m = new Map<string, NetNode[]>();
      for (const n of nodes) if (n.kind === t) (m.get(n.rack.id) ?? m.set(n.rack.id, []).get(n.rack.id)!).push(n);
      return [...m.values()].map((ns) => {
        ns.sort(byName);
        const cols = Math.min(ns.length, COLS[t]), rows = Math.ceil(ns.length / cols);
        return { rack: ns[0].rack, tier: t, nodes: ns, x: 0, y: 0, w: Math.max(64, cols * SP + 2 * CP), h: CH + rows * SP + CP, cols } as Box;
      });
    };
    const pos = new Map<string, [number, number]>();
    const place = (b: Box) => b.nodes.forEach((n, i) => pos.set(n.id, [b.x + CP + SP / 2 + (i % b.cols) * SP, b.y + CH + SP / 2 + Math.floor(i / b.cols) * SP]));
    // Lay a tier out left to right in `order`, each box at its wanted x but never overlapping.
    const lay = (bs: Box[], want: (b: Box) => number) => {
      const w = bs.map((b) => ({ b, x: want(b) })).sort((p, q) => p.x - q.x);
      let cur = PAD;
      for (const { b, x } of w) { b.x = Math.max(cur, Number.isFinite(x) ? x : cur); cur = b.x + b.w + GAPC; }
    };
    const centreOf = (b: Box, towards: NetNodeKind) => {
      const xs = b.nodes.flatMap((n) => (adj.get(n.id) ?? []).map((e) => (e.a === n.id ? e.b : e.a)))
        .filter((id) => byId.get(id)?.kind === towards).map((id) => pos.get(id)?.[0]).filter((x): x is number => x != null);
      return xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length - b.w / 2 : Infinity;
    };
    const tb = Object.fromEntries(tiers.map((t) => [t, tierBoxes(t)])) as Record<NetNodeKind, Box[]>;
    const tierH = (t: NetNodeKind) => Math.max(0, ...tb[t].map((b) => b.h));
    let y = PAD + 14;
    const ys = {} as Record<NetNodeKind, number>;
    for (const t of tiers) { if (!tb[t].length) continue; ys[t] = y; y += tierH(t) + TIER_GAP; }
    for (const t of tiers) for (const b of tb[t]) b.y = ys[t];
    // Endpoints in plan reading order; leaves over their endpoints; spines over their leaves.
    tb.endpoint.sort((a, b) => (Math.abs(a.rack.y - b.rack.y) > 0.3 ? a.rack.y - b.rack.y : a.rack.x - b.rack.x));
    let cur = PAD;
    for (const b of tb.endpoint) { b.x = cur; cur += b.w + GAPC; place(b); }
    lay(tb.leaf, (b) => centreOf(b, "endpoint"));
    tb.leaf.forEach(place);
    lay(tb.spine, (b) => centreOf(b, "leaf"));
    tb.spine.forEach(place);
    boxes.push(...tb.spine, ...tb.leaf, ...tb.endpoint);
    const width = Math.max(PAD * 2 + 200, ...boxes.map((b) => b.x + b.w + PAD));
    return { edges, nodes, adj, boxes, pos, ys, width, height: y - TIER_GAP + PAD + 6, byId };
  }, [graph, shown, linkF]);

  const focus = hover ?? sel;
  const near = useMemo(() => {
    if (!focus) return null;
    const s = new Set<string>([focus]);
    for (const e of view.adj.get(focus) ?? []) { s.add(e.a); s.add(e.b); }
    return s;
  }, [focus, view]);

  // Edges in one path per system (thousands of edges stay fast); the focus node's edges drawn on top.
  const paths = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of view.edges) {
      const a = view.pos.get(e.a), b = view.pos.get(e.b);
      if (!a || !b) continue;
      (m.get(e.net) ?? m.set(e.net, []).get(e.net)!).push(`M${a[0].toFixed(1)},${(a[1] - ER).toFixed(1)}L${b[0].toFixed(1)},${(b[1] + NS / 2).toFixed(1)}`);
    }
    return [...m.entries()].map(([net, d]) => ({ net, d: d.join("") }));
  }, [view]);

  const selNode = sel ? view.byId.get(sel) : undefined;
  const selEdges = sel ? [...(view.adj.get(sel) ?? [])].sort((p, q) => q.count - p.count) : [];
  const other = (e: NetEdge, id: string) => view.byId.get(e.a === id ? e.b : e.a);
  const kindName = (n: NetNode) => (n.kind === "endpoint" ? "Endpoint" : n.kind === "leaf" ? "Leaf switch" : "Spine switch");

  if (!view.nodes.length) return <Hint>No nodes for this selection.</Hint>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Edges</span>
        {([["all", "All"], ["access", "Endpoint → leaf"], ["uplink", "Leaf → spine"]] as const).map(([k, l]) => (
          <Btn key={k} on={linkF === k} onClick={() => setLinkF(k)}>{l}</Btn>
        ))}
        <span className="ml-auto font-mono text-muted-foreground">{n0(view.nodes.length)} nodes · {n0(view.edges.length)} edges · {n0(view.edges.reduce((a, e) => a + e.count, 0))} cables</span>
      </div>
      <div className="overflow-auto rounded-md border bg-background" style={{ maxHeight: "70vh" }}>
        <svg width={view.width} height={view.height} viewBox={`0 0 ${view.width} ${view.height}`} className="block" role="img" aria-label="Network graph" onClick={() => setSel(null)}>
          {(Object.keys(view.ys) as NetNodeKind[]).map((t) => (
            <text key={t} x={8} y={view.ys[t] - 6} fontSize={10} fontWeight={600} fill="var(--muted-foreground)">{TIER_LABEL[t]}</text>
          ))}
          {view.boxes.map((b) => (
            <g key={b.tier + b.rack.id}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill="var(--card)" stroke="var(--border)" />
              <text x={b.x + CP} y={b.y + 12} fontSize={10} fontWeight={600} fill="var(--foreground)">{b.rack.name}</text>
            </g>
          ))}
          {paths.map(({ net, d }) => (
            <path key={net} d={d} fill="none" stroke={netById(nets, net).color} strokeWidth={0.7} strokeOpacity={focus ? 0.06 : 0.3} pointerEvents="none" />
          ))}
          {focus && (view.adj.get(focus) ?? []).map((e) => {
            const a = view.pos.get(e.a), b = view.pos.get(e.b);
            if (!a || !b) return null;
            return (
              <line key={e.id} x1={a[0]} y1={a[1] - ER} x2={b[0]} y2={b[1] + NS / 2} stroke={netById(nets, e.net).color}
                strokeWidth={Math.min(5, 1 + Math.log2(1 + e.count) * 0.5)} strokeOpacity={0.95} strokeDasharray={e.via === "direct" ? "4 3" : undefined} pointerEvents="none" />
            );
          })}
          {view.nodes.map((n) => {
            const p = view.pos.get(n.id);
            if (!p) return null;
            const dim = near && !near.has(n.id), on = n.id === focus;
            const color = n.kind === "endpoint" ? undefined : netById(nets, n.nets[0]).color;
            return (
              <g key={n.id} opacity={dim ? 0.3 : 1} style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                onClick={(ev) => { ev.stopPropagation(); setSel(n.id === sel ? null : n.id); }}>
                {n.kind === "endpoint"
                  ? <circle cx={p[0]} cy={p[1]} r={ER} fill={`var(--rl-cat-${lib[n.lib]?.cat ?? "compute"})`} stroke={on ? "var(--rl-accent)" : "var(--foreground)"} strokeWidth={on ? 2.2 : 0.9} />
                  : <rect x={p[0] - NS / 2} y={p[1] - NS / 2} width={NS} height={NS} rx={n.kind === "spine" ? 0 : 1.5} transform={n.kind === "spine" ? `rotate(45 ${p[0]} ${p[1]})` : undefined}
                      fill={n.placeholder ? "var(--card)" : color} stroke={on ? "var(--rl-accent)" : n.placeholder ? color : "var(--foreground)"} strokeWidth={on ? 2.2 : 0.6} strokeDasharray={n.placeholder ? "2 1.5" : undefined} />}
                <title>{`${n.label} · ${kindName(n)}${n.lib ? ` · ${lib[n.lib]?.name ?? n.lib}` : ""} · ${(view.adj.get(n.id) ?? []).length} edges`}</title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--rl-cat-compute)" stroke="currentColor" /></svg>endpoint device</span>
        <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1.5" fill="currentColor" /></svg>leaf switch</span>
        <span className="flex items-center gap-1"><svg width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="6" height="6" transform="rotate(45 6 6)" fill="currentColor" /></svg>spine switch</span>
        <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeDasharray="2 1.5" /></svg>rack with untagged switches</span>
        <span>Colour = network system. Hover a node to trace its edges; click to list them.</span>
      </div>

      {selNode && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold">{selNode.label}</span>
            <Chip tone="mute">{kindName(selNode)}</Chip>
            <span className="text-xs text-muted-foreground">{selNode.lib ? lib[selNode.lib]?.name : "switches not tagged to a system"} · rack {selNode.rack.name} · {selNode.nets.map((x) => netById(nets, x).name).join(", ")}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{selEdges.length} edges · {n0(selEdges.reduce((a, e) => a + e.count, 0))} cables</span>
          </div>
          <Table head={["Connects to", "Rack", "System", "Cable", "Cables", "Length", "Route"]} numeric={[4, 5]}>
            {selEdges.map((e) => {
              const o = other(e, selNode.id);
              return (
                <tr key={e.id}>
                  <td><button type="button" className="hover:underline" onClick={() => o && setSel(o.id)}>{o?.label}</button></td>
                  <td>{o?.rack.name}</td>
                  <td><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: netById(nets, e.net).color }} />{netById(nets, e.net).name}</td>
                  <td>{CABLE_T[e.type].name}</td>
                  <td className="n">{n0(e.count)}</td><td className="n">{fLen(e.len, units)}</td>
                  <td>{e.via === "direct" ? <Chip tone="warn">no tray path</Chip> : e.via}</td>
                </tr>
              );
            })}
          </Table>
        </div>
      )}
    </div>
  );
}
