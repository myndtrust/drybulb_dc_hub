"use client";

import { BTU, REDUNDANCY } from "@/lib/rackline/constants";
import { n0, n1, pct } from "@/lib/rackline/format";
import type { CoolingBasis, Redundancy } from "@/lib/rackline/types";
import type { TabProps } from "./shared";
import { Hint, KV, Label, NumField, Panel, Section, Select, Stat, Table, WarnList } from "./ui";

type NumKey = { [K in keyof CoolingBasis]: CoolingBasis[K] extends number ? K : never }[keyof CoolingBasis];

export function CoolingTab(p: TabProps) {
  const { scenario: S, an: A, commit } = p;
  const c = S.cool;
  const num = (k: NumKey, label: string, step: number) => (
    <>
      <Label htmlFor={"rl-k-" + k}>{label}</Label>
      <NumField id={"rl-k-" + k} step={step} value={c[k]} onChange={(v) => commit((_p, s) => { s.cool[k] = v; })} />
    </>
  );
  const red = (k: "red" | "cduRed", label: string, opts: Redundancy[]) => (
    <>
      <Label htmlFor={"rl-k-" + k}>{label}</Label>
      <Select id={"rl-k-" + k} width="w-24" value={c[k]} onChange={(v) => commit((_p, s) => { s.cool[k] = v; })} options={opts.map((o) => [o, o])} />
    </>
  );

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Air side">
          <KV>
            {num("dtF", "IT ΔT (°F)", 1)}{num("bypass", "Bypass factor, uncontained", 0.05)}
            {num("crahKW", "CRAH net capacity (kW)", 5)}{num("crahCFM", "CRAH airflow (CFM)", 500)}{num("crahFanKW", "CRAH fan power (kW)", 0.5)}
            {red("red", "CRAH redundancy", REDUNDANCY)}
          </KV>
        </Section>
        <Section title="Rear door heat exchanger">
          <KV>{num("rdhxKW", "RDHx capacity per door (kW)", 1)}{num("rdhxDtF", "Water ΔT (°F)", 1)}</KV>
          <Hint>Passive doors are rated at a given entering water temperature and server airflow. Confirm the rating at your supply water temperature.</Hint>
        </Section>
        <Section title="Liquid (DLC)">
          <KV>
            {num("cduKW", "CDU capacity (kW)", 10)}{red("cduRed", "CDU redundancy", ["N", "N+1", "2N"])}
            {num("fwDtF", "Facility water ΔT (°F)", 1)}{num("tcsLpm", "TCS flow (L/min per kW)", 0.1)}
            <Label htmlFor="rl-k-rej">DLC heat rejection</Label>
            <Select id="rl-k-rej" value={c.dlcRej} onChange={(v) => commit((_p, s) => { s.cool.dlcRej = v; })} options={[["drycooler", "Dry cooler (warm water)"], ["chiller", "Chiller"]]} />
          </KV>
        </Section>
        <Section title="Plant">
          <KV>{num("chKWton", "Chiller kW/ton at design", 0.05)}{num("margin", "Sizing margin", 0.05)}{num("ambF", "Design ambient (°F)", 1)}{num("upsEff", "UPS efficiency", 0.01)}</KV>
          <Hint>Use the site&apos;s ASHRAE 0.4% cooling design dry-bulb, and take chiller efficiency at that ambient.</Hint>
        </Section>
      </aside>

      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-auto bg-[var(--rl-canvas)] p-4">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-2.5">
          <Stat label="IT load" value={n1(A.it) + " kW"} sub={`${n0((A.it * BTU) / 1000)} kBTU/h`} />
          <Stat label="To room air" value={n1(A.room) + " kW"} sub={n0(A.roomCFM) + " CFM supply"} />
          <Stat label="Removed at RDHx" value={n1(A.door) + " kW"} sub={`${A.rdhxN} doors · ${n1(A.rdhxGPM)} GPM`} />
          <Stat label="To liquid (DLC)" value={n1(A.liq) + " kW"} sub={A.liq ? `${n1(A.fwGPM)} GPM FWS · ${n0(A.tcsLPM)} L/min TCS` : "none"} />
          <Stat label="CRAH units" value={A.crahTot} sub={`${A.crahN} + ${A.crahTot - A.crahN} (${c.red}) · placed ${n0(A.crahPlaced)} kW`} />
          <Stat label="CDUs" value={A.cduTot} sub={A.cduTot ? `${A.cduN} + ${A.cduTot - A.cduN} (${c.cduRed})` : "not needed"} />
          <Stat label="Chiller" value={n1(A.tons) + " tons"} sub={`${n0(A.tons * 3.517)} kW incl. ${pct(c.margin)} margin`} />
          {A.dryKW > 0 && <Stat label="Dry cooler" value={n0(A.dryKW) + " kW"} />}
          <Stat label="Mechanical power" value={n1(A.mechKW) + " kW"} sub="chiller + fans + pumps" />
          <Stat label="Estimated PUE" value={A.it ? A.pue.toFixed(2) : "—"} sub={`at ${c.ambF} °F design`} />
        </div>
        <Panel title="Checks"><WarnList items={A.warns} /></Panel>
        <Panel title="Per-rack heat balance">
          <Table head={["Rack", "Path", "IT kW", "Liquid kW", "Air kW", "RDHx kW", "Room kW", "Server CFM", "RDHx GPM"]} numeric={[2, 3, 4, 5, 6, 7, 8]}>
            {A.racks.map((x) => (
              <tr key={x.r.id}>
                <td>{x.r.name}</td>
                <td>{[x.liq ? "DLC" : "", x.r.rdhx ? "RDHx" : "", x.contained ? "HAC" : "open"].filter(Boolean).join(" + ")}</td>
                <td className="n">{n1(x.it)}</td><td className="n">{n1(x.liq)}</td><td className="n">{n1(x.air)}</td>
                <td className="n">{n1(x.door)}</td><td className="n">{n1(x.room)}</td><td className="n">{n0(x.cfm)}</td>
                <td className="n">{x.gpm ? n1(x.gpm) : ""}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td>Total</td><td /><td className="n">{n1(A.it)}</td><td className="n">{n1(A.liq)}</td><td className="n">{n1(A.air)}</td>
              <td className="n">{n1(A.door)}</td><td className="n">{n1(A.room)}</td><td className="n">{n0(A.racks.reduce((a, x) => a + x.cfm, 0))}</td><td className="n">{n1(A.rdhxGPM)}</td>
            </tr>
          </Table>
          <Hint>Airflow from Q[BTU/h] = 1.08 × CFM × ΔT[°F]. Water flow from Q = 500 × GPM × ΔT. Uncontained racks get the bypass factor on supply air.</Hint>
        </Panel>
      </div>
    </>
  );
}
