"use client";

import { CABLE_T, TRAY_K } from "@/lib/rackline/constants";
import { polyLength } from "@/lib/rackline/geometry";
import { fLen, fTotalLen, fileSafe, fromU, n0, pct, toU, uLbl } from "@/lib/rackline/format";
import type { CableType } from "@/lib/rackline/types";
import type { TabProps } from "./shared";
import { Btn, Chip, Hint, KV, Label, NumField, Panel, Section, Stat, Table, UtilChip } from "./ui";

export function CablesTab(p: TabProps & { download: (name: string, data: string, type: string) => void; onDrawTrays: () => void }) {
  const { project, scenario: S, an, commit } = p;
  const C = an.cab, c = S.cable, units = project.units;
  const setRule = (k: keyof typeof c, v: number) => commit((_p, s) => { s.cable[k] = v; });

  const bins: Partial<Record<CableType, Record<number, number>>> = {};
  for (const g of C.groups) { const b = (bins[g.type] ??= {}); b[g.std] = (b[g.std] || 0) + g.count; }
  const lens = [...new Set(C.groups.map((g) => g.std))].sort((a, b) => a - b);

  const csv = () => {
    const rows: (string | number)[][] = [["From rack", "To rack", "Cable type", "Count", "Calc length (m)", "Stock length (m)", "Route"]];
    for (const g of C.groups) rows.push([g.from.name, g.to.name, CABLE_T[g.type].name, g.count, g.len.toFixed(1), g.std, g.via]);
    p.download(`${fileSafe(S.name)}_cable_schedule.csv`, rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n"), "text/csv");
  };

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Routing rules">
          <KV>
            <Label htmlFor="rl-c-pe">Vertical + in-rack per end ({uLbl(units)})</Label><NumField id="rl-c-pe" step={0.1} value={toU(c.perEnd, units)} onChange={(v) => setRule("perEnd", fromU(v, units))} />
            <Label htmlFor="rl-c-sl">Slack</Label><NumField id="rl-c-sl" step={0.05} value={c.slack} onChange={(v) => setRule("slack", v)} />
            <Label htmlFor="rl-c-to">Tray junction snap ({uLbl(units)})</Label><NumField id="rl-c-to" step={0.1} value={toU(c.tol, units)} onChange={(v) => setRule("tol", fromU(v, units))} />
            <Label htmlFor="rl-c-md">Max rack-to-tray offset ({uLbl(units)})</Label><NumField id="rl-c-md" step={0.1} value={toU(c.maxDrop, units)} onChange={(v) => setRule("maxDrop", fromU(v, units))} />
            <Label htmlFor="rl-c-fm">Max tray fill</Label><NumField id="rl-c-fm" step={0.05} value={c.fillMax} onChange={(v) => setRule("fillMax", v)} />
          </KV>
          <Hint>Runs go from every rack with ported equipment to the nearest network rack, along fiber ducts and ladder trays (shortest path through tray junctions). Lengths round up to stock sizes. Port counts per device come from the equipment library.</Hint>
        </Section>
        <Section title="Pathways">
          {S.trays.length ? S.trays.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 text-xs">
              <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: TRAY_K[t.kind].color }} />{t.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{t.wmm}×{t.dmm} mm · {fLen(polyLength(t.pts), units)}</span>
            </div>
          )) : <Hint>No pathways. Draw trays on the Layout tab.</Hint>}
          <Btn onClick={p.onDrawTrays}>Draw trays on layout</Btn>
        </Section>
        <Section title="Export"><Btn onClick={csv}>Cable schedule CSV</Btn></Section>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto bg-[var(--rl-canvas)] p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
          <Stat label="Cables" value={n0(C.count)} />
          <Stat label="Total length" value={fTotalLen(C.total, units)} />
          <Stat label="Longest run" value={fLen(C.groups.reduce((a, g) => Math.max(a, g.len), 0), units, 0)} />
          <Stat label="Worst tray fill" value={pct(C.segs.reduce((a, s) => Math.max(a, s.fill), 0))} />
        </div>
        {!S.racks.some((r) => r.role === "network") && <Panel title="No network rack"><Hint>Set one rack&apos;s role to <b>network</b> to generate runs.</Hint></Panel>}
        <Panel title="Stock length bill of materials">
          <Table head={["Cable", ...lens.map((l) => `${l} m`), "Total"]} numeric={lens.map((_, i) => i + 1).concat(lens.length + 1)}>
            {(Object.entries(bins) as [CableType, Record<number, number>][]).map(([t, b]) => (
              <tr key={t}><td>{CABLE_T[t].name}</td>{lens.map((l) => <td key={l} className="n">{b[l] || ""}</td>)}<td className="n">{Object.values(b).reduce((a, v) => a + v, 0)}</td></tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Tray fill">
          <Table head={["Pathway", "Segment", "Size", "Cable area", "Fill"]} numeric={[1, 2, 3, 4]}>
            {C.segs.map((s) => (
              <tr key={s.t.id + s.i}><td>{s.t.name}</td><td className="n">{s.i + 1}</td><td className="n">{s.t.wmm}×{s.t.dmm} mm</td><td className="n">{n0(s.area)} mm²</td><td className="n"><UtilChip u={s.fill / c.fillMax} label={pct(s.fill)} /></td></tr>
            ))}
          </Table>
        </Panel>
        <Panel title="Cable schedule">
          <Table head={["From", "To", "Type", "Qty", "Calc", "Stock", "Route"]} numeric={[3, 4, 5]}>
            {C.groups.map((g, i) => (
              <tr key={i}>
                <td>{g.from.name}</td><td>{g.to.name}</td><td>{CABLE_T[g.type].name}</td><td className="n">{g.count}</td>
                <td className="n">{fLen(g.len, units)}</td><td className="n">{g.std} m</td>
                <td>{g.via === "direct" ? <Chip tone="warn">no tray path</Chip> : g.via}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </>
  );
}
