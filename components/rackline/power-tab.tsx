"use client";

import { FEEDABLE, PDU_TYPES } from "@/lib/rackline/constants";
import { rackRows } from "@/lib/rackline/geometry";
import { autoStripe, choosePDU } from "@/lib/rackline/model";
import { n1, pct } from "@/lib/rackline/format";
import type { PduKey, Rack } from "@/lib/rackline/types";
import type { TabProps } from "./shared";
import { Btn, Chip, Hint, KV, Label, NumField, Panel, Section, Select, Table, UtilChip, WarnList } from "./ui";

const PH = ["L1", "L2", "L3"];
const phBg = ["bg-[var(--rl-l1)]", "bg-[var(--rl-l2)]", "bg-[var(--rl-l3)]"];
const feedCls = { A: "text-[var(--rl-feedA)]", B: "text-[var(--rl-feedB)]" };

export function PowerTab(p: TabProps) {
  const { project, scenario: S, an, lib, commit, toast, selRack, setSelRack } = p;
  const elec = project.elec, lf = S.loadFactor || 1;
  const r = S.racks.find((x) => x.id === selRack) ?? S.racks[0];
  const x = r ? an.racks.find((a) => a.r.id === r.id) : undefined;
  const feeds = S.electrical.nodes.filter((n) => FEEDABLE.includes(n.type));
  const feedOpts: [string, string][] = [["", "None"], ...feeds.map((n) => [n.id, n.name] as [string, string])];
  const nm = (id: string | null) => S.electrical.nodes.find((n) => n.id === id)?.name ?? "—";
  const onRack = (fn: (R: Rack) => void) => commit((_p, s) => fn(s.racks.find((q) => q.id === r!.id)!));

  /** Bulk feed assignment for a set of racks. */
  const setFeeds = (ids: Set<string> | null, f: "feedA" | "feedB", v: string) =>
    v && commit((_p, s) => s.racks.forEach((R) => { if (!ids || ids.has(R.id)) R[f] = v; }));
  const rows = rackRows(S, "front");
  const row = rows.find((w) => w.racks.some((q) => q.id === r?.id));

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Electrical basis">
          <KV>
            <Label>Distribution</Label><span className="font-mono text-xs">{elec.vLL}Y/{elec.vLN} V, 3Ø 4W</span>
            <Label htmlFor="rl-p-pf">PSU power factor</Label><NumField id="rl-p-pf" step={0.01} value={elec.pf} onChange={(v) => commit((pp) => { pp.elec.pf = v; })} />
            <Label htmlFor="rl-p-dr">Continuous derate</Label><NumField id="rl-p-dr" step={0.05} value={elec.derate} onChange={(v) => commit((pp) => { pp.elec.derate = v; })} />
            <Label htmlFor="rl-p-lf">Design load factor</Label><NumField id="rl-p-lf" step={0.05} value={S.loadFactor} onChange={(v) => commit((_p, s) => { s.loadFactor = v; s.racks.forEach((R) => autoStripe(R, lib, v)); })} />
          </KV>
          <Hint>PSUs connect line to neutral at {elec.vLN} V. Feed-loss current assumes the surviving PSUs share the device&apos;s full load. Derate 0.8 follows NEC continuous-load practice.</Hint>
        </Section>
        {r && (
          <Section title={`Rack ${r.name}`}>
            <KV>
              <Label htmlFor="rl-p-r">Rack</Label>
              <Select id="rl-p-r" value={r.id} onChange={setSelRack} options={S.racks.map((R) => [R.id, R.name])} />
              <Label htmlFor="rl-p-t">PDU type</Label>
              <Select id="rl-p-t" value={r.pdu} onChange={(v) => onRack((R) => { R.pdu = v as PduKey; autoStripe(R, lib, lf); })} options={Object.entries(PDU_TYPES).map(([k, v]) => [k as PduKey, v.name])} />
              <Label htmlFor="rl-p-n">PDU pairs (A+B)</Label>
              <Select id="rl-p-n" width="w-20" value={String(r.pduPairs)} onChange={(v) => onRack((R) => { R.pduPairs = +v; autoStripe(R, lib, lf); })} options={[["1", "1"], ["2", "2"], ["3", "3"]]} />
              <Label htmlFor="rl-p-a">Feed A source</Label>
              <Select id="rl-p-a" value={r.feedA ?? ""} onChange={(v) => onRack((R) => { R.feedA = v || null; })} options={feedOpts} />
              <Label htmlFor="rl-p-b">Feed B source</Label>
              <Select id="rl-p-b" value={r.feedB ?? ""} onChange={(v) => onRack((R) => { R.feedB = v || null; })} options={feedOpts} />
            </KV>
            <div className="flex gap-1">
              <Btn tone="primary" onClick={() => onRack((R) => autoStripe(R, lib, lf))}>Auto-stripe rack</Btn>
              <Btn onClick={() => { let ok = true; onRack((R) => { ok = choosePDU(R, lib, elec, lf); }); if (!ok) toast("No single PDU size fits; split the load"); }}>Auto-size PDUs</Btn>
            </div>
          </Section>
        )}
        {row && (
          <Section title={`Row · ${row.racks.length} racks`}>
            <KV>
              <Label htmlFor="rl-p-ra">Row feed A</Label>
              <Select id="rl-p-ra" value="" onChange={(v) => setFeeds(new Set(row.racks.map((q) => q.id)), "feedA", v)} options={[["", "…"], ...feedOpts.slice(1)]} />
              <Label htmlFor="rl-p-rb">Row feed B</Label>
              <Select id="rl-p-rb" value="" onChange={(v) => setFeeds(new Set(row.racks.map((q) => q.id)), "feedB", v)} options={[["", "…"], ...feedOpts.slice(1)]} />
            </KV>
            <Hint>{row.name}</Hint>
          </Section>
        )}
        <Section title="All racks">
          <Btn onClick={() => commit((pp, s) => s.racks.forEach((R) => choosePDU(R, lib, pp.elec, lf)))}>Auto-size and stripe all racks</Btn>
          <KV>
            <Label htmlFor="rl-p-aa">Set all feed A</Label>
            <Select id="rl-p-aa" value="" onChange={(v) => setFeeds(null, "feedA", v)} options={[["", "…"], ...feedOpts.slice(1)]} />
            <Label htmlFor="rl-p-ab">Set all feed B</Label>
            <Select id="rl-p-ab" value="" onChange={(v) => setFeeds(null, "feedB", v)} options={[["", "…"], ...feedOpts.slice(1)]} />
          </KV>
          <Hint>Feed sources are the RPPs, busways, switchboards, UPSs and ATSs on the Single line tab.</Hint>
        </Section>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto bg-[var(--rl-canvas)] p-4">
        {r && x && (() => {
          const st = x.st;
          return (
            <>
              <Panel title={`${r.name} power striping`} right={<span className="flex gap-1"><UtilChip u={st.util} label={"Feed-loss worst phase " + pct(st.util)} /><Chip tone={st.imb > 0.15 ? "warn" : "ok"}>Imbalance {pct(st.imb)}</Chip></span>}>
                <Hint>{st.n}× pair {st.pdu.name}. Phase limit {n1(st.lim)} A ({st.pdu.amps} A × {elec.derate}). Each PDU is good for {n1(st.capKW)} kW at the derate. Rack load {n1(x.it)} kW.</Hint>
                <Table head={["PDU", ...PH.flatMap((q) => [`${q} normal A`, `${q} feed-loss A`]), "kW normal", "Worst"]} numeric={[1, 2, 3, 4, 5, 6, 7, 8]}>
                  {(["A", "B"] as const).flatMap((f) => Array.from({ length: st.n }, (_, pi) => {
                    const a = st.norm[f][pi], b = st.fail[f][pi];
                    const kw = (a.reduce((s, v) => s + v, 0) * elec.vLN * elec.pf) / 1000;
                    return (
                      <tr key={f + pi}>
                        <td><b className={feedCls[f]}>PDU-{f}{pi + 1}</b></td>
                        {a.flatMap((v, k) => [<td key={"n" + k} className="n">{n1(v)}</td>, <td key={"f" + k} className="n">{n1(b[k])}</td>])}
                        <td className="n">{n1(kw)}</td>
                        <td className="n"><UtilChip u={Math.max(...b) / st.lim} /></td>
                      </tr>
                    );
                  }))}
                </Table>
              </Panel>
              <Panel title="PSU map">
                <Hint>
                  Click a PSU to cycle its phase. Shift-click to move it to the other feed.{" "}
                  <span className={feedCls.A}>A feed</span> · <span className={feedCls.B}>B feed</span>
                </Hint>
                <Table head={["U", "Device", "PSUs"]}>
                  {[...r.devs].sort((a, b) => b.u - a.u).map((d) => {
                    const L = lib[d.lib];
                    if (!L || !L.psu) return null;
                    const map = d.map; // every commit re-stripes invalid racks, so this matches L.psu
                    return (
                      <tr key={d.id}>
                        <td className="n">{d.u}</td>
                        <td>{L.name}<br /><span className="font-mono text-[11px] text-muted-foreground">{n1(L.kw * lf)} kW · {L.psu}× {L.psuW} W</span></td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {map.map((m, k) => (
                              <button
                                key={k} type="button" title={`PSU ${k + 1}`}
                                className="inline-flex items-center gap-1 rounded border bg-card px-1.5 font-mono text-[11px]"
                                onClick={(e) => {
                                  const shift = e.shiftKey;
                                  onRack((R) => {
                                    const dd = R.devs.find((q) => q.id === d.id)!;
                                    if (dd.map.length !== L.psu) autoStripe(R, lib, lf);
                                    const mm = dd.map[k];
                                    if (shift) mm.f = mm.f === "A" ? "B" : "A";
                                    else { mm.ph = (mm.ph + 1) % 3; if (mm.ph === 0 && R.pduPairs > 1) mm.p = (mm.p + 1) % R.pduPairs; }
                                  });
                                }}
                              >
                                <span className={feedCls[m.f]}>{m.f}{m.p + 1}</span>
                                <i className={`inline-block h-2 w-2 rounded-full ${phBg[m.ph]}`} />L{m.ph + 1}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </Table>
                {st.warns.length > 0 && <WarnList items={st.warns.map((msg) => ({ sev: "bad" as const, msg }))} />}
              </Panel>
            </>
          );
        })()}
        <Panel title="All racks">
          <Table head={["Rack", "kW", "PDUs", "Feed A", "Feed B", "Worst phase on feed loss", "Imbalance"]} numeric={[1, 5, 6]}>
            {an.racks.map((a) => (
              <tr key={a.r.id} onClick={() => setSelRack(a.r.id)} className={`cursor-pointer hover:bg-muted ${a.r.id === r?.id ? "bg-[var(--rl-accent-soft)]" : ""}`}>
                <td>{a.r.name}</td>
                <td className="n">{n1(a.it)}</td>
                <td>{a.r.pduPairs}× {PDU_TYPES[a.r.pdu].amps} A pair</td>
                <td>{nm(a.r.feedA)}</td>
                <td>{nm(a.r.feedB)}</td>
                <td className="n">{n1(a.st.maxF)} A <UtilChip u={a.st.util} /></td>
                <td className="n">{pct(a.st.imb)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>
    </>
  );
}
