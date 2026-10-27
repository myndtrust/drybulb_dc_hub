"use client";

// Layout setup, docked beside the plan. Two generators share it:
//  - "nvl72": a reference design, as five plain questions (how big, where,
//    power, cooling, check and create) — the GB300 NVL72 pod of the NVIDIA RA
//    (lib/rackline/nvl72.ts) or the Vera Rubin NVL72 hall of the
//    modular reference design (lib/rackline/vr200.ts);
//  - "block": a quick block of racks from the equipment library —
//    lib/rackline/generate.ts.
// The plan shows a live preview of the result while the panel is open. Each
// option card shows what picking it would change; conflicts offer a one-click
// fix; the generator's automatic rules are editable; the answers are saved on
// the scenario so "Edit setup" reopens with them.

import { useEffect, useMemo, useState } from "react";
import { getComponent } from "@/lib/cost/catalog";
import { analyze } from "@/lib/rackline/analysis";
import { buildScenario, COOLING_LABEL, type CoolingScheme, type GenOptions } from "@/lib/rackline/generate";
import { fromU, n0, toU, uLbl } from "@/lib/rackline/format";
import { clone, defaultElectrical, libIndex, type LibIndex } from "@/lib/rackline/model";
import {
  NET_RACK_KW, NVL72_RACK, PLATFORMS, POWER_ARCH, defaultNvl72Options, ensureNvl72Lib, gb300LpmPerKW, maxDryAmbientC, raNetwork, specRating,
  type Nvl72PodOptions, type Nvl72PodResult, type Platform, type PowerArch,
} from "@/lib/rackline/nvl72";
import { VR_RD, buildReferencePod, tcsLpmPerKW, vrNetwork } from "@/lib/rackline/vr200";
import { editedSinceSetup, makeSetup } from "@/lib/rackline/setup";
import type { Analysis, LibItem, RacklineProject, Redundancy, Scenario, ScenarioSetup } from "@/lib/rackline/types";
import type { TabKey } from "./shared";
import { Btn, Chip, Hint, KV, Label, NumField, Select, Seg, Table, WarnList } from "./ui";

export type SetupKind = ScenarioSetup["kind"];

/** What the plan draws while the panel is open. */
export interface Ghost { scenario: Scenario; an: Analysis }

/** A finished build, ready to commit. */
export interface SetupResult {
  scenario: Scenario;
  /** Library items the result uses (added to the project if missing). */
  lib: LibItem[];
  /** Project voltage the result needs, when it differs. */
  elec?: { vLL: number; vLN: number };
}

const RA = "https://docs.nvidia.com/enterprise-reference-architectures/nvl72-ai-factory/latest/";
const VR_SOURCES: [string, string][] = [
  ["NVIDIA Vera Rubin NVL72 (72 Rubin GPUs, 36 Vera CPUs, 45 °C inlet)", "https://www.nvidia.com/en-us/data-center/vera-rubin-nvl72/"],
  ["NVIDIA: Inside the Rubin platform (ConnectX-9 1.6 Tb/s per GPU, Spectrum-6 SN6810 / SN6800)", "https://developer.nvidia.com/blog/inside-the-NVIDIA-rubin-platform-six-new-chips-one-ai-supercomputer"],
  ["SemiAnalysis: Vera Rubin (180–220 kW, 4 × 110 kW shelves N+1, tray contents)", "https://newsletter.semianalysis.com/p/vera-rubin-extreme-co-design-an-evolution"],
];
const SOURCES: [string, string][] = [
  ["NVIDIA NVL72 AI Factory RA (GB300 NVL72): overview, SU = 1 rack, tested to 8 SUs", RA + "overview.html"],
  ["NVIDIA RA: system hardware & components (142 kW, 8 × 33 kW power shelves, in-rack SN2201, 12 management nodes)", RA + "components.html"],
  ["NVIDIA RA: network logical architecture (Tables 6–7, ports per SU)", RA + "network-logical-architecture.html"],
  ["Lenovo Press LP2357, GB300 NVL72 (135 kW TDP, shelves and whips, 90 / 10 liquid / air, 25–45 °C supply, flow table, rack size)", "https://lenovopress.lenovo.com/lp2357-lenovo-nvidia-gb300-nvl72-rack-scale-ai"],
  ["HPE QuickSpecs, GB300 NVL72 (132 kW nominal TDP, ~155 kW peak)", "https://www.hpe.com/us/en/collaterals/collateral.a50009244enw.html"],
];

const STEPS = ["How big?", "Where does it go?", "How is it powered?", "How is it cooled?", "Check and create"] as const;

type BlockOptions = Omit<GenOptions, "name" | "red" | "ox" | "oy">;
const defaultBlock = (lib: LibItem[]): BlockOptions => ({
  nodes: 8, perRack: 2, model: lib.find((l) => l.cat === "compute")?.id ?? "", pattern: "pod", cooling: "hac", rackW: 0.6, hot: 1.2, cold: 1.2, net: true,
});

type PickKey = keyof Nvl72PodOptions["picks"];
const products = (key: string) =>
  (getComponent(key)?.component.products ?? []).map((p) => ({ label: `${p.vendor} ${p.model}`, spec: p.spec }));

/** Catalog product picker; picking a product fills its rating when the spec states one. */
function Pick({ id, comp, value, onPick, unit }: { id: string; comp: string; value?: string; onPick: (label: string | undefined, rating: number | null) => void; unit?: "kW" | "kVA" | "A" }) {
  const list = products(comp);
  return (
    <Select
      id={id} width="w-full" value={value ?? ""}
      onChange={(v) => { const p = list.find((x) => x.label === v); onPick(v || undefined, p && unit ? specRating(p.spec, unit) : null); }}
      options={[["", "Generic (no product)"], ...list.map((p) => [p.label, `${p.label} · ${p.spec}`] as [string, string])]}
    />
  );
}

function Q({ title, help, children }: { title: string; help?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{title}</legend>
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
      {children}
    </fieldset>
  );
}

function More({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-md border px-2 py-1.5">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{title}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

// Builds are pure and fast up to ~32 racks; cache them per library so the "if chosen" lines are cheap.
const BUILDS = new WeakMap<LibItem[], Map<string, Nvl72PodResult | null>>();
function cachedBuild(x: Nvl72PodOptions, items: LibItem[], elec: RacklineProject["elec"]): Nvl72PodResult | null {
  let m = BUILDS.get(items);
  if (!m) { m = new Map(); BUILDS.set(items, m); }
  const k = JSON.stringify([x, elec]);
  if (!m.has(k)) {
    let r: Nvl72PodResult | null = null;
    try { r = buildReferencePod(x, items, elec); } catch { r = null; }
    if (m.size > 200) m.clear();
    m.set(k, r);
  }
  return m.get(k)!;
}

const sumOf = (r: Nvl72PodResult) => ({ mw: r.summary.itKW / 1000, pue: r.summary.pue, checks: r.warnings.length, racks: r.scenario.racks.length });

export function SetupPanel({
  kind, project, scenario, origin, onPreview, onCreate, onClose, goTab,
}: {
  kind: SetupKind;
  project: RacklineProject;
  /** The scenario open now: its saved answers seed the panel when it was built by the same generator. */
  scenario: Scenario;
  origin: [number, number];
  onPreview: (g: Ghost | null) => void;
  /** Commit a build. Returns the created scenario's name, or null if nothing was created. */
  onCreate: (r: SetupResult, mode: "new" | "replace") => string | null;
  onClose: () => void;
  goTab: (t: TabKey) => void;
}) {
  const units = project.units;
  const saved = scenario.setup?.kind === kind ? scenario.setup.options : null;
  const editing = !!saved;
  const edited = editing && editedSinceSetup(scenario);
  // Where the build lands: where it was built before, else the view centre when the panel opened.
  const [org] = useState<[number, number]>(() => (saved && typeof saved.ox === "number" && typeof saved.oy === "number" ? [saved.ox, saved.oy] : origin));
  const [step, setStep] = useState(0);
  const [o, setO] = useState<Nvl72PodOptions>(() => ({
    ...defaultNvl72Options(kind === "nvl72" && saved?.platform === "vr200" ? "vr200" : "gb300"),
    ...(kind === "nvl72" && saved ? (saved as Partial<Nvl72PodOptions>) : {}), ox: org[0], oy: org[1],
  }));
  const [g, setG] = useState<BlockOptions>(() => ({ ...defaultBlock(project.lib), ...(kind === "block" && saved ? (saved as Partial<BlockOptions>) : {}) }));
  const [done, setDone] = useState<{ name: string; mode: "new" | "replace" } | null>(null);
  const [sizeBy, setSizeBy] = useState<"racks" | "modules" | "gpus" | "mw">("racks");
  const set = (patch: Partial<Nvl72PodOptions>) => setO((x) => ({ ...x, ...patch }));
  const pick = (k: PickKey, label?: string) => setO((x) => ({ ...x, picks: { ...x.picks, [k]: label } }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Library the builds use: the project's, plus the NVL72 items when missing.
  const items = useMemo(() => {
    const l = project.lib.map((x) => ({ ...x, ports: { ...x.ports } }));
    if (kind === "nvl72") ensureNvl72Lib(l);
    return l;
  }, [project.lib, kind]);
  const lib: LibIndex = useMemo(() => libIndex(items), [items]);

  const build = (x: Nvl72PodOptions) => cachedBuild(x, items, project.elec);
  const res = kind === "nvl72" ? build(o) : null;

  const block = useMemo(() => {
    if (kind !== "block") return null;
    try {
      const s = buildScenario({ ...g, name: `${g.nodes}× · ${g.perRack}/rack · ${COOLING_LABEL[g.cooling]}`, red: scenario.cool.red, ox: org[0], oy: org[1] }, project.lib, project.elec);
      // The block's racks feed the default A/B panels; keep the scenario's single line when it has them.
      const hasDefault = ["rppa", "rppb"].every((id) => scenario.electrical.nodes.some((n) => n.id === id));
      s.electrical = hasDefault ? clone(scenario.electrical) : defaultElectrical();
      s.cool = { ...clone(scenario.cool), red: scenario.cool.red };
      return s;
    } catch { return null; }
  }, [kind, g, project.lib, project.elec, scenario, org]);

  const preview = useMemo<Ghost | null>(() => {
    const s = res?.scenario ?? block;
    if (!s) return null;
    return { scenario: s, an: analyze(s, { lib: res?.lib ? libIndex(res.lib) : lib, elec: res ? res.elec : project.elec }) };
  }, [res, block, lib, project.elec]);
  useEffect(() => { onPreview(done ? null : preview); }, [preview, done, onPreview]);
  useEffect(() => () => onPreview(null), [onPreview]);

  const commitBuild = (mode: "new" | "replace") => {
    const s = clone(res?.scenario ?? block);
    if (!s) return;
    s.setup = makeSetup(kind, kind === "nvl72" ? o : { ...g, ox: org[0], oy: org[1] }, s);
    if (mode === "replace") s.name = scenario.name;
    const name = onCreate({ scenario: s, lib: res?.lib ?? items, elec: res ? { vLL: res.elec.vLL, vLN: res.elec.vLN } : undefined }, mode);
    if (name) setDone({ name, mode });
  };

  // ── Impact of a choice: what the result would be with `patch` applied ─────
  const base = res ? sumOf(res) : null;
  const impact = (patch: Partial<Nvl72PodOptions>) => {
    if (!base || o.racks > 32) return null;
    const r = build({ ...o, ...patch });
    if (!r) return <span className="text-[var(--rl-bad)]">can&apos;t be built</span>;
    const n = sumOf(r);
    const same = (a: number, b: number, eps: number) => Math.abs(a - b) < eps;
    if (same(n.mw, base.mw, 0.005) && same(n.pue, base.pue, 0.005) && n.checks === base.checks && n.racks === base.racks) return <span>no change</span>;
    const parts: React.ReactNode[] = [];
    if (!same(n.mw, base.mw, 0.005)) parts.push(`${n.mw.toFixed(2)} MW`);
    if (!same(n.pue, base.pue, 0.005)) parts.push(`PUE ${base.pue.toFixed(2)} → ${n.pue.toFixed(2)}`);
    if (n.racks !== base.racks) parts.push(`${n.racks} racks in all`);
    if (n.checks !== base.checks) parts.push(<span key="c" className={n.checks > base.checks ? "text-[var(--rl-warn)]" : "text-[var(--rl-ok)]"}>{n.checks} check{n.checks === 1 ? "" : "s"}</span>);
    return <>{parts.map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}</>;
  };

  const cp = { set, impact };

  const vr = o.platform === "vr200";
  const rackKW = vr ? (o.vrProfile === "maxq" ? o.maxQKW : o.maxPKW) : o.profile === "nominal" ? 135 : 142;
  const net = vr ? vrNetwork(o.racks) : raNetwork(o.racks);
  const modules = Math.ceil(o.racks / Math.max(1, o.gpuPerModule));
  const setPlatform = (pl: Platform) => { if (pl !== o.platform) { setO({ ...defaultNvl72Options(pl), ox: org[0], oy: org[1] }); setSizeBy("racks"); } };
  const maxAmb = maxDryAmbientC(o.supplyC);
  const voltChange = res ? res.elec.vLL !== project.elec.vLL : false;
  const sizeVal = sizeBy === "racks" ? o.racks : sizeBy === "modules" ? +(o.racks / o.gpuPerModule).toFixed(2) : sizeBy === "gpus" ? o.racks * NVL72_RACK.gpus : +((o.racks * rackKW) / 1000).toFixed(2);
  const setSize = (v: number) => {
    const n = sizeBy === "racks" ? v : sizeBy === "modules" ? v * o.gpuPerModule : sizeBy === "gpus" ? v / NVL72_RACK.gpus : (v * 1000) / rackKW;
    const racks = Math.max(1, Math.min(128, Math.ceil(n - 1e-9)));
    set({ racks, perRow: Math.min(o.perRow, racks) || racks });
  };

  // ── Done ───────────────────────────────────────────────────────────────────
  if (done) {
    const s = scenario;
    const cnt = (f: (r: Scenario["racks"][number]) => boolean) => s.racks.filter(f).length;
    return (
      <div className="flex h-full flex-col">
        <PanelHead title={done.mode === "new" ? `Created "${done.name}"` : `Updated "${done.name}"`} onClose={onClose} />
        <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
          <p className="text-xs text-muted-foreground">It&apos;s a normal scenario now: move, add or delete anything on the plan, and edit the details on each tab. Undo with Ctrl+Z.</p>
          <ul className="space-y-1 text-xs">
            <li><b className="font-mono">{cnt((r) => r.role === "compute" && r.devs.length > 0)}</b> compute racks, <b className="font-mono">{cnt((r) => r.role === "network")}</b> network racks{cnt((r) => r.role === "storage") > 0 && <>, <b className="font-mono">{cnt((r) => r.role === "storage")}</b> support racks</>}</li>
            <li><b className="font-mono">{s.coolers.filter((c) => c.kind === "cdu").length}</b> CDUs, <b className="font-mono">{s.coolers.filter((c) => c.kind === "crah").length}</b> CRAHs, <b className="font-mono">{s.hacs.length}</b> containment zones, <b className="font-mono">{s.trays.length}</b> trays / busways</li>
            <li><b className="font-mono">{s.electrical.nodes.length}</b> single-line items, every rack on an A and a B feed</li>
          </ul>
          <div className="space-y-1">
            <p className="text-xs font-medium">Check and adjust what was set automatically</p>
            <div className="grid grid-cols-2 gap-1">
              <Btn onClick={() => goTab("power")}>Feeds &amp; PDUs</Btn>
              <Btn onClick={() => goTab("sld")}>Single line</Btn>
              <Btn onClick={() => goTab("network")}>Networks &amp; switches</Btn>
              <Btn onClick={() => goTab("cables")}>Cable routes</Btn>
              <Btn onClick={() => goTab("cooling")}>Cooling basis</Btn>
              <Btn onClick={() => goTab("elev")}>Rack contents</Btn>
            </div>
          </div>
          <Hint>Racks you add later take the feeds of their nearest rack, and network cables follow the Network tab&apos;s rules. You can change both.</Hint>
        </div>
        <footer className="flex flex-wrap gap-2 border-t p-3">
          <Btn onClick={() => { setDone(null); setStep(0); }}>Edit setup</Btn>
          <Btn tone="primary" className="ml-auto" onClick={onClose}>Done</Btn>
        </footer>
      </div>
    );
  }

  // ── Quick block ────────────────────────────────────────────────────────────
  if (kind === "block") {
    const ga = preview?.an;
    return (
      <div className="flex h-full flex-col">
        <PanelHead title="Quick block from your equipment" sub="Rows of racks filled with a library node, with containment, trays and cooling units. The plan shows a preview." onClose={onClose} />
        <div className="flex-1 space-y-4 overflow-y-auto p-3">
          {edited && <EditedBanner />}
          <Q title="How big?">
            <KV>
              <Label htmlFor="sb-n">Compute nodes</Label><NumField id="sb-n" min={1} step={1} value={g.nodes} onChange={(v) => setG({ ...g, nodes: Math.max(1, Math.round(v)) })} />
              <Label htmlFor="sb-per">Nodes per rack</Label><NumField id="sb-per" min={1} max={10} step={1} value={g.perRack} onChange={(v) => setG({ ...g, perRack: Math.max(1, Math.round(v)) })} />
              <Label htmlFor="sb-model">Node model</Label>
              <Select id="sb-model" width="w-full" value={g.model} onChange={(v) => setG({ ...g, model: v })} options={project.lib.filter((l) => l.cat === "compute").map((l) => [l.id, l.name])} />
            </KV>
          </Q>
          <Q title="Where does it go?">
            <Seg value={g.pattern} onChange={(v) => setG({ ...g, pattern: v })} options={[["pod", "Two rows, shared hot aisle"], ["single", "Single row"]]} />
            <More title="Rack width, aisles, network rack">
              <KV>
                <Label htmlFor="sb-w">Rack width</Label>
                <Select id="sb-w" value={String(g.rackW)} onChange={(v) => setG({ ...g, rackW: +v })} options={[["0.6", "600 mm"], ["0.8", "800 mm"]]} />
                <Label htmlFor="sb-hot">Hot aisle ({uLbl(units)})</Label><NumField id="sb-hot" step={0.1} value={toU(g.hot, units)} onChange={(v) => setG({ ...g, hot: fromU(v, units) })} />
                <Label htmlFor="sb-cold">Cold aisle ({uLbl(units)})</Label><NumField id="sb-cold" step={0.1} value={toU(g.cold, units)} onChange={(v) => setG({ ...g, cold: fromU(v, units) })} />
                <Label htmlFor="sb-net">Network rack</Label><input id="sb-net" type="checkbox" checked={g.net} onChange={(e) => setG({ ...g, net: e.target.checked })} />
              </KV>
            </More>
          </Q>
          <Q title="How is it cooled?">
            <Seg<CoolingScheme> value={g.cooling} onChange={(v) => setG({ ...g, cooling: v })} options={[["hac", "Containment + CRAH"], ["rdhx", "Rear doors"], ["hac+rdhx", "Both"]]} />
          </Q>
          {ga && ga.warns.length > 0 && <Q title="Checks"><WarnList items={ga.warns.slice(0, 8)} /></Q>}
        </div>
        <Footer
          summary={ga ? `${ga.racks.length} racks · ${n0(ga.it)} kW IT · PUE ≈ ${ga.pue.toFixed(2)}` : "These choices can't be built"}
          checks={ga?.warns.length ?? 0} ready={!!block} editing={editing}
          onNew={() => commitBuild("new")} onReplace={() => commitBuild("replace")}
        />
      </div>
    );
  }

  // ── GB300 NVL72 reference design ──────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      <PanelHead
        title={vr ? "Reference design: Vera Rubin NVL72 hall" : "Reference design: GB300 NVL72 pod"}
        sub={`${PLATFORMS[o.platform].ra}, with your MEP catalog. The plan shows a live preview; nothing changes until you create it.`}
        onClose={onClose}
      />
      <nav aria-label="Steps" className="flex gap-1 overflow-x-auto border-b px-2 py-1.5">
        {STEPS.map((t, i) => (
          <button key={t} type="button" onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined}
            className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs ${step === i ? "bg-[var(--rl-accent-soft)] font-medium text-foreground" : "text-muted-foreground hover:bg-accent"}`}>
            <span className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] ${i < step ? "border-[var(--rl-accent)] bg-[var(--rl-accent)] text-white" : ""}`}>{i < step ? "✓" : i + 1}</span>{t}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {edited && <EditedBanner />}
        {step === 0 && (
          <Q title="Which reference design?">
            <div className="grid gap-2">
              {(Object.keys(PLATFORMS) as Platform[]).map((pl) => (
                <button key={pl} type="button" onClick={() => setPlatform(pl)} aria-pressed={o.platform === pl}
                  className={`w-full rounded-md border p-2.5 text-left text-sm transition-colors ${o.platform === pl ? "border-[var(--rl-accent)] bg-[var(--rl-accent-soft)]" : "border-input hover:bg-accent"}`}>
                  <span className="flex items-center justify-between gap-2 font-medium">{PLATFORMS[pl].label}<Chip tone="mute">{PLATFORMS[pl].ra}</Chip></span>
                  <span className="mt-1 block text-xs text-muted-foreground">{PLATFORMS[pl].summary}</span>
                </button>
              ))}
            </div>
            {o.platform !== "gb300" && saved && saved.platform !== o.platform && <Hint>Switching platform starts from that design&apos;s defaults.</Hint>}
          </Q>
        )}

        {vr && step === 0 && (
          <>
            <Q title="How big is the hall?" help={`The reference design builds the hall from AI Modules of ${VR_RD.gpuPerModule} GPU racks and ${VR_RD.supportPerModule} support racks (${VR_RD.moduleMW} MW at 200 kW). Enter what you know.`}>
              <div className="flex flex-wrap items-center gap-2">
                <Seg value={sizeBy} onChange={setSizeBy} options={[["racks", "GPU racks"], ["modules", "AI Modules"], ["gpus", "GPUs"], ["mw", "GPU MW"]]} />
                <NumField id="sp-vsize" min={0} step={sizeBy === "mw" || sizeBy === "modules" ? 0.5 : 1} value={sizeVal} onChange={setSize} />
              </div>
              <div className="flex flex-wrap gap-1">
                {[1, 2, 4, 8].map((n) => <Btn key={n} on={o.racks === n * o.gpuPerModule} onClick={() => set({ racks: n * o.gpuPerModule })}>{n} module{n > 1 ? "s" : ""}{n === 4 ? " (reference design)" : ""}</Btn>)}
              </div>
              <Hint>= <b className="text-foreground">{o.racks} GPU racks</b> in {modules} AI Module{modules > 1 ? "s" : ""} · {o.racks * 72} GPUs · {((o.racks * rackKW) / 1000).toFixed(2)} MW of GPU racks + ~{Math.ceil((o.racks * o.supportPerModule) / o.gpuPerModule)} support racks.</Hint>
            </Q>
            <Q title="Rack power profile" help="Every VR200 rack has a Max-Q and a Max-P rating; the design load uses one. Edit the ratings if your OEM's differ.">
              <div className="grid gap-2">
                <Card {...cp} on={o.vrProfile === "maxp"} title={`Max-P · ${o.maxPKW} kW per rack`} tag="full performance" patch={{ vrProfile: "maxp" }}>Size power and cooling for the highest draw.</Card>
                <Card {...cp} on={o.vrProfile === "maxq"} title={`Max-Q · ${o.maxQKW} kW per rack`} tag="best perf / W" patch={{ vrProfile: "maxq" }}>More racks per MW; the rack is capped to this power.</Card>
              </div>
              <KV>
                <Label htmlFor="sp-mq">Max-Q rating (kW)</Label><NumField id="sp-mq" step={1} min={50} max={600} value={o.maxQKW} onChange={(v) => set({ maxQKW: Math.max(1, v) })} />
                <Label htmlFor="sp-mxp">Max-P rating (kW)</Label><NumField id="sp-mxp" step={1} min={50} max={600} value={o.maxPKW} onChange={(v) => set({ maxPKW: Math.max(1, v) })} />
              </KV>
              <Hint>Defaults 187 / 227 kW. For reference: SemiAnalysis reports 180–220 kW; the reference design plans 200 kW nominal. The ratings stay on the rack type and can be changed later on Rack elevations.</Hint>
            </Q>
            <More title="AI Module make-up (reference design)">
              <KV>
                <Label htmlFor="sp-gpm">GPU racks per module</Label><NumField id="sp-gpm" step={1} min={1} max={40} value={o.gpuPerModule} onChange={(v) => set({ gpuPerModule: Math.max(1, Math.round(v)) })} />
                <Label htmlFor="sp-spm">Support racks per module</Label><NumField id="sp-spm" step={1} min={1} max={40} value={o.supportPerModule} onChange={(v) => set({ supportPerModule: Math.max(1, Math.round(v)) })} />
                <Label htmlFor="sp-skw">Support rack load (kW)</Label><NumField id="sp-skw" step={1} min={5} max={60} value={o.supportKW} onChange={(v) => set({ supportKW: v })} />
              </KV>
              <Hint>Support racks hold the network switches, then support equipment blocks up to their design load. Reference design: 14 GPU + 16 support racks at 35 kW.</Hint>
            </More>
            <More title="Networks (estimate)">
              <Table head={["Fabric", "Leaf", "Spine"]} numeric={[1, 2]}>
                <tr><td>Compute (east-west, 144 × 800G per rack)</td><td className="n">{net.computeLeaf}</td><td className="n">{net.computeSpine}{net.superSpine ? ` + ${net.superSpine}` : ""}</td></tr>
                <tr><td>Converged (BlueField-4, 18 × 800G per rack)</td><td className="n">{net.convLeaf}</td><td className="n">{net.convSpine}</td></tr>
                <tr><td>Out-of-band (2 in each GPU rack, 1 per support rack)</td><td className="n">{net.oob}+</td><td className="n" /></tr>
              </Table>
              <Hint>{net.notes.join(" ")}</Hint>
            </More>
          </>
        )}

        {!vr && step === 0 && (
          <>
            <Q title="How big is the pod?" help="Enter what you know: racks, GPUs or IT megawatts. One rack is one NVIDIA scalable unit: 72 GPUs in one NVLink domain.">
              <div className="flex flex-wrap items-center gap-2">
                <Seg value={sizeBy} onChange={setSizeBy} options={[["racks", "Racks"], ["gpus", "GPUs"], ["mw", "IT MW"]]} />
                <NumField id="sp-size" min={0} step={sizeBy === "mw" ? 0.1 : 1} value={sizeVal} onChange={setSize} />
              </div>
              <div className="flex flex-wrap gap-1">
                {[2, 4, 8, 16, 32].map((n) => <Btn key={n} on={o.racks === n} onClick={() => set({ racks: n, perRow: Math.min(o.perRow, n) || n })}>{n} racks</Btn>)}
              </div>
              <Hint>= <b className="text-foreground">{o.racks} racks</b> · {o.racks * 72} GPUs · {((o.racks * rackKW) / 1000).toFixed(2)} MW of racks. {o.racks > 8 ? "Beyond the RA's tested 8 racks: switch counts are an estimate." : `The RA's ${net.design}-rack design.`}</Hint>
            </Q>
            <Q title="Design load per rack" help="8 power shelves of 33 kW per rack, each on one 60 A whip, half on each feed.">
              <div className="grid gap-2">
                <Card {...cp} on={o.profile === "max"} title="142 kW" tag="NVIDIA RA" patch={{ profile: "max" }}>The RA&apos;s full-rack figure: sizes for the worst case.</Card>
                <Card {...cp} on={o.profile === "nominal"} title="135 kW" tag="OEM TDP" patch={{ profile: "nominal" }}>Lenovo TDP (HPE quotes 132 kW): more racks per MW.</Card>
              </div>
            </Q>
            <Q title="Control plane">
              <div className="grid gap-2">
                <Card {...cp} on={o.mgmtNodes} title="Add the RA's 12 management nodes" tag="RA" patch={{ mgmtNodes: true }}>In their own rack beside the network racks.</Card>
                <Card {...cp} on={!o.mgmtNodes} title="It lives elsewhere" patch={{ mgmtNodes: false }} />
              </div>
            </Q>
            <More title="Networks the RA sizes for this pod">
              <Table head={["Fabric", "Leaf", "Spine"]} numeric={[1, 2]}>
                <tr><td>Compute (east-west)</td><td className="n">{net.computeLeaf}</td><td className="n">{net.computeSpine}{net.superSpine ? ` + ${net.superSpine}` : ""}</td></tr>
                <tr><td>Converged (storage, in-band)</td><td className="n">{net.convLeaf}</td><td className="n">{net.convSpine}</td></tr>
                <tr><td>Out-of-band (in each rack)</td><td className="n">{net.oob}</td><td className="n" /></tr>
              </Table>
              <Hint>SN5600 leaves and spines; 2 SN2201 in every rack. 144 × 400G compute, 36 × 400G converged and 54 × 1G BMC ports per rack.</Hint>
            </More>
          </>
        )}

        {vr && step === 1 && (
          <>
            <Q title="How is each AI Module laid out?" help="As the reference design: two facing rows per module, GPU racks then the CDUs then support racks, with a compute hot aisle and a support hot aisle. Modules stack down the hall. You can move anything after creating it.">
              <div className="grid gap-2">
                <Card {...cp} on={o.cduPos === "in-row"} title="CDUs between the GPU and support racks" tag="Reference design" patch={{ cduPos: "in-row" }}>Two per module, at the head of the compute rows.</Card>
                <Card {...cp} on={o.cduPos === "gallery"} title="CDUs along one wall (gallery)" patch={{ cduPos: "gallery" }}>Out of the white space; longer piping.</Card>
              </div>
            </Q>
            <Q title="What floor?">
              <div className="grid gap-2">
                <Card {...cp} on={o.floor === "slab"} title="Slab on grade" tag="recommended" patch={{ floor: "slab" }}>Overhead busway and liquid; carries the heaviest racks.</Card>
                <Card {...cp} on={o.floor === "raised"} title="Raised floor" patch={{ floor: "raised" }}>Needs a concentrated and rolling load check.</Card>
              </div>
            </Q>
            <More title="Aisle widths and containment">
              <KV>
                <Label htmlFor="sp-vcold">Cold aisle ({uLbl(units)})</Label><NumField id="sp-vcold" step={0.1} value={toU(o.cold, units)} onChange={(v) => set({ cold: fromU(v, units) })} />
                <Label htmlFor="sp-vhot">Hot aisle ({uLbl(units)})</Label><NumField id="sp-vhot" step={0.1} value={toU(o.hot, units)} onChange={(v) => set({ hot: fromU(v, units) })} />
                <Label htmlFor="sp-vhac">Compute and support containment</Label>
                <input id="sp-vhac" type="checkbox" checked={o.contain} onChange={(e) => set({ contain: e.target.checked })} />
              </KV>
              <Hint>GPU racks are fully liquid cooled; the support racks ({o.supportKW} kW each) are air cooled by CRAHs on chilled water.</Hint>
            </More>
          </>
        )}

        {!vr && step === 1 && (
          <>
            <Q title="How are the rows arranged?" help={`GB300 NVL72 racks are ${NVL72_RACK.w * 1000} × ${Math.round(NVL72_RACK.d * 1000)} mm. You can move anything on the plan after creating it.`}>
              <KV><Label htmlFor="sp-row">Compute racks per row</Label><NumField id="sp-row" min={1} max={32} step={1} value={o.perRow} onChange={(v) => set({ perRow: Math.max(1, Math.round(v)) })} /></KV>
              <div className="grid gap-2">
                <Card {...cp} on={o.pattern === "pod"} title="Two-row pods, shared hot aisle" tag="recommended" patch={{ pattern: "pod" }}>Rows face each other; one containment per pod.</Card>
                <Card {...cp} on={o.pattern === "single"} title="Single rows" patch={{ pattern: "single", contain: false }}>Each row stands alone, e.g. in a narrow hall.</Card>
              </div>
            </Q>
            <Q title="Where do the network racks go?">
              <div className="grid gap-2">
                <Card {...cp} on={o.netPos === "end"} title="End of each row" patch={{ netPos: "end" }}>Simple trays; longest runs to the far rack.</Card>
                <Card {...cp} on={o.netPos === "middle"} title="Middle of each row" patch={{ netPos: "middle" }}>Shorter, more even fiber lengths.</Card>
              </div>
            </Q>
            <Q title="Where do the CDUs go?">
              <div className="grid gap-2">
                <Card {...cp} on={o.cduPos === "in-row"} title="At the row ends" patch={{ cduPos: "in-row" }}>Short rack loops.</Card>
                <Card {...cp} on={o.cduPos === "gallery"} title="Along one wall (gallery)" patch={{ cduPos: "gallery" }}>Out of the white space; longer piping.</Card>
              </div>
            </Q>
            <Q title="What floor?">
              <div className="grid gap-2">
                <Card {...cp} on={o.floor === "slab"} title="Slab on grade" tag="recommended" patch={{ floor: "slab" }}>Overhead power and liquid; carries ~3,000 lb racks.</Card>
                <Card {...cp} on={o.floor === "raised"} title="Raised floor" patch={{ floor: "raised" }}>Needs a concentrated and rolling load check.</Card>
              </div>
            </Q>
            <More title="Aisle widths and containment">
              <KV>
                <Label htmlFor="sp-cold">Cold aisle ({uLbl(units)})</Label><NumField id="sp-cold" step={0.1} value={toU(o.cold, units)} onChange={(v) => set({ cold: fromU(v, units) })} />
                <Label htmlFor="sp-hot">Hot aisle ({uLbl(units)})</Label><NumField id="sp-hot" step={0.1} value={toU(o.hot, units)} onChange={(v) => set({ hot: fromU(v, units) })} />
                <Label htmlFor="sp-hac">Hot aisle containment</Label>
                <input id="sp-hac" type="checkbox" disabled={o.pattern !== "pod"} checked={o.contain && o.pattern === "pod"} onChange={(e) => set({ contain: e.target.checked })} />
              </KV>
              <Hint>About 10 % of each rack&apos;s heat (~14 kW) still goes to room air, plus the network and control-plane racks.</Hint>
            </More>
          </>
        )}

        {step === 2 && (
          <>
            <Q title="How is power made redundant?" help="Each rack's power shelves are fed from two independent sources, A and B.">
              <div className="grid gap-2">
                {(Object.keys(POWER_ARCH) as PowerArch[]).filter((k) => POWER_ARCH[k].platforms.includes(o.platform)).map((k) => (
                  <Card {...cp} key={k} on={o.power === k} title={POWER_ARCH[k].label} patch={{ power: k }}>{POWER_ARCH[k].summary}</Card>
                ))}
              </div>
            </Q>
            {vr && o.power === "power-pods" && (
              <Q title="Backup in each Power Pod" help="The reference design makes UPS and generator optional, by criticality and site backup strategy.">
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={o.ups} onChange={(e) => set({ ups: e.target.checked })} /> UPS (2 × {o.upsKva} kVA per Pod)</label>
                <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={o.gen} onChange={(e) => set({ gen: e.target.checked })} /> Generator ({o.genKw / 1000} MW per Pod, {o.mechXfmrKva / 1000} MW per mechanical powertrain)</label>
              </Q>
            )}
            <Q title="How do circuits reach the racks?">
              <div className="grid gap-2">
                <Card {...cp} on={o.feed === "busway"} title="Overhead busway and tap-offs" tag={vr ? "Reference design" : undefined} patch={{ feed: "busway" }}>{vr ? `${o.busAmps} A feeders above each row; racks plug in with tap-off units.` : "Plug-in tap-offs above each row; quick to change."}</Card>
                <Card {...cp} on={o.feed === "rpp"} title="Row panels with whips" patch={{ feed: "rpp" }}>A breaker per power-shelf circuit (8 whips per rack).</Card>
              </div>
            </Q>
            <Q title="Distribution voltage">
              <Seg value={String(o.voltage) as "415" | "480"} onChange={(v) => set({ voltage: +v as 415 | 480 })} options={[["480", "480 V (North America)"], ["415", "415 V (international)"]]} />
              {voltChange && (
                <p className="rounded-md border border-[var(--rl-warn)] bg-[var(--rl-warn-soft)] p-2 text-xs">
                  This project runs at {project.elec.vLL} V. Creating this pod switches the whole project (all scenarios) to {o.voltage} V.{" "}
                  <button type="button" className="underline" onClick={() => set({ voltage: project.elec.vLL === 480 ? 480 : 415 })}>Keep {project.elec.vLL} V</button>
                </p>
              )}
            </Q>
            <More title="Equipment details: products and ratings">
              <KV>
                {o.feed === "rpp"
                  ? <><Label htmlFor="sp-rpp">RPP rating (A)</Label><Select id="sp-rpp" value={String(o.rppAmps)} onChange={(v) => set({ rppAmps: +v })} options={[["400", "400 A"], ["600", "600 A"], ["800", "800 A"], ["1000", "1000 A"], ["1200", "1200 A"]]} /></>
                  : <>
                      <Label htmlFor="sp-bus">Busway product</Label><Pick id="sp-bus" comp="busway" value={o.picks.busway} unit="A" onPick={(l, r) => { pick("busway", l); if (r) set({ busAmps: r }); }} />
                      <Label htmlFor="sp-busa">Busway rating (A)</Label><NumField id="sp-busa" step={50} min={100} value={o.busAmps} onChange={(v) => set({ busAmps: v })} />
                    </>}
                <Label htmlFor="sp-tx">Transformer</Label><Pick id="sp-tx" comp="transformers" value={o.picks.transformers} onPick={(l) => pick("transformers", l)} />
                <Label htmlFor="sp-txk">Transformer (kVA)</Label><NumField id="sp-txk" step={250} min={500} value={o.xfmrKva} onChange={(v) => set({ xfmrKva: v })} />
                <Label htmlFor="sp-sw">Switchboard</Label><Pick id="sp-sw" comp="lv" value={o.picks.lv} onPick={(l) => pick("lv", l)} />
                <Label htmlFor="sp-ups">UPS</Label><Pick id="sp-ups" comp="ups" value={o.picks.ups} unit="kVA" onPick={(l, r) => { pick("ups", l); if (r) set({ upsKva: r }); }} />
                <Label htmlFor="sp-upsk">UPS module (kVA)</Label><NumField id="sp-upsk" step={100} min={100} value={o.upsKva} onChange={(v) => set({ upsKva: v })} />
                <Label htmlFor="sp-gen">Generator</Label><Pick id="sp-gen" comp="generators" value={o.picks.generators} unit="kW" onPick={(l, r) => { pick("generators", l); if (r) set({ genKw: r }); }} />
                <Label htmlFor="sp-genk">Generator (kW)</Label><NumField id="sp-genk" step={250} min={250} value={o.genKw} onChange={(v) => set({ genKw: v })} />
                {vr && o.power === "power-pods" && <>
                  <Label htmlFor="sp-fpp">Feeders per Power Pod</Label><NumField id="sp-fpp" step={1} min={1} max={12} value={o.feedersPerPod} onChange={(v) => set({ feedersPerPod: Math.max(1, Math.round(v)) })} />
                  <Label htmlFor="sp-mtx">Mechanical transformer (kVA)</Label><NumField id="sp-mtx" step={250} min={500} value={o.mechXfmrKva} onChange={(v) => set({ mechXfmrKva: v })} />
                </>}
              </KV>
              <Hint>Products come from the Cost Model&apos;s MEP catalog; picking one fills its published rating where stated.</Hint>
            </More>
          </>
        )}

        {vr && step === 3 && (
          <>
            <Q title="How is the heat rejected?" help={`Reference design: direct-to-chip liquid through CDUs to dry / fluid coolers on a ${VR_RD.dryLoopC[0]}/${VR_RD.dryLoopC[1]} °C loop, chillers on ${VR_RD.chwLoopC[0]}/${VR_RD.chwLoopC[1]} °C for the CRAHs and to assist above 82 °F (${VR_RD.switchC} °C) dry bulb, with ~${VR_RD.tesMin} min of thermal storage.`}>
              <div className="grid gap-2">
                <Card {...cp} on={o.heatRej === "drycooler"} title="Dry / fluid coolers with chiller assist" tag="Reference design" patch={{ heatRej: "drycooler" }}>Lowest energy; chillers serve the CRAHs and trim on hot days.</Card>
                <Card {...cp} on={o.heatRej === "chiller"} title="Chillers for everything" patch={{ heatRej: "chiller" }}>For very hot climates or an existing chilled-water plant.</Card>
              </div>
              {o.heatRej === "drycooler" && o.ambC > maxAmb && (
                <div className="space-y-1.5 rounded-md border border-[var(--rl-bad)] bg-[var(--rl-bad-soft)] p-2 text-xs">
                  <p>{o.ambC} °C design ambient is too hot for dry coolers at {o.supplyC} °C supply (limit ≈ {maxAmb} °C).</p>
                  <div className="flex flex-wrap gap-1"><Btn onClick={() => set({ heatRej: "chiller" })}>Use chillers</Btn></div>
                </div>
              )}
            </Q>
            <Q title="IT coolant" help="NVIDIA designs Vera Rubin for up to 45 °C inlet; the reference design assumes about 10 K across the rack.">
              <KV>
                <Label htmlFor="sp-vsup">Supply (°C, up to 45)</Label><NumField id="sp-vsup" step={1} min={20} max={45} value={o.supplyC} onChange={(v) => set({ supplyC: v })} />
                <Label htmlFor="sp-vdt">ΔT across the rack (K)</Label><NumField id="sp-vdt" step={1} min={4} max={20} value={o.deltaC} onChange={(v) => set({ deltaC: v })} />
                <Label htmlFor="sp-vamb">Design ambient (°C)</Label><NumField id="sp-vamb" step={1} min={-20} max={55} value={o.ambC} onChange={(v) => set({ ambC: v })} />
              </KV>
              <Hint>{Math.round(tcsLpmPerKW(o.deltaC) * rackKW)} L/min per rack at {o.deltaC} K (PG25).</Hint>
            </Q>
            <More title="CDUs and CRAHs">
              <KV>
                <Label htmlFor="sp-vcdu">CDU product</Label><Pick id="sp-vcdu" comp="cdus" value={o.picks.cdus} unit="kW" onPick={(l, r) => { pick("cdus", l); if (r) set({ cduKW: r }); }} />
                <Label htmlFor="sp-vcduk">CDU capacity (kW)</Label><NumField id="sp-vcduk" step={100} min={100} value={o.cduKW} onChange={(v) => set({ cduKW: v })} />
                <Label htmlFor="sp-vcdur">CDU redundancy</Label>
                <Select<Redundancy> id="sp-vcdur" value={o.cduRed} onChange={(v) => set({ cduRed: v })} options={[["N", "N"], ["N+1", "N+1"], ["N+2", "N+2"], ["2N", "2N"]]} />
                <Label htmlFor="sp-vch">Chiller product</Label><Pick id="sp-vch" comp="chillers" value={o.picks.chillers} onPick={(l) => pick("chillers", l)} />
                <Label htmlFor="sp-vcrah">CRAH product</Label><Pick id="sp-vcrah" comp="crah" value={o.picks.crah} onPick={(l) => pick("crah", l)} />
              </KV>
              <Hint>The reference design places two CDUs per module (N+1), so one CDU must carry a module&apos;s liquid load ({Math.round(o.gpuPerModule * rackKW)} kW).</Hint>
            </More>
          </>
        )}

        {!vr && step === 3 && (
          <>
            <Q title="How is the heat rejected?">
              <div className="grid gap-2">
                <Card {...cp} on={o.heatRej === "chiller"} title="Chillers" patch={{ heatRej: "chiller" }}>Works in any climate; higher energy use.</Card>
                <Card {...cp} on={o.heatRej === "drycooler"} title="Dry coolers, no chillers" patch={{ heatRej: "drycooler" }}>Lowest energy, no water use, while ambient stays under about {maxAmb} °C.</Card>
              </div>
              {o.heatRej === "drycooler" && o.ambC > maxAmb && (
                <div className="space-y-1.5 rounded-md border border-[var(--rl-bad)] bg-[var(--rl-bad-soft)] p-2 text-xs">
                  <p>{o.ambC} °C design ambient is too hot for dry coolers at {o.supplyC} °C supply (limit ≈ {maxAmb} °C).</p>
                  <div className="flex flex-wrap gap-1">
                    <Btn onClick={() => set({ heatRej: "chiller" })}>Use chillers</Btn>
                    {o.ambC + 10 <= 45 && <Btn onClick={() => set({ supplyC: o.ambC + 10 })}>Raise supply to {o.ambC + 10} °C</Btn>}
                  </div>
                </div>
              )}
            </Q>
            <Q title="Coolant supply temperature" help="GB300 NVL72 allows 25–45 °C. Warmer water lets dry coolers do more, but each rack needs much more flow.">
              <KV>
                <Label htmlFor="sp-sup">Supply (°C)</Label><NumField id="sp-sup" step={1} min={25} max={45} value={o.supplyC} onChange={(v) => set({ supplyC: v })} />
                <Label htmlFor="sp-amb">Design ambient (°C)</Label><NumField id="sp-amb" step={1} min={-20} max={55} value={o.ambC} onChange={(v) => set({ ambC: v })} />
              </KV>
              <Hint>{Math.round(gb300LpmPerKW(o.supplyC) * rackKW)} L/min per rack at {o.supplyC} °C (Lenovo LP2357 Table 27).</Hint>
            </Q>
            <More title="CDUs, CRAHs and facility water">
              <KV>
                <Label htmlFor="sp-cdu">CDU product</Label><Pick id="sp-cdu" comp="cdus" value={o.picks.cdus} unit="kW" onPick={(l, r) => { pick("cdus", l); if (r) set({ cduKW: r }); }} />
                <Label htmlFor="sp-cduk">CDU capacity (kW)</Label><NumField id="sp-cduk" step={50} min={100} value={o.cduKW} onChange={(v) => set({ cduKW: v })} />
                <Label htmlFor="sp-cdur">CDU redundancy</Label>
                <Select<Redundancy> id="sp-cdur" value={o.cduRed} onChange={(v) => set({ cduRed: v })} options={[["N", "N"], ["N+1", "N+1"], ["N+2", "N+2"], ["2N", "2N"]]} />
                {o.heatRej === "chiller" && <><Label htmlFor="sp-ch">Chiller product</Label><Pick id="sp-ch" comp="chillers" value={o.picks.chillers} onPick={(l) => pick("chillers", l)} /></>}
                <Label htmlFor="sp-crah">CRAH product</Label><Pick id="sp-crah" comp="crah" value={o.picks.crah} onPick={(l) => pick("crah", l)} />
                <Label htmlFor="sp-dt">Facility water ΔT (K)</Label><NumField id="sp-dt" step={1} min={4} max={20} value={o.deltaC} onChange={(v) => set({ deltaC: v })} />
              </KV>
            </More>
          </>
        )}

        {step === 4 && res && (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Fact label="Racks" value={`${res.summary.racks} · ${res.summary.gpus} GPUs`} />
              <Fact label="IT load" value={`${(res.summary.itKW / 1000).toFixed(2)} MW`} />
              <Fact label="Est. PUE" value={res.summary.pue.toFixed(2)} />
              <Fact label="CDUs / CRAHs" value={`${res.summary.cduTot} / ${res.summary.crahTot}`} />
            </div>
            {vr && <Hint>The reference design&apos;s planning basis for its 13.44 MW hall: PUE {VR_RD.pue}, {VR_RD.mechMW} MW mechanical, {VR_RD.siteMW} MW site. This estimate comes from the Cooling tab&apos;s basis.</Hint>}
            <Q title={res.warnings.length ? `${res.warnings.length} checks to review` : "Checks"}>
              <WarnList items={res.warnings.map((msg) => ({ sev: "warn" as const, msg }))} />
              <Fixes o={o} res={res} set={set} goStep={setStep} />
            </Q>
            <More title="Bill of materials">
              <Table head={["Item", "Qty", "Detail"]} numeric={[1]}>
                {res.bom.map((b) => <tr key={b.item}><td>{b.item}</td><td className="n">{b.qty || "–"}</td><td>{b.detail}</td></tr>)}
              </Table>
            </More>
            <More title="Automatic rules (editable)">
              <KV>
                <Label htmlFor="sp-nk">Network rack air limit (kW)</Label><NumField id="sp-nk" step={1} min={5} max={60} value={o.netRackKW} onChange={(v) => set({ netRackKW: v })} />
                <Label htmlFor="sp-mp">Mechanical load (% of IT, 0 = auto)</Label><NumField id="sp-mp" step={5} min={0} max={100} value={o.mechPct} onChange={(v) => set({ mechPct: v })} />
                <Label htmlFor="sp-up">Uplinks per endpoint cable</Label><NumField id="sp-up" step={0.05} min={0} max={2} value={o.uplink} onChange={(v) => set({ uplink: v })} />
                <Label htmlFor="sp-dc">Upsize fiber ducts to pass fill</Label><input id="sp-dc" type="checkbox" checked={o.sizeDucts} onChange={(e) => set({ sizeDucts: e.target.checked })} />
              </KV>
              <Seg value={o.fabricAttach} onChange={(v) => set({ fabricAttach: v })} options={[["spread", "Fabrics: every leaf rack"], ["nearest", "Nearest leaf rack"]]} />
              <Hint>Defaults: {NET_RACK_KW} kW per network rack, mechanical 50 % (chillers) or 25 % (dry coolers), non-blocking fabric, rail-optimised. After creating, the same rules live on the Network, Cable pathways and Single line tabs.</Hint>
            </More>
            {res.notes.length > 0 && <More title="Notes"><ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">{res.notes.map((n) => <li key={n}>{n}</li>)}</ul></More>}
            <More title="Sources and assumptions">
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {vr && <li>VR200 modular reference design: planning-level basis of design (document on file).</li>}
                {(vr ? VR_SOURCES : SOURCES).map(([t, u]) => <li key={u}><a className="underline" href={u} target="_blank" rel="noreferrer">{t}</a></li>)}
                <li>MEP products: Cost Model catalog (data/equipment-catalog.json).</li>
                <li>{vr ? "Network switch counts and power, support-rack contents, BMC port counts and rack weight are estimates; the reference design's values are planning-level and need validation (NEC continuous load, short-circuit, CFD, TES)." : "Loaded rack weight (~3,000 lb), switch and management-node power, and switch counts beyond 8 racks are estimates."}</li>
              </ul>
            </More>
          </>
        )}
        {step === 4 && !res && <p className="text-sm text-destructive">These choices can&apos;t be built. Go back and check the inputs.</p>}
      </div>

      <Footer
        summary={res ? `${res.summary.racks} racks · ${res.summary.gpus} GPUs · ${(res.summary.itKW / 1000).toFixed(2)} MW · PUE ≈ ${res.summary.pue.toFixed(2)}` : "These choices can't be built"}
        checks={res?.warnings.length ?? 0} onChecks={() => setStep(4)} ready={!!res} editing={editing}
        back={step > 0 ? () => setStep(step - 1) : undefined}
        next={step < STEPS.length - 1 ? { label: STEPS[step + 1], go: () => setStep(step + 1) } : undefined}
        onNew={() => commitBuild("new")} onReplace={() => commitBuild("replace")}
      />
    </div>
  );
}

/** A selectable card for a choice point; shows what it would change when not selected. */
function Card({ on, title, tag, patch, children, set, impact }: {
  on: boolean; title: string; tag?: string; patch: Partial<Nvl72PodOptions>; children?: React.ReactNode;
  set: (p: Partial<Nvl72PodOptions>) => void; impact: (p: Partial<Nvl72PodOptions>) => React.ReactNode;
}) {
  const effect = on ? null : impact(patch);
  return (
    <button
      type="button" onClick={() => set(patch)} aria-pressed={on}
      className={`w-full rounded-md border p-2.5 text-left text-sm transition-colors ${on ? "border-[var(--rl-accent)] bg-[var(--rl-accent-soft)]" : "border-input hover:bg-accent"}`}
    >
      <span className="flex items-center justify-between gap-2 font-medium">{title}{tag && <Chip tone="mute">{tag}</Chip>}</span>
      {children && <span className="mt-1 block text-xs text-muted-foreground">{children}</span>}
      {effect && <span className="mt-1 block font-mono text-[11px] text-muted-foreground">If chosen: {effect}</span>}
    </button>
  );
}

function PanelHead({ title, sub, onClose }: { title: string; sub?: string; onClose: () => void }) {
  return (
    <header className="flex items-start justify-between gap-2 border-b px-3 py-2.5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <p className="text-[11px] leading-snug text-muted-foreground">{sub}</p>}
      </div>
      <button onClick={onClose} aria-label="Close setup" className="rounded-md px-2 py-0.5 text-muted-foreground hover:bg-accent">✕</button>
    </header>
  );
}

function EditedBanner() {
  return (
    <p className="rounded-md border border-[var(--rl-warn)] bg-[var(--rl-warn-soft)] p-2 text-xs">
      This layout has been edited since it was set up. <b>Update this scenario</b> rebuilds it from these answers and discards those edits; <b>Add as new scenario</b> keeps them.
    </p>
  );
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border px-2 py-1.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className="font-mono text-sm">{value}</div></div>
);

/** One-click fixes for the checks a choice in the setup can resolve. */
function Fixes({ o, res, set, goStep }: { o: Nvl72PodOptions; res: Nvl72PodResult; set: (p: Partial<Nvl72PodOptions>) => void; goStep: (i: number) => void }) {
  const w = res.warnings.join("\n");
  const out: React.ReactNode[] = [];
  if (/a dry cooler can serve/.test(w)) out.push(<Btn key="ch" onClick={() => set({ heatRej: "chiller" })}>Use chillers</Btn>);
  if (/RPP|Busway/.test(w) && /exceeds rating/.test(w))
    out.push(o.feed === "rpp" ? <Btn key="rpp" onClick={() => set({ rppAmps: Math.min(1200, o.rppAmps + 200) })}>Larger RPPs ({Math.min(1200, o.rppAmps + 200)} A)</Btn> : <Btn key="bus" onClick={() => set({ busAmps: o.busAmps + 250 })}>Larger busway ({o.busAmps + 250} A)</Btn>);
  if (/tray fill/.test(w) && !o.sizeDucts) out.push(<Btn key="duct" onClick={() => set({ sizeDucts: true })}>Upsize fiber ducts</Btn>);
  if (/raised-floor/.test(w)) out.push(<Btn key="slab" onClick={() => set({ floor: "slab" })}>Use slab on grade</Btn>);
  if (/outside the 25–45/.test(w)) out.push(<Btn key="sup" onClick={() => set({ supplyC: Math.min(45, Math.max(25, o.supplyC)) })}>Bring supply into 25–45 °C</Btn>);
  if (/when one feed is lost/.test(w)) out.push(o.platform === "vr200" && o.vrProfile === "maxp"
    ? <Btn key="feed" onClick={() => set({ vrProfile: "maxq" })}>Use Max-Q</Btn>
    : <Btn key="feed" onClick={() => goStep(0)}>Review rack load</Btn>);
  if (!out.length) return null;
  return <div className="flex flex-wrap gap-1"><span className="self-center text-xs text-muted-foreground">Fix:</span>{out}</div>;
}

function Footer({ summary, checks, onChecks, ready, editing, back, next, onNew, onReplace }: {
  summary: string; checks: number; onChecks?: () => void; ready: boolean; editing: boolean;
  back?: () => void; next?: { label: string; go: () => void }; onNew: () => void; onReplace: () => void;
}) {
  return (
    <footer className="space-y-2 border-t p-3">
      <p className="text-[11px] text-muted-foreground">
        {summary}
        {checks > 0 && <> · <button type="button" className="text-[var(--rl-warn)] underline" onClick={onChecks}>{checks} check{checks > 1 ? "s" : ""}</button></>}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {back && <Btn onClick={back}>Back</Btn>}
        {next && <Btn onClick={next.go}>Next: {next.label}</Btn>}
        <span className="ml-auto flex gap-1.5">
          <Btn disabled={!ready} onClick={onReplace} title={editing ? "Rebuild this scenario from these answers" : "Replace the open scenario's layout with this"}>{editing ? "Update this scenario" : "Replace current"}</Btn>
          <Btn tone="primary" disabled={!ready} onClick={onNew}>Add as new scenario</Btn>
        </span>
      </div>
    </footer>
  );
}
