"use client";

import { type ReactNode, useMemo, useState } from "react";
import { analyze } from "@/lib/rackline/analysis";
import { PDU_TYPES } from "@/lib/rackline/constants";
import { COOLING_LABEL, type CoolingScheme } from "@/lib/rackline/generate";
import { isCloudConfigured, runSweep } from "@/lib/rackline/cloud";
import { clone, uid } from "@/lib/rackline/model";
import { sweep, SWEEP_MAX_CASES, type SweepRow } from "@/lib/rackline/sweep";
import { fArea, fLen, fTotalLen, n0, n1 } from "@/lib/rackline/format";
import type { Analysis } from "@/lib/rackline/types";
import type { TabProps } from "./shared";
import { Btn, Chip, Hint, KV, Label, NumField, Panel, Section, Select, Table, UtilChip, WarnList } from "./ui";

type Row = [label: string, fn: ((a: Analysis) => number | string) | null, mode?: "min" | "eq", fmt?: (v: number) => ReactNode];

export function CompareTab(p: TabProps & { signedIn: boolean }) {
  const { project, scenario: S, lib, commit, toast } = p;
  const units = project.units;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const all = useMemo(() => project.scenarios.map((s) => analyze(s, { lib, elec: project.elec })), [project, lib]);
  const list = all.filter((a) => !hidden.has(a.s.id));

  // Sweep inputs
  const compute = project.lib.filter((l) => l.cat === "compute");
  const [sw, setSw] = useState({ nodes: 8, model: compute[0]?.id ?? "", per: "1,2,3,4", pod: true, single: true, hac: true, rdhx: true, both: false });
  const [rows, setRows] = useState<SweepRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const runIt = async () => {
    const perRack = [...new Set(sw.per.split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= 10).map(Math.round))];
    const pattern = [sw.pod && "pod", sw.single && "single"].filter(Boolean) as ("pod" | "single")[];
    const cooling = [sw.hac && "hac", sw.rdhx && "rdhx", sw.both && "hac+rdhx"].filter(Boolean) as CoolingScheme[];
    if (!perRack.length || !pattern.length || !cooling.length) { toast("Pick at least one value in each sweep dimension"); return; }
    const req = {
      base: { nodes: sw.nodes, model: sw.model, rackW: 0.6, hot: 1.2, cold: 1.2, net: true, red: S.cool.red, ox: 3, oy: 4 },
      grid: { perRack, pattern, cooling }, lib: project.lib, elec: project.elec,
    };
    setBusy(true);
    try {
      setRows(isCloudConfigured && p.signedIn ? await runSweep(req) : sweep(req));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const adopt = (r: SweepRow) => {
    const s = clone(r.scenario);
    s.id = uid();
    commit((pp, cur) => {
      s.electrical = clone(cur.electrical);
      pp.scenarios.push(s);
      pp.active = s.id;
    });
    toast(`Added "${s.name}" as a scenario`);
  };

  const tx = (a: Analysis) => Object.values(a.elec).find((x) => x.n.type === "xfmr");
  const ROWS: Row[] = [
    ["Layout", null],
    ["Compute nodes", (a) => a.nodes, "eq"],
    ["Racks (incl. network)", (a) => a.racks.length, "min"],
    ["Max kW per rack", (a) => a.maxRack, "min", n1],
    ["Planning footprint", (a) => a.area, "min", (v) => fArea(v, units)],
    ["Containment zones", (a) => a.s.hacs.length],
    ["Cooling path", (a) => [a.liq ? "DLC" : "", a.rdhxN ? "RDHx" : "", a.s.hacs.length ? "HAC" : ""].filter(Boolean).join(" + ") || "Open room"],
    ["Power", null],
    ["IT load (kW)", (a) => a.it, "eq", n1],
    ["PDUs per rack (pairs × A)", (a) => [...new Set(a.racks.map((x) => `${x.r.pduPairs}×${PDU_TYPES[x.r.pdu].amps}A`))].join(", ")],
    ["Worst PDU phase on feed loss", (a) => a.pduWorst, "min", (v) => <UtilChip u={v} />],
    ["Transformer design loading", (a) => tx(a)?.util ?? 0, "min", (v) => <UtilChip u={v} />],
    ["UPS / RPP worst loading", (a) => Math.max(0, ...Object.values(a.elec).filter((x) => ["ups", "rpp", "busway"].includes(x.n.type)).map((x) => x.util)), "min", (v) => <UtilChip u={v} />],
    ["Cooling", null],
    ["Heat to room air (kW)", (a) => a.room, "min", n1],
    ["CRAH units", (a) => `${a.crahTot} (${a.s.cool.red})`],
    ["RDHx doors / GPM", (a) => (a.rdhxN ? `${a.rdhxN} / ${n1(a.rdhxGPM)}` : "—")],
    ["CDUs", (a) => a.cduTot || "—"],
    ["Chiller (tons)", (a) => a.tons, "min", n1],
    ["Mechanical power (kW)", (a) => a.mechKW, "min", n1],
    ["Estimated PUE", (a) => a.pue, "min", (v) => (v ? v.toFixed(2) : "—")],
    ["Cabling", null],
    ["Cables", (a) => a.cab.count, "min", n0],
    ["Total cable length", (a) => a.cab.total, "min", (v) => fTotalLen(v, units)],
    ["Longest run", (a) => a.cab.groups.reduce((m, g) => Math.max(m, g.len), 0), "min", (v) => fLen(v, units, 0)],
    ["Checks", null],
    ["Failures", (a) => a.warns.filter((w) => w.sev === "bad").length, "min", (v) => <Chip tone={v ? "bad" : "ok"}>{v}</Chip>],
    ["Items to check", (a) => a.warns.filter((w) => w.sev !== "bad").length, "min", (v) => <Chip tone={v ? "warn" : "ok"}>{v}</Chip>],
  ];

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Scenarios">
          {project.scenarios.map((s) => (
            <label key={s.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!hidden.has(s.id)} onChange={(e) => { const n = new Set(hidden); if (e.target.checked) n.delete(s.id); else n.add(s.id); setHidden(n); }} />
              {s.name}
            </label>
          ))}
          <Hint>Every scenario carries its own layout, PDUs, single line and cooling basis. Use Duplicate in the top bar, Generate layout on the Layout tab, or a sweep below to add variants.</Hint>
        </Section>
        <Section title={`Notes on ${S.name}`}>
          <textarea
            key={S.id} rows={5} defaultValue={S.notes} aria-label="Scenario notes"
            onBlur={(e) => e.target.value !== S.notes && commit((_p, s) => { s.notes = e.target.value; })}
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
          />
        </Section>
        <Section title="Layout sweep">
          <KV>
            <Label htmlFor="rl-sw-n">Compute nodes</Label><NumField id="rl-sw-n" min={1} step={1} value={sw.nodes} onChange={(v) => setSw({ ...sw, nodes: Math.max(1, Math.round(v)) })} />
            <Label htmlFor="rl-sw-m">Node model</Label><Select id="rl-sw-m" value={sw.model} onChange={(v) => setSw({ ...sw, model: v })} options={compute.map((l) => [l.id, l.name])} />
            <Label htmlFor="rl-sw-per">Nodes per rack</Label>
            <input id="rl-sw-per" value={sw.per} onChange={(e) => setSw({ ...sw, per: e.target.value })} className="w-40 rounded-md border border-input bg-background px-2 py-1 font-mono text-sm" />
          </KV>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={sw.pod} onChange={(e) => setSw({ ...sw, pod: e.target.checked })} /> Two-row pod</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={sw.single} onChange={(e) => setSw({ ...sw, single: e.target.checked })} /> Single row</label>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={sw.hac} onChange={(e) => setSw({ ...sw, hac: e.target.checked })} /> HAC</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={sw.rdhx} onChange={(e) => setSw({ ...sw, rdhx: e.target.checked })} /> RDHx</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={sw.both} onChange={(e) => setSw({ ...sw, both: e.target.checked })} /> HAC + RDHx</label>
          </div>
          <Btn tone="primary" disabled={busy} onClick={runIt}>{busy ? "Running…" : "Run sweep"}</Btn>
          <Hint>
            Generates and checks every combination (up to {SWEEP_MAX_CASES}){isCloudConfigured && p.signedIn ? " on Drybulb cloud compute" : " in this browser"}.
            Passing designs rank first, then smallest footprint, then best PUE.
          </Hint>
        </Section>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto bg-[var(--rl-canvas)] p-4">
        {rows && (
          <Panel title={`Sweep results · ${rows.length} layouts`} right={<Btn onClick={() => setRows(null)}>Clear</Btn>}>
            <Table head={["Layout", "Racks", "Max kW/rack", "Footprint", "PUE", "Worst PDU", "Cables", "Checks", ""]} numeric={[1, 2, 3, 4, 5, 6]}>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.perRack}/rack · {r.pattern === "pod" ? "two-row pod" : "single row"} · {COOLING_LABEL[r.cooling]}</td>
                  <td className="n">{r.racks}</td><td className="n">{n1(r.maxRackKW)}</td><td className="n">{fArea(r.areaM2, units)}</td>
                  <td className="n">{r.pue.toFixed(2)}</td><td className="n"><UtilChip u={r.pduWorst} /></td><td className="n">{n0(r.cables)}</td>
                  <td>{r.fails ? <Chip tone="bad">{r.fails} fail</Chip> : <Chip tone="ok">pass</Chip>} {r.checks > 0 && <Chip tone="warn">{r.checks}</Chip>}</td>
                  <td><Btn onClick={() => adopt(r)}>Add</Btn></td>
                </tr>
              ))}
            </Table>
          </Panel>
        )}
        <Panel title="Scenario comparison">
          <Hint>Lowest value in each row is marked ◆ where lower is better.</Hint>
          <Table head={["", ...list.map((a) => a.s.name)]}>
            {ROWS.map(([lab, fn, mode, fmt]) => {
              if (!fn) return <tr key={lab}><td colSpan={list.length + 1} className="pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{lab}</td></tr>;
              const vals = list.map(fn);
              const nums = vals.every((v) => typeof v === "number");
              const best = mode === "min" && nums ? Math.min(...(vals as number[])) : null;
              return (
                <tr key={lab}>
                  <td>{lab}</td>
                  {vals.map((v, i) => (
                    <td key={i} className={typeof v === "number" ? "n" : ""}>
                      {fmt && typeof v === "number" ? fmt(v) : v}
                      {best != null && v === best && list.length > 1 && new Set(vals).size > 1 ? " ◆" : ""}
                    </td>
                  ))}
                </tr>
              );
            })}
          </Table>
        </Panel>
        {list.map((a) => (
          <Panel key={a.s.id} title={a.s.name}>
            {a.s.notes && <Hint>{a.s.notes}</Hint>}
            <WarnList items={a.warns} />
          </Panel>
        ))}
      </div>
    </>
  );
}
