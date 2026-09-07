// node:test suite for the DSX Vera Rubin graph invariants (lib/factory/sld.ts →
// validateDsx). Every graph-checkable rule in docs/ai-factory/dsx-vr-architecture.md
// §5 gets a positive case — the reference wiring passes — and a negative case that
// proves the specific violation is caught.
//
// The reference graph below must stay FAITHFUL TO THE SOURCE, not convenient for
// the validator: an engineering review of the first cut found that the graph had
// quietly departed from the sheets at exactly the four points where the rules were
// wrong, so the suite passed by accommodating the defects. In particular the BESS
// and backup-generation blocks are drawn through their step-up transformers, and
// the core block carries IT-tagged racks.
// Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as SLD from "./sld";
import type { SldGraph, SldNode } from "./sld";

/** A miniature but rule-complete DSX-VR design:
 *  - dual 38 kV lineups, normally-open tie, and the MV backup block landing on the
 *    tie through XFO-BU-Gen; BESS onto an A-lineup feeder through XFO-BESS-Core;
 *  - one dual-ended 34.5 kV ring across two RMU skids carrying a grid-direct
 *    compute chain (MVT → MSB-GPU 480 V → RPP 1000 A → rack), a DU support board
 *    and a DU chiller board — no UPS, generator or ATS anywhere inside the DU;
 *  - the core-load ring and one core-IT board: interlocked MVT/generator incomers
 *    at 415 V, feeding UPS, busway, RPP 400 A and the load bank per the sheet. */
function dsx(): SldGraph {
  const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0, architecture: "dsx-vr" };
  const N = (type: string, name: string, extra?: Partial<SldNode>) => {
    g.uid++; const n = SLD.mkNode("n" + g.uid, type, name, 0, 0, extra); g.nodes.push(n); return n;
  };
  const E = (from: SldNode, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
  const EB = (from: SldNode, br: string, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };
  const open = (n: SldNode, br: string) => { (n.breakers || []).find((x) => x.id === br)!.status = "open"; };

  // ── site: two utility primaries → two 38 kV lineups joined by the tie ──
  const util = N("utility", "Utility primary", { voltage: "230 kV", rating: "per project analysis" });
  const txA = N("transformer", "SUB1.T.A", { rating: "90/120/150 MVA" });
  const txB = N("transformer", "SUB1.T.B", { rating: "90/120/150 MVA" });
  const msgA = N("switchboard", "SUB1.MSG.A", { voltage: "38 kV", mainAmp: 2500, rating: "38 kV, 2500 A, 40 kA" });
  const msgB = N("switchboard", "SUB1.MSG.B", { voltage: "38 kV", mainAmp: 2500, rating: "38 kV, 2500 A, 40 kA" });
  const tie = N("switchboard", "SUB1.MSG.T", { voltage: "38 kV", mainAmp: 2500 });
  E(util, txA); E(util, txB); E(txA, msgA); E(txB, msgB);
  open(msgA, "b2"); EB(msgA, "b2", tie);   // A-52T-1 / B-52T-1 are normally open
  open(msgB, "b2"); EB(msgB, "b2", tie);

  // backup generation reaches the tie bus through its step-up, not directly
  const backup = N("genset", "MV backup-generation block", { rating: "15 MVA (N+1)" });
  const xfoBuGen = N("transformer", "XFO-BU-Gen", { rating: "13.8–34.5 kV" });
  E(backup, xfoBuGen); E(xfoBuGen, tie);

  // BESS likewise steps up through XFO-BESS-Core onto a dedicated 1200 A feeder
  const bess = N("bess", "BESS block", { rating: "37.5 MW / 2 h" });
  const xfoBess = N("transformer", "XFO-BESS-Core", { rating: "5 × 8.3 MVA · 34.5 kV" });
  E(bess, xfoBess); E(xfoBess, msgA);

  // ── one dual-ended 34.5 kV ring: A feeder → RMU1 → RMU2 ← B feeder, with the
  // normal open point on the B end so the ring operates radially ──
  const rmu1 = N("rmu", "DU1 RMU1 skid");
  const rmu2 = N("rmu", "DU2 RMU1 skid");
  EB(msgA, "b1", rmu1); EB(rmu1, "b1", rmu2);
  open(msgB, "b1"); EB(msgB, "b1", rmu2);

  // grid-direct compute — no UPS, generator or ATS anywhere on this path
  const mvtC = N("transformer", "MVT compute", { rating: "4.2 MVA · 34.5 kV → 480 V" });
  const msbGpu = N("switchboard", "MSB-GPU1", { voltage: "480 V", mainAmp: 5000, rating: "5000 A, 480 V, 3Ph-3W" });
  const rppGpu = N("rpp", "RPP-GPU1-1", { voltage: "480 V", mainAmp: 1000 });
  const rack = N("rack", "VR200 NVL144 rack 1");
  EB(rmu1, "b2", mvtC); E(mvtC, msbGpu); EB(msbGpu, "b1", rppGpu); EB(rppGpu, "b1", rack);

  // the rest of the DU kit: a support board and an MV chiller board
  const mvtSupp = N("transformer", "MVT support", { rating: "2.0 MVA · 34.5 kV → 415/240 V" });
  const msbSupp = N("switchboard", "MSB-SUPP (DU)", { voltage: "415/240 V", mainAmp: 3000 });
  EB(rmu1, "b3", mvtSupp); E(mvtSupp, msbSupp);
  const mvtChill = N("transformer", "MVT chiller", { rating: "4.2 MVA · 34.5 kV → 2.4/4.16 kV" });
  const msbChill = N("switchboard", "MSB-CHILLERS (DU)", { voltage: "2.4/4.16 kV", mainAmp: 1200 });
  const chiller = N("chiller", "DU chiller 1");
  EB(rmu2, "b2", mvtChill); E(mvtChill, msbChill); EB(msbChill, "b1", chiller);

  // ── the core-load ring and the one core-IT board ──
  const rmuCore = N("rmu", "CORE IT RMU1 skid");
  EB(msgA, "b4", rmuCore); open(msgB, "b4"); EB(msgB, "b4", rmuCore);
  const mvtCore = N("transformer", "MVT-1", { rating: "4.2 MVA · 34.5 kV → 415 V" });
  const msbCore = N("switchboard", "MSB-SUPP1", { voltage: "415 V", mainAmp: 5000, interlocked: true });
  const gsCore = N("genset", "GS-1", { rating: "2.8 MW / 3.5 MVA · 415/240 V" });
  EB(rmuCore, "b1", mvtCore); E(mvtCore, msbCore); E(gsCore, msbCore);

  // core loads are IT too — and are legitimately UPS- and generator-backed
  const ups = N("ups", "Core UPS 1A", { rating: "1.5 MVA · Li-ion" });
  const coreRackA = N("rack", "Core control rack");
  const busway = N("busway", "Core busway 1", { voltage: "415/240 V", mainAmp: 2000 });
  const coreRackB = N("rack", "Core storage rack");
  const rppCore = N("rpp", "RPP-CORE-1", { voltage: "415/240 V", mainAmp: 400 });
  const coreRackC = N("rack", "Core network rack");
  const loadbank = N("loadbank", "Load bank connection");
  EB(msbCore, "b1", ups); E(ups, coreRackA);
  EB(msbCore, "b2", busway); EB(busway, "b1", coreRackB);
  EB(msbCore, "b3", rppCore); EB(rppCore, "b1", coreRackC);
  EB(msbCore, "b4", loadbank);

  return g;
}

const node = (g: SldGraph, name: string) => g.nodes.find((n) => n.name === name)!;
const errs = (g: SldGraph) => SLD.validate(g).errors;
const hits = (g: SldGraph, re: RegExp) => errs(g).filter((s) => re.test(s));

/** Attach a fresh card to the graph without going through the palette ops. */
function attach(g: SldGraph, type: string, name: string, extra?: Partial<SldNode>): SldNode {
  g.uid++; const n = SLD.mkNode("nX" + g.uid, type, name, 0, 0, extra); g.nodes.push(n); return n;
}
function wire(g: SldGraph, from: string, to: string, fromBreaker?: string) {
  g.uid++; g.edges.push({ id: "eX" + g.uid, from, to, ...(fromBreaker ? { fromBreaker } : {}) });
}

// ── the reference wiring ─────────────────────────────────────────────────────

test("DSX-VR: the reference wiring validates clean", () => {
  const g = dsx();
  const v = SLD.validate(g);
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
  assert.equal(SLD.hasCycleAll(g), false);
});

// ── §5.1 compute is grid-direct ──────────────────────────────────────────────

test("§5.1: a UPS upstream of a GPU compute rack is rejected", () => {
  const g = dsx();
  wire(g, node(g, "Core UPS 1A").id, node(g, "RPP-GPU1-1").id);
  assert.equal(hits(g, /Core UPS 1A feeds compute load VR200 NVL144 rack 1/).length, 1);
});

test("§5.1: a generator upstream of a GPU compute rack is rejected", () => {
  const g = dsx();
  wire(g, node(g, "GS-1").id, node(g, "MSB-GPU1").id);
  assert.equal(hits(g, /GS-1 feeds compute load/).length, 1);
});

test("§5.1: the core block's UPS- and generator-backed IT racks are NOT compute", () => {
  // the reference core board carries three IT-tagged racks behind a UPS and a
  // generator; `grp: "IT"` alone would flag every one of them
  const g = dsx();
  assert.ok(g.nodes.filter((n) => n.grp === "IT" && /^Core /.test(n.name)).length === 3);
  assert.deepEqual(hits(g, /grid-direct/), []);
});

test("§5.1: an open breaker keeps what is beyond it off the compute path", () => {
  const g = dsx();
  const ups = node(g, "Core UPS 1A"), rpp = node(g, "RPP-GPU1-1");
  // route the UPS at the compute RPP through a board breaker, then open it
  const brd = attach(g, "switchboard", "Test board", { voltage: "480 V" });
  brd.breakers!.find((b) => b.id === "b1")!.status = "open";
  wire(g, ups.id, brd.id);
  wire(g, brd.id, rpp.id, "b1");
  assert.deepEqual(hits(g, /grid-direct/), [], "open breaker carries no power");
  brd.breakers!.find((b) => b.id === "b1")!.status = "closed";
  // closing it also drags the core generator behind the UPS onto the path
  assert.equal(hits(g, /Core UPS 1A feeds compute load/).length, 1, "closing it puts the UPS on the path");
  assert.equal(hits(g, /GS-1 feeds compute load/).length, 1);
});

// ── §5.2 rings are dual-ended and operate radially ───────────────────────────

test("§5.2: a single-ended ring is rejected", () => {
  const g = dsx();
  const msgB = node(g, "SUB1.MSG.B").id, rmu2 = node(g, "DU2 RMU1 skid").id;
  g.edges = g.edges.filter((e) => !(e.from === msgB && e.to === rmu2));
  assert.equal(hits(g, /must be dual-ended/).length, 1);
});

test("§5.2: a closed loop with no open point is an error, not a warning", () => {
  const g = dsx();
  node(g, "SUB1.MSG.B").breakers!.find((b) => b.id === "b1")!.status = "closed";
  const v = SLD.validate(g);
  assert.equal(v.ok, false);
  assert.equal(v.errors.filter((s) => /no normally-open point/.test(s)).length, 1);
});

test("§5.2: both reference rings pass — the DU ring and the core-load ring", () => {
  const g = dsx();
  assert.equal(g.nodes.filter((n) => n.type === "rmu").length, 3);
  assert.deepEqual(hits(g, /^ring /), []);
});

// ── §5.3 UPS and generator placement ─────────────────────────────────────────

test("§5.3: a UPS inside a DU is rejected even though MSB-SUPP is 415/240 V", () => {
  const g = dsx();
  const u = attach(g, "ups", "Rogue DU UPS");
  wire(g, node(g, "MSB-SUPP (DU)").id, u.id, "b1");
  assert.equal(hits(g, /Rogue DU UPS is fed from MSB-SUPP \(DU\).*a deployment unit carries none/).length, 1);
});

test("§5.3: a generator inside a DU is rejected even though MSB-CHILLERS is at MV", () => {
  const g = dsx();
  const gen = attach(g, "genset", "Rogue DU genset");
  wire(g, gen.id, node(g, "MSB-CHILLERS (DU)").id);
  assert.equal(hits(g, /Rogue DU genset.*must land on an interlocked core board/).length, 1);
});

test("§5.3: a generator on a non-interlocked LV board is rejected", () => {
  const g = dsx();
  const gen = attach(g, "genset", "Rogue genset");
  wire(g, gen.id, node(g, "MSB-GPU1").id);
  assert.equal(hits(g, /Rogue genset.*must land on an interlocked core board/).length, 1);
});

test("§5.3: a generator teed straight onto a 34.5 kV ring is rejected", () => {
  // The compute path runs at 34.5 kV, so a rule that exempts generation "at MV"
  // clears a genset wired onto a ring — the one thing §5 invariant 3 exists to
  // stop. Generation may land at a core board or on the 38 kV substation only.
  const g = dsx();
  const gen = attach(g, "genset", "Rogue ring genset");
  wire(g, gen.id, node(g, "DU1 RMU1 skid").id);
  const v = SLD.validate(g);
  assert.equal(v.ok, false, "a genset on a compute ring must not validate");
  assert.equal(hits(g, /Rogue ring genset.*never on a ring/).length, 1);
  assert.equal(hits(g, /Rogue ring genset feeds compute load/).length, 1, "§5.1 fires too");
});

test("§5.3: on-site base generation at the 38 kV lineup is accepted", () => {
  // The sheets' optional 75 MVA block feeds the whole site, compute included
  // (notes 2 & 3) — condemning it was the Phase 1 defect.
  const g = dsx();
  const gen = attach(g, "genset", "On-site generation A", { rating: "75 MVA" });
  wire(g, gen.id, node(g, "SUB1.MSG.A").id);
  assert.deepEqual(SLD.validate(g).errors, []);
});

test("§5.3: the backup block reaching the tie through XFO-BU-Gen is accepted", () => {
  const g = dsx();
  assert.deepEqual(hits(g, /backup-generation/), [], "a step-up transformer is not an LV landing");
});

// ── §5.6 BESS at MV ──────────────────────────────────────────────────────────

test("§5.6: the BESS block through XFO-BESS-Core onto a lineup feeder is accepted", () => {
  const g = dsx();
  assert.deepEqual(hits(g, /BESS/), []);
});

test("§5.6: BESS behind an LV board is rejected", () => {
  const g = dsx();
  const bess = node(g, "BESS block").id;
  g.edges = g.edges.filter((e) => e.from !== bess);
  wire(g, bess, node(g, "MSB-GPU1").id);
  assert.equal(hits(g, /BESS connects at a dedicated MV feeder/).length, 1);
});

// ── §5.4 voltage discipline ──────────────────────────────────────────────────

test("§5.4: an off-standard board voltage is rejected", () => {
  const g = dsx();
  node(g, "MSB-GPU1").voltage = "600 V";
  assert.equal(hits(g, /outside the DSX-VR voltage discipline/).length, 1);
});

test("§5.4: the utility primary is out of scope — §4 starts at the 38 kV lineup", () => {
  const g = dsx();
  assert.equal(node(g, "Utility primary").voltage, "230 kV");
  assert.deepEqual(hits(g, /Utility primary/), []);
});

test("§5.4: an off-standard busbar is rejected, a blank one is ignored", () => {
  const g = dsx();
  g.busbars.push({ id: "bX", name: "Odd bus", x: 0, y: 0, w: 100, kv: "600 V" });
  g.busbars.push({ id: "bY", name: "Blank bus", x: 0, y: 0, w: 100, kv: "" });
  const e = hits(g, /voltage discipline/);
  assert.equal(e.length, 1);
  assert.match(e[0], /Odd bus/);
});

test("nominalVolts: reads voltage tokens only, ignoring ampacity and fault duty", () => {
  assert.equal(SLD.nominalVolts("38 kV"), 38000);
  assert.equal(SLD.nominalVolts("2.4/4.16 kV"), 4160, "line-neutral / line-line pair");
  assert.equal(SLD.nominalVolts("415/240 V"), 415);
  assert.equal(SLD.nominalVolts("277/480 V"), 480);
  // annotated labels: the sheets write boards as "1200 A, 2.4/4.16 kV, 3Ph-4W"
  assert.equal(SLD.nominalVolts("34.5 kV 600 A"), 34500);
  assert.equal(SLD.nominalVolts("34.5 kV, 40 kA"), 34500);
  assert.equal(SLD.nominalVolts("1200 A, 2.4/4.16 kV, 3Ph-4W"), 4160);
  assert.equal(SLD.nominalVolts("480 V · 3200 A"), 480);
  assert.equal(SLD.nominalVolts("13.8 kV / 480 V"), 13800);
  assert.equal(SLD.nominalVolts("3Ph-4W"), null);
  assert.equal(SLD.nominalVolts(undefined), null);
});

// ── RMU way capacity ─────────────────────────────────────────────────────────

test("RMU: ring-in, ring-out and tee-offs must fit the 4-way switch", () => {
  const g = dsx();
  const rmu1 = node(g, "DU1 RMU1 skid");
  // the reference skid is already full: 1 incomer + ring-out + 2 tee-offs
  assert.deepEqual(hits(g, /ring main unit/), []);
  const extra = attach(g, "transformer", "Fifth tee-off");
  wire(g, rmu1.id, extra.id, "b4");
  assert.equal(hits(g, /5 circuits on a 4-way ring main unit/).length, 1);
});

// ── interlocked dual-incomer boards ──────────────────────────────────────────

test("interlocked board: exactly two incomers, never one", () => {
  const g = dsx();
  const gs = node(g, "GS-1").id;
  g.edges = g.edges.filter((e) => e.from !== gs);
  assert.equal(hits(g, /interlocked board has 1 incomer/).length, 1);
});

test("interlocked board: a third external incomer is rejected", () => {
  const g = dsx();
  wire(g, node(g, "MVT compute").id, node(g, "MSB-SUPP1").id);
  assert.equal(hits(g, /interlocked board has 3 incomers/).length, 1);
});

test("interlocked board: a return path from its own downstream is not a third source", () => {
  // the sourced board carries a dedicated output breaker per UPS, so the UPS
  // output lands back on the board; only external incomers may count
  const g = dsx();
  wire(g, node(g, "Core UPS 1A").id, node(g, "MSB-SUPP1").id);
  assert.deepEqual(hits(g, /interlocked board has/), []);
});

// ── the architecture gate ────────────────────────────────────────────────────

test("gate: the legacy UPS-chain seed is untouched by the DSX rules", () => {
  const g = SLD.seed();
  assert.equal(g.architecture, undefined);
  assert.equal(SLD.validate(g).ok, true);
});

test("gate: the same legacy seed tagged dsx-vr fails the DSX rules", () => {
  const g: SldGraph = { ...SLD.seed(), architecture: "dsx-vr" };
  const v = SLD.validate(g);
  assert.equal(v.ok, false);
  assert.ok(hits(g, /grid-direct/).length > 0, "compute-path rule fires");
  assert.ok(hits(g, /interlocked core board/).length > 0, "generator rule fires");
});

// ── palette additions ────────────────────────────────────────────────────────

test("palette: rmu / busway / loadbank carry their DSX-VR defaults", () => {
  const rmu = SLD.mkNode("n1", "rmu", null, 0, 0);
  assert.equal(rmu.voltage, "34.5 kV");
  assert.equal(rmu.breakers!.length, 4, "4-way ring main unit");
  assert.ok(rmu.breakers!.every((b) => b.amp === 600), "600 A ways");
  assert.equal(rmu.mainAmp, undefined, "a ring switch has no limiting main");

  const busway = SLD.mkNode("n2", "busway", null, 0, 0);
  assert.equal(busway.voltage, "415/240 V");
  assert.equal(busway.mainAmp, 2000, "the 2000 A run rating is what taps are sized against");
  const one: SldGraph = { nodes: [busway], edges: [], busbars: [], uid: 2 };
  assert.equal(SLD.aggregateRatingA(one, "n2"), 2000);
  assert.equal(SLD.aggregateRatingA({ ...one, nodes: [rmu] }, "n1"), undefined);

  const lb = SLD.mkNode("n3", "loadbank", null, 0, 0);
  assert.equal(lb.kind, "load");
  assert.equal(lb.grp, undefined, "a load bank is not IT/MECH/NET load");
  assert.equal(SLD.isBreakered(lb), false);
});

test("breakeredDefaults: one source of truth shared with the topology generator", () => {
  assert.deepEqual(SLD.breakeredDefaults("switchboard"), { voltage: "480 V", mainAmp: 3200 });
  assert.deepEqual(SLD.breakeredDefaults("rpp"), { voltage: "415/240 V", mainAmp: 400 });
  assert.deepEqual(SLD.breakeredDefaults("rmu"), { voltage: "34.5 kV" });
});
