"use client";

import { useMemo, useState } from "react";
import { DEF_LIB } from "@/lib/rackline/constants";
import { rackRows } from "@/lib/rackline/geometry";
import { addDevice, autoStripe, fits, uid } from "@/lib/rackline/model";
import { n1, pct } from "@/lib/rackline/format";
import { guessNet, netSystems, tierOf } from "@/lib/rackline/network";
import type { Device, DeviceCat, LibItem, NetTier, Rack, Scenario } from "@/lib/rackline/types";
import type { TabProps } from "./shared";
import { Btn, Fold, Hint, KV, Label, NumField, Section, Seg, TextField } from "./ui";

const UH = 12, RW = 210, GAP = 46, TOP = 56;
const CATS: DeviceCat[] = ["compute", "network", "storage", "server", "passive"];
const fromTop = (L: LibItem) => L.cat === "network" || L.cat === "passive";

export function ElevationsTab(p: TabProps) {
  const { project, scenario: S, an, lib, commit, toast, selRack, setSelRack } = p;
  const [face, setFace] = useState<"front" | "rear">("front");
  const [rowPick, setRowPick] = useState(0);
  const [selDev, setSelDev] = useState<string | null>(null);
  const [openLib, setOpenLib] = useState(false);
  const lf = S.loadFactor || 1;

  const rows = useMemo(() => rackRows(S, face), [S, face]);
  // The row follows the selected rack (e.g. "Edit elevation" from the layout).
  const selRow = rows.findIndex((w) => w.racks.some((r) => r.id === selRack));
  const rowIx = Math.max(0, Math.min(selRow >= 0 ? selRow : rowPick, rows.length - 1));
  const row = rows[rowIx];
  const r = row?.racks.find((x) => x.id === selRack) ?? row?.racks[0];
  const x = r ? an.racks.find((a) => a.r.id === r.id) : undefined;
  const dev = r?.devs.find((d) => d.id === selDev);
  const DL = dev ? lib[dev.lib] : undefined;

  const goRow = (i: number) => { setRowPick(i); setSelRack(rows[i].racks[0].id); setSelDev(null); };

  // A new switch joins the network system its model name suggests (changeable on the Network tab).
  const tag = (d: Device, R: Rack, s: Scenario) => {
    const L = lib[d.lib];
    const g = L?.cat === "network" ? guessNet(L, R, netSystems(s)) : undefined;
    if (g) { d.net = g.net; d.tier = g.tier; }
  };
  const addOne = (L: LibItem) => {
    if (!r) return;
    let id: string | null = null;
    commit((_p, s) => {
      const R = s.racks.find((q) => q.id === r.id)!;
      const d = addDevice(R, L.id, lib, fromTop(L));
      if (d) { id = d.id; tag(d, R, s); autoStripe(R, lib, lf); }
    });
    if (id) setSelDev(id); else toast("No free space for that device");
  };
  const addRow = (L: LibItem) => {
    if (!row) return;
    const ids = new Set(row.racks.map((q) => q.id));
    let miss = 0;
    commit((_p, s) => s.racks.forEach((R) => {
      if (!ids.has(R.id)) return;
      const d = addDevice(R, L.id, lib, fromTop(L));
      if (d) { tag(d, R, s); autoStripe(R, lib, lf); } else miss++;
    }));
    toast(miss ? `No space in ${miss} rack${miss > 1 ? "s" : ""}` : `Added to ${row.racks.length} racks`);
  };
  const moveDev = (u: number) => {
    if (!r || !dev || !DL) return;
    if (!fits(r, DL, u, lib, dev.id)) { toast("That position is occupied"); return; }
    commit((_p, s) => { s.racks.find((q) => q.id === r.id)!.devs.find((d) => d.id === dev.id)!.u = u; });
  };
  const editLib = (i: number, fn: (L: LibItem) => void) => commit((pp) => {
    const L = pp.lib[i];
    fn(L);
    // PSU counts may have changed: clear maps so every scenario re-stripes.
    pp.scenarios.forEach((s) => s.racks.forEach((R) => R.devs.forEach((d) => { if (d.lib === L.id) d.map = []; })));
  });
  const inUse = (id: string) => project.scenarios.some((s) => s.racks.some((R) => R.devs.some((d) => d.lib === id)));

  const rowKW = row ? row.racks.reduce((a, R) => a + (an.racks.find((q) => q.r.id === R.id)?.it || 0), 0) : 0;
  const W = 40 + (row?.racks.length ?? 0) * (RW + GAP), H = TOP + 50 * UH + 30;

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Row">
          {rows.length ? (
            <>
              <div className="flex items-center gap-1">
                <Btn aria-label="Previous row" disabled={rowIx <= 0} onClick={() => goRow(rowIx - 1)}>‹</Btn>
                <select aria-label="Row" value={rowIx} onChange={(e) => goRow(+e.target.value)} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm">
                  {rows.map((w, i) => <option key={i} value={i}>{w.name}</option>)}
                </select>
                <Btn aria-label="Next row" disabled={rowIx >= rows.length - 1} onClick={() => goRow(rowIx + 1)}>›</Btn>
              </div>
              <div className="flex items-center gap-2 text-xs"><span className="text-muted-foreground">View from</span>
                <Seg value={face} onChange={setFace} options={[["front", "Front"], ["rear", "Rear"]]} /></div>
              <Hint>Rows come from the layout: racks facing the same way and lined up. Move a rack on the Layout tab to change its row.</Hint>
            </>
          ) : <Hint>No rows yet.</Hint>}
        </Section>

        <Section title="Rack">
          {r && x ? (
            <KV>
              <Label htmlFor="rl-e-r">Rack in row</Label>
              <select id="rl-e-r" value={r.id} onChange={(e) => { setSelRack(e.target.value); setSelDev(null); }} className="w-40 rounded-md border border-input bg-background px-2 py-1 text-sm">
                {row.racks.map((R) => <option key={R.id} value={R.id}>{R.name}</option>)}
              </select>
              <Label htmlFor="rl-e-u">Height (U)</Label>
              <NumField id="rl-e-u" min={20} max={58} step={1} value={r.u} onChange={(v) => commit((_p, s) => { s.racks.find((q) => q.id === r.id)!.u = Math.round(v); })} />
              <Label>Load</Label><span className="font-mono text-xs">{n1(x.it)} kW</span>
              <Label>Free U</Label><span className="font-mono text-xs">{r.u - x.u}</span>
            </KV>
          ) : <Hint>No racks yet. Place racks on the Layout tab.</Hint>}
        </Section>

        {dev && DL && (
          <Section title="Selected device">
            <Hint><b className="text-foreground">{DL.name}</b>, {DL.u}U, {n1(DL.kw)} kW</Hint>
            {DL.kwMaxQ != null && DL.kwMaxP != null && (() => {
              const li = project.lib.findIndex((l) => l.id === DL.id);
              const prof = DL.kw === DL.kwMaxQ ? "maxq" : DL.kw === DL.kwMaxP ? "maxp" : "custom";
              return (
                <div className="space-y-1.5 rounded-md border p-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">Power profile</span>
                    <Seg value={prof} onChange={(v) => { if (v !== "custom") editLib(li, (l) => { l.kw = v === "maxq" ? l.kwMaxQ! : l.kwMaxP!; }); }}
                      options={[["maxq", `Max-Q ${n1(DL.kwMaxQ)}`], ["maxp", `Max-P ${n1(DL.kwMaxP)}`], ...(prof === "custom" ? [["custom", `${n1(DL.kw)} kW`] as ["custom", string]] : [])]} />
                  </div>
                  <KV>
                    <Label htmlFor="rl-e-mq">Max-Q rating (kW)</Label>
                    <NumField id="rl-e-mq" step={1} value={DL.kwMaxQ} onChange={(v) => editLib(li, (l) => { if (l.kw === l.kwMaxQ) l.kw = v; l.kwMaxQ = v; })} />
                    <Label htmlFor="rl-e-mp">Max-P rating (kW)</Label>
                    <NumField id="rl-e-mp" step={1} value={DL.kwMaxP} onChange={(v) => editLib(li, (l) => { if (l.kw === l.kwMaxP) l.kw = v; l.kwMaxP = v; })} />
                  </KV>
                  <Hint>Applies to every {DL.name} in the project; the design load follows the chosen profile.</Hint>
                </div>
              );
            })()}
            <KV>
              <Label htmlFor="rl-e-du">Bottom U</Label><NumField id="rl-e-du" step={1} value={dev.u} onChange={(v) => moveDev(Math.round(v))} />
              {DL.cat === "network" && (
                <>
                  <Label htmlFor="rl-e-net">Network system</Label>
                  <select id="rl-e-net" value={netSystems(S).some((n) => n.id === dev.net) ? dev.net : ""} className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    onChange={(e) => { const v = e.target.value; commit((_p, s) => { const d = s.racks.find((q) => q.id === r!.id)!.devs.find((q) => q.id === dev.id)!; if (v) d.net = v; else delete d.net; }); }}>
                    <option value="">No system</option>
                    {netSystems(S).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                  </select>
                  <Label htmlFor="rl-e-tier">Tier</Label>
                  <select id="rl-e-tier" value={tierOf(dev.tier)} className="w-40 rounded-md border border-input bg-background px-2 py-1 text-xs"
                    onChange={(e) => { const v = e.target.value as NetTier; commit((_p, s) => { s.racks.find((q) => q.id === r!.id)!.devs.find((q) => q.id === dev.id)!.tier = v; }); }}>
                    <option value="leaf">Leaf (takes endpoint cables)</option>
                    <option value="spine">Spine (takes uplinks)</option>
                  </select>
                </>
              )}
            </KV>
            <div className="flex gap-1">
              <Btn onClick={() => moveDev(dev.u + 1)}>Move up</Btn>
              <Btn onClick={() => moveDev(dev.u - 1)}>Move down</Btn>
              <Btn tone="danger" onClick={() => { commit((_p, s) => { const R = s.racks.find((q) => q.id === r!.id)!; R.devs = R.devs.filter((d) => d.id !== dev.id); autoStripe(R, lib, lf); }); setSelDev(null); }}>Remove</Btn>
            </div>
          </Section>
        )}

        <Section title={`Add to ${r ? r.name : "rack"}`}>
          {project.lib.map((L) => (
            <div key={L.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-xs" title={L.note}>{L.name}<br /><span className="font-mono text-[11px] text-muted-foreground">{L.u}U · {n1(L.kw)} kW · {L.psu}×PSU{L.liq ? ` · ${pct(L.liq)} liquid` : ""}</span></span>
              <span className="flex shrink-0 gap-1">
                <Btn disabled={!r} onClick={() => addOne(L)}>Add</Btn>
                <Btn disabled={!row} title="Add one to every rack in this row" onClick={() => addRow(L)}>Row</Btn>
              </span>
            </div>
          ))}
          <Hint>Compute fills from the bottom, network gear from the top. Striping re-runs on change.</Hint>
        </Section>

        <Fold title="Equipment library" open={openLib} onToggle={setOpenLib}>
          <Hint>Values are planning assumptions. Check them against the vendor datasheet (max power, PSU count and rating) before issuing a design.</Hint>
          <div className="max-w-full overflow-x-auto">
            <table className="text-xs">
              <thead><tr className="text-[10px] uppercase text-muted-foreground">
                {["Name", "Cat", "U", "kW", "PSU", "PSU W", "Liq", "800G", "400G", "Mgmt", "BMC", ""].map((h) => <th key={h} className="px-1 text-left font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {project.lib.map((L, i) => (
                  <tr key={L.id}>
                    <td className="px-1"><TextField width="w-36" value={L.name} onChange={(v) => editLib(i, (l) => { l.name = v; })} /></td>
                    <td className="px-1"><select aria-label="Category" value={L.cat} onChange={(e) => editLib(i, (l) => { l.cat = e.target.value as DeviceCat; })} className="rounded border border-input bg-background">{CATS.map((c) => <option key={c}>{c}</option>)}</select></td>
                    {(["u", "kw", "psu", "psuW", "liq"] as const).map((f) => (
                      <td key={f} className="px-1"><NumField width="w-14" value={L[f]} onChange={(v) => editLib(i, (l) => { l[f] = v; })} /></td>
                    ))}
                    {(["fabric", "storage", "mgmt", "bmc"] as const).map((f) => (
                      <td key={f} className="px-1"><NumField width="w-12" step={1} value={L.ports?.[f] || 0} onChange={(v) => editLib(i, (l) => { l.ports = { ...l.ports, [f]: Math.round(v) }; })} /></td>
                    ))}
                    <td className="px-1"><Btn tone="danger" disabled={inUse(L.id)} title={inUse(L.id) ? "In use" : "Delete"} onClick={() => commit((pp) => { pp.lib.splice(i, 1); })}>×</Btn></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(() => {
            const missing = DEF_LIB.filter((c) => !project.lib.some((l) => l.id === c.id));
            return missing.length > 0 && (
              <div className="flex items-center gap-1">
                <select aria-label="Catalog item" id="rl-cat" defaultValue="" className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs">
                  <option value="" disabled>Add from catalog…</option>
                  {missing.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <Btn onClick={() => {
                  const el = document.getElementById("rl-cat") as HTMLSelectElement | null;
                  const c = DEF_LIB.find((x) => x.id === el?.value);
                  if (c) commit((pp) => { pp.lib.push({ ...c, ports: { ...c.ports } }); });
                }}>Add</Btn>
              </div>
            );
          })()}
          <Btn onClick={() => commit((pp) => { pp.lib.push({ id: "c" + uid(), name: "Custom device", cat: "server", u: 2, kw: 1, psu: 2, psuW: 1600, liq: 0, ports: { mgmt: 1, bmc: 1 } }); })}>Add custom device</Btn>
        </Fold>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-[var(--rl-canvas)] p-4">
        {row ? (
          <div className="mb-2 flex flex-wrap items-baseline gap-3">
            <h2 className="text-lg font-semibold">{row.name}</h2>
            <Hint>{row.racks.length} racks · {n1(rowKW)} kW · viewed from the {face} ({face === "front" ? "cold" : "hot"} aisle side), left to right</Hint>
          </div>
        ) : <Hint>No racks yet. Place racks on the Layout tab.</Hint>}
        {row && (
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
            {row.racks.map((R, ix) => {
              const x0 = 20 + ix * (RW + GAP);
              const a = an.racks.find((q) => q.r.id === R.id)!;
              const onR = R.id === r?.id;
              return (
                <g key={R.id} style={{ cursor: "pointer" }} onClick={() => { setSelRack(R.id); setSelDev(null); }}>
                  <text x={x0} y={22} fontSize={14} fontWeight={600} fill="var(--foreground)">{R.name}</text>
                  <text x={x0} y={38} fontSize={9.5} fill="var(--muted-foreground)" className="font-mono">{n1(a.it)} kW · {a.u}/{R.u}U · {R.rdhx ? "RDHx" : a.contained ? "HAC" : "open"}</text>
                  <rect x={x0} y={TOP} width={RW} height={R.u * UH} fill="var(--card)" stroke={onR ? "var(--rl-accent)" : "var(--foreground)"} strokeWidth={onR ? 2.5 : 1.2} />
                  {Array.from({ length: R.u }, (_, k) => {
                    const u = k + 1, y = TOP + (R.u - u) * UH;
                    return (
                      <g key={u}>
                        <line x1={x0} y1={y} x2={x0 + RW} y2={y} stroke="var(--border)" strokeWidth={0.6} />
                        {(u % 5 === 0 || u === 1) && <text x={x0 - 4} y={y + UH - 3} textAnchor="end" fontSize={8} fill="var(--muted-foreground)" className="font-mono">{u}</text>}
                      </g>
                    );
                  })}
                  {R.devs.map((d) => {
                    const L = lib[d.lib];
                    if (!L) return null;
                    const y = TOP + (R.u - (d.u + L.u - 1)) * UH, on = d.id === selDev;
                    return (
                      <g key={d.id} onClick={(e) => { e.stopPropagation(); setSelRack(R.id); setSelDev(d.id); }}>
                        <rect x={x0 + 2} y={y + 1} width={RW - 4} height={L.u * UH - 2} rx={2} fill={`var(--rl-cat-${L.cat})`} stroke={on ? "var(--rl-accent)" : "var(--foreground)"} strokeWidth={on ? 2.4 : 0.8} />
                        <text x={x0 + 8} y={y + Math.min((L.u * UH) / 2 + 4, 15)} fontSize={11} fontWeight={600} fill="var(--foreground)">{L.name.length > 30 ? L.name.slice(0, 29) + "…" : L.name}</text>
                        {L.u > 2 && <text x={x0 + 8} y={y + Math.min((L.u * UH) / 2 + 16, 28)} fontSize={9.5} fill="var(--muted-foreground)" className="font-mono">U{d.u}–{d.u + L.u - 1} · {n1(L.kw * lf)} kW · {L.psu} PSU</text>}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </>
  );
}
