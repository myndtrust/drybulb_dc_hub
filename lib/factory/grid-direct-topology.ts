// ─────────────────────────────────────────────────────────────────────────────
// Modular-pod grid-direct generator — the `architecture: "modular-pod"` half of
// the Power Expert.
//
// A second grid-direct pattern alongside DSX-VR, generalized from field
// observation of how large modular GPU-cluster builds are actually being
// delivered in current practice: two diverse utility services onto ONE common
// MV bus (no split-bus tie — redundancy comes from utility diversity, not bus
// segmentation), ZERO UPS anywhere in the design — not even a core block, which
// is what distinguishes it from dsx-vr — identical pods repeated to scale, and
// an automatic transfer switch reserved for MECHANICAL (chiller) load only.
// Compute racks are single-corded (row/pod-level A vs B redundancy, not
// 2N-to-rack). Ride-through against a utility-to-utility transfer is carried by
// an MV-tied BESS fleet rather than diesel standby — a design choice, not an
// omission; an on-site generator stays available as an explicit opt-in.
//
// Every figure in `MOD` below is an ENGINEERING ASSUMPTION consistent with this
// pattern, not a fact sourced to any specific project — only the topology SHAPE
// is generalized from field observation, not any project's numbers or drawings.
// ─────────────────────────────────────────────────────────────────────────────

import { PAL, breakeredDefaults, type Breaker, type SldGraph, type SldNode } from "./sld";
import type { ScheduleRow, Sizing, Spec } from "./topology";

const ceil = (x: number) => Math.ceil(x - 1e-9);
const round1 = (x: number) => Math.round(x * 10) / 10;

// ── Knowledge constants — all [assumption], none sourced to a specific project ──
export const MOD = {
  utilityServices: 2, //     [assumption] two diverse utility substations feed one common MV bus
  hvTransformerMVA: 75, //   [assumption] same class as the legacy UPS-chain HV step-down; scales in qty with facilityMW
  padmountMVA: 2.5, //       [assumption] MV → LV pod transformer, one per A/B side
  panelboardsPerSide: 4, //  [assumption] LV panelboards fed per pod switchboard side
  racksPerPanelboard: 6, //  [assumption]
  gensetMW: 3, //            [assumption] explicit opt-in only (Spec.onsiteGen) — off by default
  pf: 0.9, //                [assumption] representative power factor for amp sizing
  /** [assumption] practical ceiling for a SINGLE MV switchgear lineup/common bus.
   *  Above the facility size this caps out at, a real design needs multiple
   *  parallel lineups — the same problem DSX-VR solves with `lineupPairs`. Not
   *  modeled here yet; the rating string flags it instead of silently reading a
   *  bus amperage no single physical lineup actually carries. */
  mvBusAmpCap: 5000,
};

function racksPerPod(): number { return MOD.panelboardsPerSide * MOD.racksPerPanelboard * 2; }

/** Standard breaker/bus frame sizes, ascending — round a computed amp need up to
 *  the next one a real board actually ships in. */
const STD_AMPS = [100, 150, 200, 225, 250, 300, 350, 400, 450, 500, 600, 800, 1200, 1600, 2000, 2500, 3200, 4000, 5000, 6000, 8000];
function stdAmp(need: number): number { return STD_AMPS.find((a) => a >= need) ?? Math.ceil(need / 100) * 100; }
/** 3-phase amps from an MVA/kVA rating at a given line-line kV — nameplate, no pf derate. */
function xfoAmps(kva: number, kV: number): number { return kva / (Math.sqrt(3) * kV); }
/** 3-phase amps a real kW load draws at a given line-line volts, at `MOD.pf`. */
function loadAmps(kw: number, volts: number): number { return (kw * 1000) / (Math.sqrt(3) * volts * MOD.pf); }
const mvKV = (spec: Spec) => parseFloat(spec.voltages.mv) || 13.8; // "13.8 kV" -> 13.8
const lvV = (spec: Spec) => parseFloat(spec.voltages.lv) || 480; //  "480 V" -> 480

// ── Sizing ───────────────────────────────────────────────────────────────────
export function sizeGridDirect(spec: Spec): Sizing {
  const podRacks = racksPerPod();
  const podMW = round1((podRacks * spec.rackKW) / 1000);
  const podCount = Math.max(1, ceil(spec.itMW / podMW));
  // Whole-pod quantization: the built site is always a whole number of pods, so
  // itMW/facilityMW are reported off the QUANTIZED build (racks), not the raw
  // ask — otherwise a request landing just above a pod boundary prints a
  // headline that understates the actual build by up to ~1 pod's worth of MW
  // (there is no external reference site pinning itMW the way DSX-VR's 103 MW
  // sheet does, so nothing is lost by keeping the printed numbers consistent
  // with what's actually drawn and priced).
  const racks = podCount * podRacks;
  const gpus = racks * spec.gpusPerRack;
  const itMW = round1((racks * spec.rackKW) / 1000);
  const facilityMW = round1(itMW * spec.pue);

  const gensets = spec.onsiteGen ? Math.max(1, ceil(facilityMW / MOD.gensetMW)) : 0;
  const swbdMainAmp = breakeredDefaults("switchboard").mainAmp;

  // Each of the two diverse services independently carries its half of the
  // site (no tie, so an outage on one drops that half — BESS covers the
  // ride-through gap, not full N+1 utility capacity); qty scales with facilityMW
  // instead of staying fixed at the 2-unit nominal-site count.
  const transformersPerService = Math.max(1, ceil((facilityMW / MOD.utilityServices) / (MOD.hvTransformerMVA * 0.95)));
  const hvTransformers = MOD.utilityServices * transformersPerService;

  const schedule: ScheduleRow[] = [
    { item: "HV/MV utility transformer (diverse services)", qty: hvTransformers, rating: MOD.hvTransformerMVA + " MVA", scheme: "utility diversity", catalogKey: "transformers", lead: "18-24 mo", risk: "high" },
    { item: "MV common switchboard (no tie — dual utility infeed)", qty: 1, rating: spec.voltages.mv + " · common bus", scheme: "utility diversity", catalogKey: "switchgear", lead: "~50 wk", risk: "high" },
    ...(spec.bess ? [{ item: "BESS (MV-tied ride-through)", qty: 1, rating: round1(facilityMW) + " MW · utility-to-utility ride-through", scheme: "—", catalogKey: "bess", lead: "12-18 mo", risk: "med" as const }] : []),
    ...(spec.onsiteGen ? [{ item: "Standby genset (opt-in)", qty: gensets, rating: MOD.gensetMW + " MW · " + spec.voltages.mv, scheme: "N", catalogKey: "generators", lead: "18 mo", risk: "high" as const }] : []),
    { item: "Pod padmount transformer (MV→LV, A/B)", qty: podCount * 2, rating: MOD.padmountMVA + " MVA", scheme: "A/B row redundant", catalogKey: "transformers", lead: "—", risk: "med" },
    { item: "Pod switchboard (A/B)", qty: podCount * 2, rating: spec.voltages.lv + " · " + swbdMainAmp + " A", scheme: "A/B row redundant", catalogKey: "lv", lead: "—", risk: "low" },
    { item: "LV panelboard", qty: podCount * MOD.panelboardsPerSide * 2, rating: spec.voltages.lv, scheme: "A/B row redundant", catalogKey: "lv", lead: "—", risk: "low" },
    { item: "Mechanical transfer switch (chillers only)", qty: podCount, rating: spec.voltages.lv + " · ATS", scheme: "switchboard A ↔ B", catalogKey: "lv", lead: "—", risk: "low" },
    { item: "Compute rack", qty: racks, rating: spec.rackKW + " kW", scheme: "single-corded, row redundant (not 2N)", catalogKey: "accel", lead: "—", risk: "—" },
  ];

  return { spec, facilityMW, itMW, racks, gpus, podsNeeded: podCount, schedule };
}

// ── Topology ─────────────────────────────────────────────────────────────────
function builder(g: SldGraph) {
  const N = (type: string, name: string, x: number, y: number, extra?: Partial<SldNode>) => {
    g.uid++;
    const p = PAL[type];
    const n: SldNode = { id: "n" + g.uid, type, name: name || p.label, x, y, kw: p.kw || 0, kind: p.kind, red: "N", catalogKey: "", product: "", rating: "" };
    if (p.grp) n.grp = p.grp;
    if (p.breakered) {
      const d = breakeredDefaults(type);
      n.voltage = d.voltage;
      if (d.mainAmp != null) n.mainAmp = d.mainAmp;
      n.breakers = [];
    }
    Object.assign(n, extra || {});
    if (n.mainAmp === undefined) delete n.mainAmp;
    g.nodes.push(n);
    return n;
  };
  const E = (from: SldNode, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
  const EB = (from: SldNode, br: string, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };
  const BRK = (n: SldNode, label: string, amp: number, status: Breaker["status"] = "closed") => {
    const list = n.breakers || (n.breakers = []);
    const id = "b" + (list.length + 1);
    list.push({ id, label, amp, poles: 3, status });
    return id;
  };
  return { N, E, EB, BRK };
}

/** One representative pod, drawn in full; the rest are carried by the schedule
 *  (the same convention DSX-VR uses for its undrawn deployment units). */
export function buildGridDirect(spec: Spec): SldGraph {
  const sz = sizeGridDirect(spec);
  const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0, groups: [], architecture: "modular-pod" };
  const { N, E, EB, BRK } = builder(g);
  const mv = spec.voltages.mv, lv = spec.voltages.lv;

  // ── Site: two diverse utility services onto ONE common MV bus — no tie ──────
  const utilA = N("utility", "Utility service A", 180, 18, { rating: mv + " class" });
  const utilB = N("utility", "Utility service B", 900, 18, { rating: mv + " class" });
  const mainA = N("transformer", "Main transformer A", 180, 96, { rating: MOD.hvTransformerMVA + " MVA · HV/MV" });
  const mainB = N("transformer", "Main transformer B", 900, 96, { rating: MOD.hvTransformerMVA + " MVA · HV/MV" });
  // Main bus rating scales with facility size (real load ÷ pf, converted to
  // amps at MV) instead of the generic switchboard default — capped at one
  // physical lineup's practical ceiling; above that a real design needs
  // multiple parallel lineups (flagged in the rating string, not modeled here).
  const mvNeededA = xfoAmps((sz.facilityMW / MOD.pf) * 1000, mvKV(spec));
  const mvCapped = mvNeededA > MOD.mvBusAmpCap;
  const mvMainAmp = Math.min(stdAmp(mvNeededA), MOD.mvBusAmpCap);
  // `diversity: true`: this board represents the FULL site's common bus while
  // only one of podsNeeded pods is drawn, so served amps understate its real
  // load — the flag keeps that from reading as a false over-subscription clean
  // pass rather than suppressing a real one (see sld.ts's diversity convention).
  const mvSwbd = N("switchboard", "MV SWBD — common bus (no tie)", 480, 176, {
    voltage: mv, diversity: true, mainAmp: mvMainAmp,
    rating: mv + " · " + mvMainAmp + " A · common bus, dual utility infeed" + (mvCapped ? " (single lineup shown — larger sites need multiple parallel lineups, not modeled)" : ""),
    breakers: [],
  });
  E(utilA, mainA); E(utilB, mainB); E(mainA, mvSwbd); E(mainB, mvSwbd);
  const siteIds = [utilA.id, utilB.id, mainA.id, mainB.id, mvSwbd.id];

  if (spec.bess) {
    const bess = N("bess", "BESS · MV ride-through", 1180, 18, { rating: round1(sz.facilityMW) + " MW · utility-to-utility ride-through" });
    E(bess, mvSwbd);
    siteIds.push(bess.id);
  }
  if (spec.onsiteGen) {
    const row = sz.schedule.find((r) => r.item === "Standby genset (opt-in)");
    const gen = N("genset", "On-site generation (opt-in)", 1180, 96, {
      rating: (row?.qty ?? 1) + " × " + MOD.gensetMW + " MW · " + mv + " (explicit opt-in — off by default)",
    });
    E(gen, mvSwbd);
    siteIds.push(gen.id);
  }

  // ── Pod 1, drawn in full ─────────────────────────────────────────────────────
  const padA = N("transformer", "Pod 1 · Transformer A", 150, 270, { rating: MOD.padmountMVA + " MVA · " + mv + " → " + lv });
  const padB = N("transformer", "Pod 1 · Transformer B", 700, 270, { rating: MOD.padmountMVA + " MVA · " + mv + " → " + lv });
  // MV feeder breaker sized off the padmount transformer's own primary FLA
  // (2500 kVA @ 13.8 kV ≈ 105 A), not a flat generic value — 25% margin, next
  // standard frame up.
  const padFeederAmp = stdAmp(xfoAmps(MOD.padmountMVA * 1000, mvKV(spec)) * 1.25);
  EB(mvSwbd, BRK(mvSwbd, "F1", padFeederAmp), padA);
  EB(mvSwbd, BRK(mvSwbd, "F2", padFeederAmp), padB);

  const swbdMainAmp = breakeredDefaults("switchboard").mainAmp;
  const swA = N("switchboard", "Pod 1 · Switchboard A", 150, 350, { voltage: lv, rating: lv + " · " + swbdMainAmp + " A" });
  const swB = N("switchboard", "Pod 1 · Switchboard B", 700, 350, { voltage: lv, rating: lv + " · " + swbdMainAmp + " A" });
  E(padA, swA); E(padB, swB);

  const pbA1 = N("rpp", "Pod 1 · Panelboard A1", 60, 452, { voltage: lv, rating: lv + " panelboard" });
  const pbA2 = N("rpp", "Pod 1 · Panelboard A2", 260, 452, { voltage: lv, rating: lv + " panelboard" });
  const pbB1 = N("rpp", "Pod 1 · Panelboard B1", 610, 452, { voltage: lv, rating: lv + " panelboard" });
  const pbB2 = N("rpp", "Pod 1 · Panelboard B2", 810, 452, { voltage: lv, rating: lv + " panelboard" });
  EB(swA, BRK(swA, "F1", 800), pbA1); EB(swA, BRK(swA, "F2", 800), pbA2);
  EB(swB, BRK(swB, "F1", 800), pbB1); EB(swB, BRK(swB, "F2", 800), pbB2);

  // Mechanical is the ONLY backed-up load: an ATS fed from both of the pod's
  // utility-derived switchboards, never the compute racks (validateGridDirect).
  const ats = N("paralleling", "Pod 1 · Chiller ATS", 430, 452, { rating: lv + " ATS · switchboard A ↔ B" });
  EB(swA, BRK(swA, "F3", 800), ats);
  EB(swB, BRK(swB, "F3", 800), ats);
  const chiller = N("chiller", "Pod 1 · Chiller plant", 430, 544);
  E(ats, chiller);

  // Racks are single-corded — one feed each, cycled across the four shown
  // panelboards (row/pod-level A vs B redundancy, not 2N-to-rack). Branch
  // breaker sized off the rack's own kW at LV (25% continuous-load margin),
  // not a flat generic value — matters once a denser (e.g. Vera Rubin) rack
  // platform is selected.
  const rackShow = Math.min(sz.racks, 8);
  const rackBranchAmp = stdAmp(loadAmps(spec.rackKW, lvV(spec)) * 1.25);
  const pbFor = [pbA1, pbA2, pbB1, pbB2];
  const racks: SldNode[] = [];
  for (let i = 0; i < rackShow; i++) {
    const last = i === rackShow - 1 && sz.racks > rackShow;
    // `kw` (not just the display `rating`) must carry the spec's rack size — the
    // rest of the app (cost rollup) reads `kw`, not the rating string.
    const r = N("rack", last ? `rack ${i + 1} … (× ${sz.racks})` : `rack ${i + 1}`, 60 + i * 108, 544, { kw: spec.rackKW, rating: spec.rackKW + " kW" });
    const pb = pbFor[i % 4];
    EB(pb, BRK(pb, "R" + (Math.floor(i / 4) + 1), rackBranchAmp), r);
    racks.push(r);
  }

  const podIds = [padA.id, padB.id, swA.id, swB.id, pbA1.id, pbA2.id, pbB1.id, pbB2.id, ats.id, chiller.id, ...racks.map((r) => r.id)];
  const podLabel = sz.podsNeeded > 1 ? ` (× ${sz.podsNeeded} pods)` : "";
  g.groups = [
    { id: "g1", name: "Site MV — dual utility, common bus (no tie)", members: siteIds },
    { id: "g2", name: `Pod 1${podLabel} — grid-direct, no UPS, single-corded; mechanical is the only ATS-backed load`, members: podIds },
  ];
  g.uid += 2;
  return g;
}

// ── 1-page brief (markdown) ──────────────────────────────────────────────────
export function briefGridDirect(spec: Spec): string {
  const sz = sizeGridDirect(spec);
  const L: string[] = [];
  L.push("# " + spec.name);
  L.push("");
  L.push(`**${sz.facilityMW} MW facility** · ${sz.itMW} MW critical IT · ${sz.racks.toLocaleString()} × ${spec.rackKW} kW racks · ${sz.gpus.toLocaleString()} GPUs · PUE ${spec.pue} · ${spec.cooling}-cooled · ${sz.podsNeeded} pod${sz.podsNeeded === 1 ? "" : "s"}`);
  L.push("");
  L.push("## Topology — modular, grid-direct");
  L.push(
    "Two diverse utility services land on **one common MV switchboard** — no split-bus tie, because redundancy here comes " +
    "from utility diversity, not bus segmentation" +
    (spec.bess ? ", with a **BESS** fleet at MV carrying ride-through through a utility-to-utility transfer" : "") +
    ". Identical pods repeat off that bus: MV → padmount transformer A/B → LV switchboard A/B → panelboards → rack whips. " +
    "**No UPS anywhere in the design** — compute racks are single-corded (row-level A/B redundancy, not 2N-to-rack) and " +
    "grid-direct end to end. The only backed-up load is mechanical: each pod's chillers sit behind an automatic transfer " +
    "switch fed from both switchboard A and switchboard B." +
    (spec.onsiteGen ? " Standby generation is drawn as an explicit opt-in." : " No on-site generator is drawn by default — BESS and utility diversity carry ride-through instead of diesel standby."),
  );
  L.push("");
  L.push("## Resilience");
  L.push("- **MV substation:** common bus, dual diverse utility infeed, no tie breaker");
  L.push("- **Compute path:** grid-direct, no UPS, single-corded (row A/B redundant)");
  L.push("- **Mechanical (chillers):** automatic transfer switch, switchboard A ↔ B");
  if (spec.bess) L.push("- **BESS:** MV-tied, utility-to-utility ride-through — substitutes for on-site generation in this pattern");
  L.push("- **Standby generation:** " + (spec.onsiteGen ? "explicit opt-in, drawn" : "not drawn by default"));
  L.push("");
  L.push("## Major equipment schedule");
  L.push("| Equipment | Qty | Unit rating | Redundancy | Lead / risk |");
  L.push("|---|---:|---|---|---|");
  sz.schedule.forEach((r) => L.push(`| ${r.item} | ${r.qty.toLocaleString()} | ${r.rating} | ${r.scheme} | ${r.lead} · ${r.risk} |`));
  L.push("");
  L.push("*Modular grid-direct pattern — engineering assumptions consistent with current practice for large modular GPU-cluster builds; not sourced to a specific project. Sized estimate — verify against your governing design basis.*");
  return L.join("\n");
}
