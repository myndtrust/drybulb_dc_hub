"use client";

import { useMemo, useState } from "react";
import { CABLE_T } from "@/lib/rackline/constants";
import { fLen, fTotalLen, fileSafe, n0 } from "@/lib/rackline/format";
import { clone, uid } from "@/lib/rackline/model";
import { DEFAULT_NETS, NET_COLORS, guessNet, netById, netGraph, netSummaries, netSystems, servedRacks, tierOf } from "@/lib/rackline/network";
import type { CableGroup, CableType, NetSystem, NetTier, Rack } from "@/lib/rackline/types";
import type { TabProps } from "./shared";
import { NetGraphView } from "./net-graph";
import { Btn, Chip, Hint, Panel, Section, Seg, Table, TextField, UtilChip } from "./ui";

const CABLES = Object.keys(CABLE_T) as CableType[];
const SHORT: Record<CableType, string> = { fabric: "Fabric", storage: "Storage", mgmt: "Mgmt", bmc: "BMC / OOB" };
const TIERS: [NetTier, string][] = [["leaf", "Leaf"], ["spine", "Spine"]];

interface Edge { from: Rack; to: Rack; net: string; link: CableGroup["link"]; count: number; len: number; via: CableGroup["via"] }

export function NetworkTab(p: TabProps & { download: (name: string, data: string, type: string) => void }) {
  const { project, scenario: S, an, lib, commit, goTab, download } = p;
  const units = project.units;
  const nets = netSystems(S);
  const sums = useMemo(() => netSummaries(S, lib, an.cab.groups), [S, lib, an]);
  const [show, setShow] = useState<string>("all");
  const shown = sums.filter((n) => show === "all" || n.sys.id === show);
  const shownIds = new Set(shown.map((n) => n.sys.id));
  const sysIx = new Map(sums.map((n, i) => [n.sys.id, i]));

  /** Edit the scenario's systems (the defaults are copied in on the first edit). */
  const editNets = (fn: (n: NetSystem[], s: typeof S) => void) => commit((_p, s) => {
    if (!s.nets?.length) s.nets = clone(DEFAULT_NETS);
    fn(s.nets, s);
  });
  const editSys = (id: string, fn: (n: NetSystem) => void) => editNets((l) => { const x = l.find((q) => q.id === id); if (x) fn(x); });

  // ── Switch groups (rack × model × system × tier) ──────────────────────────
  const swGroups = useMemo(() => {
    const m = new Map<string, { r: Rack; name: string; net: string; tier: NetTier; ids: string[] }>();
    for (const r of S.racks) for (const d of r.devs) {
      const L = lib[d.lib];
      if (L?.cat !== "network") continue;
      const k = [r.id, d.lib, d.net ?? "", tierOf(d.tier)].join("|");
      const g = m.get(k) ?? m.set(k, { r, name: L.name, net: d.net ?? "", tier: tierOf(d.tier), ids: [] }).get(k)!;
      g.ids.push(d.id);
    }
    return [...m.values()].sort((a, b) => a.r.name.localeCompare(b.r.name, undefined, { numeric: true }));
  }, [S, lib]);
  const untagged = swGroups.filter((g) => !g.net || !nets.some((n) => n.id === g.net)).reduce((a, g) => a + g.ids.length, 0);
  const tagDevs = (ids: string[], f: { net?: string; tier?: NetTier }) => commit((_p, s) => {
    const set = new Set(ids);
    for (const r of s.racks) for (const d of r.devs) if (set.has(d.id)) {
      if ("net" in f) { if (f.net) d.net = f.net; else delete d.net; }
      if (f.tier) d.tier = f.tier;
    }
  });
  const autoTag = () => commit((_p, s) => {
    const ns = netSystems(s);
    for (const r of s.racks) for (const d of r.devs) {
      const L = lib[d.lib];
      if (L?.cat !== "network" || (d.net && ns.some((n) => n.id === d.net))) continue;
      const g = guessNet(L, r, ns);
      if (g) { d.net = g.net; d.tier = g.tier; }
    }
  });

  // ── Graph model (every switch and endpoint device a node) and rack-to-rack links ──
  const graph = useMemo(() => netGraph(S, lib, an.cab.groups), [S, lib, an]);
  const links = useMemo(() => {
    const m = new Map<string, Edge>();
    for (const g of an.cab.groups) {
      if (!shownIds.has(g.net)) continue;
      const k = [g.from.id, g.to.id, g.net, g.link].join("|");
      const e = m.get(k);
      if (e) { e.count += g.count; e.len = Math.max(e.len, g.len); if (g.via === "direct") e.via = "direct"; }
      else m.set(k, { from: g.from, to: g.to, net: g.net, link: g.link, count: g.count, len: g.len, via: g.via });
    }
    return [...m.values()].sort((a, b) =>
      (sysIx.get(a.net) ?? 0) - (sysIx.get(b.net) ?? 0) || a.link.localeCompare(b.link) || a.from.name.localeCompare(b.from.name, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [an, show]);
  const exportGraph = () => {
    const nodes = graph.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, rack: n.rack.name, model: n.lib ? lib[n.lib]?.name ?? n.lib : null, systems: n.nets.map((x) => netById(nets, x).name) }));
    const edges = graph.edges.map((e) => ({ source: e.a, target: e.b, system: netById(nets, e.net).name, link: e.link, cableType: e.type, cables: e.count, lengthM: +e.len.toFixed(2), route: e.via }));
    download(`${fileSafe(S.name)}_network_graph.json`, JSON.stringify({ scenario: S.name, systems: nets, nodes, edges }, null, 1), "application/json");
  };
  const netRacks = S.racks.filter((r) => r.role === "network");

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Network systems">
          {nets.map((n) => {
            const served = servedRacks(S, lib, n);
            return (
              <div key={n.id} className="space-y-1.5 rounded-md border p-2" style={{ borderLeft: `4px solid ${n.color}` }}>
                <div className="flex items-center gap-1.5">
                  <input type="color" aria-label={`${n.name} colour`} value={n.color} onChange={(e) => editSys(n.id, (x) => { x.color = e.target.value; })} className="h-6 w-7 shrink-0 cursor-pointer rounded border border-input bg-background p-0" />
                  <TextField label="System name" width="w-full" value={n.name} onChange={(v) => editSys(n.id, (x) => { x.name = v || x.name; })} />
                  <Btn tone="danger" title="Remove this system" aria-label={`Remove ${n.name}`} disabled={nets.length < 2} onClick={() => editNets((l, s) => {
                    s.nets = l.filter((x) => x.id !== n.id);
                    for (const r of s.racks) for (const d of r.devs) if (d.net === n.id) { delete d.net; delete d.tier; }
                  })}>×</Btn>
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label={`Cables carried by ${n.name}`}>
                  {CABLES.map((t) => (
                    <Btn key={t} on={n.cables.includes(t)} title={CABLE_T[t].name} aria-pressed={n.cables.includes(t)} onClick={() => editNets((l) => {
                      const x = l.find((q) => q.id === n.id)!;
                      if (x.cables.includes(t)) x.cables = x.cables.filter((c) => c !== t);
                      else { for (const o of l) o.cables = o.cables.filter((c) => c !== t); x.cables.push(t); }
                    })}>{SHORT[t]}</Btn>
                  ))}
                </div>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Leaf racks: {n.racks.length ? served.map((r) => r.name).join(", ") : <>auto ({served.length ? served.map((r) => r.name).join(", ") : "none"})</>}
                  </summary>
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {netRacks.map((r) => (
                      <label key={r.id} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={n.racks.includes(r.id)} onChange={(e) => editSys(n.id, (x) => {
                          x.racks = e.target.checked ? [...x.racks, r.id] : x.racks.filter((id) => id !== r.id);
                        })} />{r.name}
                      </label>
                    ))}
                  </div>
                  <Hint>None ticked: the racks holding this system&apos;s leaf switches, else every network rack.</Hint>
                </details>
                <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  Endpoint racks attach to
                  <select value={n.attach ?? "nearest"} aria-label={`How endpoint racks attach to ${n.name}`}
                    onChange={(e) => editSys(n.id, (x) => { x.attach = e.target.value as NonNullable<NetSystem["attach"]>; })}
                    className="rounded-md border border-input bg-background px-1 py-0.5 text-xs text-foreground">
                    <option value="nearest">Nearest leaf rack</option>
                    <option value="spread">Every leaf rack (rail-optimised)</option>
                  </select>
                </label>
                <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  Uplinks per endpoint cable
                  <input type="number" min={0} max={2} step={0.05} value={n.uplink} aria-label={`${n.name} uplinks per endpoint cable`}
                    onChange={(e) => { const v = +e.target.value; if (Number.isFinite(v) && v >= 0) editSys(n.id, (x) => { x.uplink = v; }); }}
                    className="w-20 rounded-md border border-input bg-background px-2 py-0.5 text-right font-mono text-xs" />
                </label>
              </div>
            );
          })}
          <div className="flex gap-1">
            <Btn onClick={() => editNets((l) => { l.push({ id: "net-" + uid(), name: `Network ${l.length + 1}`, color: NET_COLORS[l.length % NET_COLORS.length], cables: [], racks: [], uplink: 1 }); })}>Add network system</Btn>
            {S.nets?.length ? <Btn title="Back to one system per cable type" onClick={() => commit((_p, s) => { delete s.nets; })}>Reset</Btn> : null}
          </div>
          <Hint>Each cable type belongs to one system. Its endpoint cables run to the nearest of its leaf racks; uplinks (1 = non-blocking) run from those leaf racks to the racks holding its spine switches. Routes and lengths are the Cable pathways tab&apos;s.</Hint>
        </Section>

        <Section title="Switches">
          {untagged > 0 && (
            <div className="space-y-1 rounded-md border border-[var(--rl-warn)] bg-[var(--rl-warn-soft)] p-2">
              <Hint className="text-foreground">{untagged} switch{untagged > 1 ? "es are" : " is"} in no system.</Hint>
              <Btn onClick={autoTag}>Assign by model name</Btn>
            </div>
          )}
          {swGroups.length ? (
            <div className="space-y-1">
              {swGroups.map((g) => (
                <div key={g.r.id + g.name + g.net + g.tier} className="rounded border px-1.5 py-1 text-xs">
                  <div className="flex justify-between gap-2"><span className="font-medium">{g.r.name}</span><span className="font-mono text-muted-foreground">×{g.ids.length}</span></div>
                  <div className="truncate text-[11px] text-muted-foreground" title={g.name}>{g.name}</div>
                  <div className="mt-1 flex gap-1">
                    <select aria-label={`System for ${g.name} in ${g.r.name}`} value={nets.some((n) => n.id === g.net) ? g.net : ""} onChange={(e) => tagDevs(g.ids, { net: e.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-1 py-0.5 text-xs">
                      <option value="">No system</option>
                      {nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                    <select aria-label={`Tier for ${g.name} in ${g.r.name}`} value={g.tier} onChange={(e) => tagDevs(g.ids, { tier: e.target.value as NetTier })}
                      className="rounded-md border border-input bg-background px-1 py-0.5 text-xs">
                      {TIERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          ) : <Hint>No switches. Add network gear to a network rack on the Rack elevations tab.</Hint>}
          <Hint>Changes apply to every switch in the group. Set one switch on its own from Rack elevations → Selected device.</Hint>
        </Section>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto bg-[var(--rl-canvas)] p-4">
        <div className="flex max-w-full items-center gap-2 overflow-x-auto">
          <span className="text-xs text-muted-foreground">Show</span>
          <Seg value={show} onChange={setShow} options={[["all", "All systems"], ...sums.map((n): [string, string] => [n.sys.id, n.sys.name])]} />
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-2.5">
          {shown.map((n) => (
            <div key={n.sys.id} className="rounded-lg border bg-card px-3 py-2.5" style={{ borderTop: `4px solid ${n.sys.color}` }}>
              <div className="text-sm font-semibold">{n.sys.name}</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums">
                <span className="text-muted-foreground">Endpoint racks</span><span className="text-right">{n.endpoints}</span>
                <span className="text-muted-foreground">Leaf switches</span><span className="text-right">{n.leaves} in {n.leafRacks.length} rack{n.leafRacks.length === 1 ? "" : "s"}</span>
                <span className="text-muted-foreground">Spine switches</span><span className="text-right">{n.spines}</span>
                <span className="text-muted-foreground">Endpoint cables</span><span className="text-right">{n0(n.access)}</span>
                <span className="text-muted-foreground">Uplinks</span><span className="text-right">{n0(n.uplink)}</span>
                <span className="text-muted-foreground">Cable length</span><span className="text-right">{fTotalLen(n.length, units)}</span>
                <span className="text-muted-foreground">Leaf ports used</span>
                <span className="text-right">{n.leafPorts ? <UtilChip u={(n.access + n.uplink) / n.leafPorts} label={`${n0(n.access + n.uplink)} / ${n0(n.leafPorts)}`} /> : "—"}</span>
              </div>
              {n.noPath > 0 && <div className="mt-1"><Chip tone="warn">{n.noPath} without tray path</Chip></div>}
            </div>
          ))}
        </div>

        <Panel title="Topology graph" right={<Btn onClick={exportGraph}>Export graph JSON</Btn>}>
          {graph.nodes.length ? <NetGraphView graph={graph} nets={nets} shown={shownIds} lib={lib} units={units} /> : (
            <Hint>No links yet. {netRacks.length ? "Add equipment with network ports to racks." : <>Set a rack&apos;s role to <b>network</b> on the Layout tab, then add switches.</>}</Hint>
          )}
          <Hint>Each endpoint device&apos;s cables are dealt round robin over its leaf rack&apos;s leaf switches; each leaf rack&apos;s uplinks are spread evenly over the spine switches (a full leaf–spine mesh). Edge counts add up to the Cable pathways schedule.</Hint>
        </Panel>

        <Panel title="Links" right={<Btn onClick={() => goTab("cables")}>Cable pathways</Btn>}>
          <Table head={["System", "From", "To", "Link", "Cables", "Longest", "Route"]} numeric={[4, 5]}>
            {links.map((e, i) => {
              const sys = netById(nets, e.net);
              return (
                <tr key={i}>
                  <td><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: sys.color }} />{sys.name}</td>
                  <td>{e.from.name}</td><td>{e.to.name}</td><td>{e.link === "uplink" ? "Leaf → spine" : "Endpoint → leaf"}</td>
                  <td className="n">{n0(e.count)}</td><td className="n">{fLen(e.len, units)}</td>
                  <td>{e.via === "direct" ? <Chip tone="warn">no tray path</Chip> : e.via}</td>
                </tr>
              );
            })}
          </Table>
          <Hint>Port check counts cables, not speeds: a breakout counts as one port per cable. An uplink ratio of 1 is non-blocking (one uplink per endpoint cable); 0.33 is 3:1 oversubscribed.</Hint>
        </Panel>
      </div>
    </>
  );
}
