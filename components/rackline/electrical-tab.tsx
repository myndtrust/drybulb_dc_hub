"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { ELEC_F, ELEC_T } from "@/lib/rackline/constants";
import { autoLayoutElectrical, defaultElectrical, uid } from "@/lib/rackline/model";
import { n0, n1, pct } from "@/lib/rackline/format";
import type { ElecNode, ElecType } from "@/lib/rackline/types";
import type { TabProps } from "./shared";
import { Btn, Hint, KV, Label, NumField, Section, Table, TextField, UtilChip } from "./ui";

const NW = 170, NH = 74;
type V = { tx: number; ty: number; z: number };

function Sym({ t, cx, cy }: { t: ElecType; cx: number; cy: number }) {
  const s = { stroke: "var(--foreground)", strokeWidth: 1.5, fill: "none" };
  switch (t) {
    case "utility": return <path {...s} d={`M${cx - 10} ${cy + 8}L${cx} ${cy - 10}L${cx + 10} ${cy + 8}Z`} />;
    case "xfmr": return <><circle {...s} cx={cx} cy={cy - 6} r={9} /><circle {...s} cx={cx} cy={cy + 6} r={9} /></>;
    case "gen":
    case "mech": return <><circle {...s} cx={cx} cy={cy} r={11} /><text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--foreground)">{t === "gen" ? "G" : "M"}</text></>;
    case "switch":
    case "ats": return <><path {...s} d={`M${cx} ${cy - 12}V${cy - 5}L${cx + 9} ${cy + 5}M${cx} ${cy + 5}V${cy + 12}`} />{t === "ats" && <path {...s} d={`M${cx - 10} ${cy - 12}H${cx + 10}`} />}</>;
    case "ups": return <><rect {...s} x={cx - 12} y={cy - 11} width={24} height={22} /><path {...s} d={`M${cx - 12} ${cy + 11}L${cx + 12} ${cy - 11}M${cx - 9} ${cy - 5}q3 -4 6 0M${cx + 2} ${cy + 6}h7`} /></>;
    case "swbd":
    case "rpp":
    case "busway": return <path {...s} strokeWidth={4} d={`M${cx - 14} ${cy}H${cx + 14}`} />;
    default: return <rect {...s} x={cx - 10} y={cy - 8} width={20} height={16} />;
  }
}

/** Defaults for a newly added node. */
function newNode(t: ElecType, name: string, x: number, y: number): ElecNode {
  const n: ElecNode = { id: "n" + uid(), type: t, name, x, y, v: 415 };
  if (t === "xfmr") Object.assign(n, { kva: 2500, vp: 12470, z: 5.75 });
  if (t === "ups") Object.assign(n, { kva: 500, eff: 0.96 });
  if (["rpp", "swbd", "busway", "ats", "mech"].includes(t)) n.amps = 400;
  if (t === "gen") n.kva = 2000;
  if (t === "utility") Object.assign(n, { v: 12470, scc: 0 });
  if (t === "switch") Object.assign(n, { v: 12470, amps: 600 });
  if (t === "mech") n.auto = false;
  if (t === "load") n.kw = 0;
  return n;
}

export function ElectricalTab(p: TabProps) {
  const { scenario: S, an, commit, live, beginLive, endLive } = p;
  const svgRef = useRef<SVGSVGElement>(null);
  const [v, setV] = useState<V>({ tx: 30, ty: 30, z: 1 });
  const [sel, setSel] = useState<string | null>(null);
  const [connMode, setConnMode] = useState(false);
  const [connFrom, setConnFrom] = useState<string | null>(null);
  const drag = useRef<{ k: "pan"; sx: number; sy: number; tx: number; ty: number } | { k: "node"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const E = S.electrical, R = an.elec;
  const node = E.nodes.find((n) => n.id === sel), link = E.links.find((l) => l.id === sel);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    if (!svg || !E.nodes.length) return;
    const xs = E.nodes.map((n) => n.x), ys = E.nodes.map((n) => n.y);
    const x0 = Math.min(...xs) - 30, x1 = Math.max(...xs) + NW + 30, y0 = Math.min(...ys) - 30, y1 = Math.max(...ys) + NH + 170;
    const W = svg.clientWidth || 800, H = svg.clientHeight || 600;
    const z = Math.max(0.2, Math.min(1.4, Math.min(W / (x1 - x0), H / (y1 - y0))));
    setV({ z, tx: (W - (x1 - x0) * z) / 2 - x0 * z, ty: (H - (y1 - y0) * z) / 2 - y0 * z });
  }, [E.nodes]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fit(); }, []);

  const zoom = useCallback((f: number, cx: number, cy: number) => {
    setV((o) => {
      const nz = Math.max(0.2, Math.min(4, o.z * f)), wx = (cx - o.tx) / o.z, wy = (cy - o.ty) / o.z;
      return { z: nz, tx: cx - wx * nz, ty: cy - wy * nz };
    });
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoom]);

  const del = useCallback(() => {
    if (node) {
      const id = node.id;
      commit((_p, s) => {
        s.electrical.nodes = s.electrical.nodes.filter((n) => n.id !== id);
        s.electrical.links = s.electrical.links.filter((l) => l.from !== id && l.to !== id);
        s.racks.forEach((r) => { if (r.feedA === id) r.feedA = null; if (r.feedB === id) r.feedB = null; });
      });
    } else if (link) {
      const id = link.id;
      commit((_p, s) => { s.electrical.links = s.electrical.links.filter((l) => l.id !== id); });
    }
    setSel(null);
  }, [node, link, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); del(); }
      if (e.key === "Escape") { setConnFrom(null); setConnMode(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, del]);

  const toW = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - v.tx) / v.z, (e.clientY - r.top - v.ty) / v.z];
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    const t = e.target as Element;
    const nd = t.closest("[data-node]") as HTMLElement | null, lk = t.closest("[data-link]") as HTMLElement | null;
    if (nd && e.button === 0) {
      const id = nd.dataset.node!;
      if (connMode || connFrom) {
        if (!connFrom) { setConnFrom(id); return; }
        const from = connFrom;
        if (from !== id && !E.links.some((l) => l.from === from && l.to === id))
          commit((_p, s) => { s.electrical.links.push({ id: uid(), from, to: id }); });
        setConnFrom(null);
        setConnMode(false);
        return;
      }
      setSel(id);
      const n = E.nodes.find((q) => q.id === id)!;
      const w = toW(e);
      beginLive();
      drag.current = { k: "node", id, sx: w[0], sy: w[1], ox: n.x, oy: n.y, moved: false };
      return;
    }
    if (lk) { setSel(lk.dataset.link!); return; }
    setSel(null);
    drag.current = { k: "pan", sx: e.clientX, sy: e.clientY, tx: v.tx, ty: v.ty };
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.k === "pan") { setV({ ...v, tx: d.tx + e.clientX - d.sx, ty: d.ty + e.clientY - d.sy }); return; }
    const w = toW(e);
    d.moved = true;
    live((_p, s) => {
      const n = s.electrical.nodes.find((q) => q.id === d.id);
      if (n) { n.x = Math.round((d.ox + w[0] - d.sx) / 10) * 10; n.y = Math.round((d.oy + w[1] - d.sy) / 10) * 10; }
    });
  };
  const onUp = () => { const d = drag.current; drag.current = null; if (d?.k === "node") endLive(d.moved); };

  const add = (t: ElecType) => {
    const svg = svgRef.current;
    const W = svg?.clientWidth ?? 800, H = svg?.clientHeight ?? 600;
    let x = Math.round(((W / 2 - v.tx) / v.z - NW / 2) / 10) * 10;
    const y = Math.round(((H / 2 - v.ty) / v.z - NH / 2) / 10) * 10;
    // Step right until the new card does not cover an existing one.
    while (E.nodes.some((q) => Math.abs(q.x - x) < NW + 10 && Math.abs(q.y - y) < NH + 10)) x += NW + 20;
    const n = newNode(t, `${ELEC_T[t].name} ${E.nodes.filter((q) => q.type === t).length + 1}`, x, y);
    commit((_p, s) => { s.electrical.nodes.push(n); });
    setSel(n.id);
  };

  const by = new Map(E.nodes.map((n) => [n.id, n]));
  const r = node ? R[node.id] : undefined;
  const loaded = Object.values(R).filter((x) => x.cap);

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Add equipment">
          <div className="grid grid-cols-3 gap-1">
            {(Object.entries(ELEC_T) as [ElecType, { name: string }][]).map(([k, t]) => <Btn key={k} onClick={() => add(k)}>{t.name}</Btn>)}
          </div>
          <div className="flex flex-wrap gap-1">
            <Btn on={connMode || !!connFrom} onClick={() => { setConnMode(!(connMode || connFrom)); setConnFrom(null); }}>Connect</Btn>
            <Btn onClick={() => commit((_p, s) => autoLayoutElectrical(s.electrical))}>Auto-arrange</Btn>
            <Btn tone="danger" onClick={() => { commit((_p, s) => { s.electrical = defaultElectrical(); s.racks.forEach((q) => { q.feedA = "rppa"; q.feedB = "rppb"; }); }); setSel(null); }}>Reset to default 2N</Btn>
          </div>
          <Hint>Connect: click upstream then downstream. Racks attach through their feed A and B sources (Power striping tab). Design load is the worst of normal, A-feed lost and B-feed lost.</Hint>
        </Section>

        {node && (
          <Section title={ELEC_T[node.type].name}>
            <KV>
              <Label htmlFor="rl-n-name">Name</Label>
              <TextField id="rl-n-name" value={node.name} onChange={(val) => commit((_p, s) => { s.electrical.nodes.find((q) => q.id === node.id)!.name = val; })} />
              {ELEC_T[node.type].f.map((f) => (
                f === "auto" ? (
                  <Fragment key={f}>
                    <Label htmlFor="rl-n-auto">{ELEC_F.auto}</Label>
                    <input id="rl-n-auto" type="checkbox" checked={!!node.auto} onChange={(e) => { const on = e.target.checked; commit((_p, s) => { s.electrical.nodes.find((q) => q.id === node.id)!.auto = on; }); }} />
                  </Fragment>
                ) : (
                  <Fragment key={f}>
                    <Label htmlFor={"rl-n-" + f}>{ELEC_F[f]}</Label>
                    <NumField id={"rl-n-" + f} value={(node[f] as number | undefined) ?? 0} onChange={(val) => commit((_p, s) => { (s.electrical.nodes.find((q) => q.id === node.id)! as unknown as Record<string, number>)[f] = val; })} />
                  </Fragment>
                )
              ))}
            </KV>
            <KV>
              <Label>Normal</Label><span className="font-mono text-xs">{n0(r?.nl ?? 0)} kVA</span>
              <Label>A lost</Label><span className="font-mono text-xs">{n0(r?.a ?? 0)} kVA</span>
              <Label>B lost</Label><span className="font-mono text-xs">{n0(r?.b ?? 0)} kVA</span>
              <Label>Capacity</Label><span className="font-mono text-xs">{r?.cap ? n0(r.cap) + " kVA" : "—"}</span>
              <Label>Design utilisation</Label><span>{r?.cap ? <UtilChip u={r.util} /> : "—"}</span>
              {r?.isc != null && <><Label>Secondary fault</Label><span className="font-mono text-xs">{n1(r.isc)} kA sym</span></>}
            </KV>
            <Btn tone="danger" onClick={del}>Delete</Btn>
          </Section>
        )}
        {link && (
          <Section title="Connection">
            <Hint>{by.get(link.from)?.name} → {by.get(link.to)?.name}</Hint>
            <Btn tone="danger" onClick={del}>Delete connection</Btn>
          </Section>
        )}

        <Section title="Loading summary">
          <Table head={["Equipment", "kVA design / cap", ""]} numeric={[1, 2]}>
            {loaded.map((x) => <tr key={x.n.id}><td>{x.n.name}</td><td className="n">{n0(x.design)}/{n0(x.cap!)}</td><td className="n"><UtilChip u={x.util} /></td></tr>)}
          </Table>
          <Hint>Panels and switchboards carry the continuous derate.</Hint>
        </Section>
      </aside>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--rl-canvas)]">
        <svg ref={svgRef} className="block h-full w-full touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <g transform={`translate(${v.tx},${v.ty}) scale(${v.z})`}>
            {E.links.map((l) => {
              const a = by.get(l.from), b = by.get(l.to);
              if (!a || !b) return null;
              const x1 = a.x + NW / 2, y1 = a.y + NH, x2 = b.x + NW / 2, y2 = b.y, my = y1 + (y2 - y1) / 2;
              const d = `M${x1} ${y1}V${my}H${x2}V${y2}`;
              return (
                <g key={l.id}>
                  <path d={d} fill="none" stroke={sel === l.id ? "var(--rl-accent)" : "var(--foreground)"} strokeWidth={sel === l.id ? 3 : 1.6} />
                  <path d={d} data-link={l.id} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }} />
                </g>
              );
            })}
            {E.nodes.map((n) => {
              const x = R[n.id];
              const util = x?.util ?? 0;
              const cl = util > 1 ? "var(--rl-bad)" : util > 0.8 ? "var(--rl-warn)" : "var(--rl-ok)";
              const rating = n.kva ? `${n0(n.kva)} kVA` : n.amps ? `${n0(n.amps)} A` : "";
              const volt = n.v ? (n.v >= 1000 ? (n.v / 1000).toFixed(2) + " kV" : n.v + " V") : "";
              const racks = x?.racks ?? [];
              return (
                <g key={n.id}>
                  <g data-node={n.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: "move" }}>
                    <rect width={NW} height={NH} rx={4} fill="var(--card)" stroke={sel === n.id ? "var(--rl-accent)" : "var(--border)"} strokeWidth={sel === n.id ? 2 : 1} />
                    <Sym t={n.type} cx={22} cy={NH / 2} />
                    <text x={42} y={19} fontSize={13} fontWeight={600} fill="var(--foreground)">{n.name.length > 18 ? n.name.slice(0, 17) + "…" : n.name}</text>
                    <text x={42} y={34} fontSize={10.5} fill="var(--muted-foreground)" className="font-mono">{[rating, volt].filter(Boolean).join(" · ")}{n.type === "xfmr" && n.z ? ` · ${n.z}%Z` : ""}</text>
                    <text x={42} y={49} fontSize={10.5} fill="var(--muted-foreground)" className="font-mono">{x ? `${n0(x.design)} kVA design` : ""}</text>
                    {x?.cap ? (
                      <>
                        <rect x={42} y={56} width={NW - 54} height={5} rx={2} fill="var(--muted)" />
                        <rect x={42} y={56} width={Math.min(1, util) * (NW - 54)} height={5} rx={2} fill={cl} />
                        <text x={NW - 8} y={70} textAnchor="end" fontSize={10.5} fill="var(--muted-foreground)" className="font-mono">{pct(util)}</text>
                      </>
                    ) : null}
                    {x?.isc != null && <text x={42} y={70} fontSize={10.5} fill="var(--muted-foreground)" className="font-mono">Isc {n1(x.isc)} kA</text>}
                    {connFrom === n.id && <rect width={NW} height={NH} rx={4} fill="none" stroke="var(--rl-accent)" strokeWidth={3} strokeDasharray="5 3" />}
                  </g>
                  {racks.length > 0 && (() => {
                    const lines = racks.slice(0, 10), bh = 14 + lines.length * 13 + (racks.length > 10 ? 13 : 0);
                    return (
                      <g transform={`translate(${n.x + 10},${n.y + NH + 8})`} pointerEvents="none">
                        <path d={`M${NW / 2 - 10} -8V0`} stroke="var(--foreground)" strokeDasharray="3 2" />
                        <rect width={NW - 20} height={bh} rx={3} fill="var(--rl-canvas)" stroke="var(--border)" strokeDasharray="3 2" />
                        {lines.map((q, i) => (
                          <text key={i} x={8} y={17 + i * 13} fontSize={10.5} fill="var(--muted-foreground)" className="font-mono">
                            <tspan fill={`var(--rl-feed${q.f})`}>{q.f}</tspan> {q.x.r.name} · {n1(q.x.it / 2)} / {n1(q.x.it)} kW
                          </text>
                        ))}
                        {racks.length > 10 && <text x={8} y={17 + 10 * 13} fontSize={10.5} fill="var(--muted-foreground)">+{racks.length - 10} more</text>}
                      </g>
                    );
                  })()}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="absolute right-2.5 top-2.5 flex gap-1">
          <Btn aria-label="Zoom in" onClick={() => zoom(1.25, (svgRef.current?.clientWidth ?? 800) / 2, (svgRef.current?.clientHeight ?? 600) / 2)}>+</Btn>
          <Btn aria-label="Zoom out" onClick={() => zoom(0.8, (svgRef.current?.clientWidth ?? 800) / 2, (svgRef.current?.clientHeight ?? 600) / 2)}>−</Btn>
          <Btn onClick={fit}>Fit</Btn>
        </div>
        {(connMode || connFrom) && (
          <div className="absolute left-1/2 top-2.5 -translate-x-1/2 rounded bg-foreground px-2.5 py-1 text-xs text-background">
            {connFrom ? "Click the downstream equipment to connect." : "Click the upstream equipment."}
          </div>
        )}
      </div>
    </>
  );
}
