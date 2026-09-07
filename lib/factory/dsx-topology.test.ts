// node:test suite for the DSX-VR GENERATOR (lib/factory/dsx-topology.ts + the
// architecture dispatch in ./topology). Companion to dsx.test.ts, which tests the
// graph *rules*; this file tests that the generator produces graphs obeying them
// and a schedule whose counts reproduce the sheets.
//
// The count assertions are the point of the suite: at the reference site the
// generator must land on the Siemens numbers exactly — 8 deployment units, 13
// rings, 16 of 16 feeder positions, 32 MSB-GPU, 256 compute RPPs, 8 core UPS —
// and it must not reach them by rounding that happens to work at 103 MW.
// Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validate, nominalVolts, type SldGraph, type SldNode } from "./sld";
import { DSX, sizeDsx, type DsxCounts } from "./dsx-topology";
import { parseBrief, sizePowerChain, buildTopology, design, brief, normalizeSpec } from "./topology";

const counts = (text: string): DsxCounts => {
  const d = sizePowerChain(parseBrief(text)).dsx;
  assert.ok(d, "a dsx-vr sizing must carry its DU/ring/core counts");
  return d;
};
const row = (text: string, item: string) =>
  sizePowerChain(parseBrief(text)).schedule.find((r) => r.item === item)!;
const byType = (g: SldGraph, type: string) => g.nodes.filter((n) => n.type === type);
const node = (g: SldGraph, name: string) => g.nodes.find((n) => n.name === name)!;
const REF = "103 MW DSX Vera Rubin campus";

// ── the architecture gate ────────────────────────────────────────────────────

test("gate: the legacy UPS-chain stays the default — existing briefs are untouched", () => {
  for (const p of ["48 MW GB300 campus, Tier III, 2N to the rack", "100 MW facility, PUE 1.25, catcher UPS", ""]) {
    assert.equal(parseBrief(p).architecture, "ups-chain", p);
  }
  assert.equal(normalizeSpec({ itMW: 20 }).architecture, "ups-chain");
  assert.equal(buildTopology({ itMW: 20 }).architecture, undefined, "legacy graphs carry no architecture tag");
});

test("gate: naming the reference design — or asking for what only it does — selects DSX-VR", () => {
  for (const p of [
    "100 MW DSX Vera Rubin campus",
    "dsx-vr, 50 MW",
    "40 MW, grid-direct compute",
    "30 MW with no UPS",
    "a fully curtailable 60 MW factory",
    "give me one deployment unit",
    "build to the Vera Rubin reference architecture",
  ]) {
    assert.equal(parseBrief(p).architecture, "dsx-vr", p);
  }
});

test("gate: 'Vera Rubin' alone picks the RACK PLATFORM, not the architecture", () => {
  // a conventional UPS-chain campus full of VR200s is a perfectly ordinary ask
  const s = parseBrief("60 MW Vera Rubin campus, distributed 4-to-make-3 UPS");
  assert.equal(s.architecture, "ups-chain");
  assert.equal(s.rackKW, 200);
  assert.equal(s.gpusPerRack, 144);
});

test("DSX-VR defaults to the VR200 NVL144 platform it is drawn for", () => {
  const s = parseBrief("dsx-vr");
  assert.equal(s.rackKW, DSX.rackKW);
  assert.equal(s.gpusPerRack, DSX.gpusPerRack);
  assert.equal(s.itMW, DSX.itMWNominal, "an unqualified ask means the reference site");
  // GB300 still overrides the platform without leaving the architecture
  const gb = parseBrief("dsx-vr, GB300");
  assert.equal(gb.architecture, "dsx-vr");
  assert.equal(gb.rackKW, 120);
});

// ── the reference site reproduces the sheets ─────────────────────────────────

test("reference site (103 MW): the sourced counts, exactly", () => {
  const c = counts(REF);
  assert.equal(c.duCount, DSX.duCountNominal, "8 deployment units");
  assert.equal(c.rings, 13, "6 rings per 4-DU group × 2 groups + the core-load ring");
  assert.equal(c.feedersPerLineup, DSX.lineupFeederPositions, "13 rings + station aux + 2 BESS = the sheet's 16 positions");
  assert.equal(c.bessBlocks, 4, "2 blocks per lineup as drawn");
  assert.equal(c.coreUps, 8, "4 core boards × 2 × 1.5 MVA — the only UPS on site");
  assert.equal(c.msbGpu, 32);
  assert.equal(c.rppCompute, 256);
});

test("note 1 sizes backup generation to the core slice: 0.06 × IT × 1.40", () => {
  assert.equal(Math.round(counts(REF).backupMW * 100) / 100, 8.65, "≈ 8.7 MW at 103 MW IT");
  assert.equal(counts("50 MW dsx-vr").backupMW, 0.06 * 50 * 1.4);
  // headroom above the obligation AT THE NOMINAL — compared in matching units,
  // and never restated above the drawn site size
  assert.ok(counts(REF).backupMW / DSX.genPF < DSX.backupBlockMVA, "8.65 MW = 10.8 MVA < 15 MVA");
  const big = counts("206 MW dsx-vr");
  assert.ok(big.backupMW / DSX.genPF > DSX.backupBlockMVA, "21.6 MVA outgrows the drawn block");
  const card = buildTopology(parseBrief("206 MW dsx-vr")).nodes.find((n) => n.name === "MV backup generation")!;
  assert.doesNotMatch(card.rating, /15 MVA/, "a 103 MW datum must not be restated at 206 MW");
  assert.match(card.rating, /17\.3 MW/);
  assert.match(buildTopology(parseBrief(REF)).nodes.find((n) => n.name === "MV backup generation")!.rating, /15 MVA as drawn/);
});

test("the optional GS-1…8 core generators total 19.8 MW and are NOT additive", () => {
  const c = counts(REF);
  assert.equal(Math.round(c.coreGenMW * 10) / 10, 19.8);
  const r = row(REF, "Core generator GS-1…8 (optional)");
  assert.equal(r.qty, 8);
  assert.match(r.scheme, /alternative to the MV backup block .* not additive/);
});

test("per-DU kit is the fixed sheet kit, multiplied — never interpolated", () => {
  const q = (item: string) => row(REF, item).qty;
  const n = DSX.duCountNominal;
  assert.equal(q("RMU skid (4-way, 600 A)"), n * DSX.du.skids);
  assert.equal(q("MSB-GPU (compute switchboard)"), n * DSX.du.msbGpu);
  assert.equal(q("MSB-SUPP (DU support switchboard)"), n * DSX.du.msbSupp);
  assert.equal(q("MSB-CHILLERS (DU)"), n * DSX.du.msbChiller);
  assert.equal(q("MSB-MECH (DU)"), n * DSX.du.msbMech);
  assert.equal(q("RPP — compute"), n * DSX.du.rppGpu);
  assert.equal(q("RPP — DU support"), n * DSX.du.rppSupp);
  assert.equal(q("MV chiller (DU)"), n * DSX.du.mvChillers);
  assert.equal(q("MVT — compute"), n * DSX.du.msbGpu, "one 4.2 MVA MVT per MSB-GPU");
});

// ── §5.5 whole-DU quantization + one core block per site ─────────────────────

test("§5.5: the site scales in WHOLE deployment units", () => {
  const du = DSX.duITMW; // 12.875 MW IT
  assert.equal(counts(`${du} MW dsx-vr`).duCount, 1, "exactly one DU's worth is one DU");
  assert.equal(counts("13 MW dsx-vr").duCount, 2, "a sliver over buys the whole next kit");
  assert.equal(counts("20 MW dsx-vr").duCount, 2);
  assert.equal(counts("0.5 MW dsx-vr").duCount, 1, "never zero DUs");
  assert.equal(counts("206 MW dsx-vr").duCount, 16, "two reference sites' worth");
});

test("§5.5: exactly one core block per site, whatever the DU count", () => {
  for (const p of ["5 MW dsx-vr", REF, "206 MW dsx-vr"]) {
    assert.equal(row(p, "Core-IT board (MSB-SUPP1…4)").qty, DSX.core.itSkids, p);
    assert.equal(row(p, "Core UPS (double-conversion, Li-ion)").qty, DSX.core.itSkids * DSX.core.upsPerBoard, p);
    assert.equal(row(p, "Core mech skid (RMU5…6)").qty, DSX.core.mechSkids, p);
    const g = buildTopology(parseBrief(p));
    assert.equal(g.nodes.filter((n) => n.interlocked).length, 8, "4 core IT + 2 core chiller + 2 core mech boards");
  }
});

test("'one deployment unit' is a capacity statement; an explicit MW figure still wins", () => {
  assert.equal(counts("give me one deployment unit").duCount, 1);
  assert.equal(counts("dsx-vr, 4 deployment units").duCount, 4);
  assert.equal(counts("100 MW dsx-vr, deployment units").duCount, 8, "MW is the more specific statement");
});

test("§5.5: the reference site fills its lineup exactly; a bigger one splits the substation", () => {
  const ref = counts(REF);
  assert.equal(ref.lineupPairs, 1, "103 MW fits one A/B pair");
  assert.equal(ref.feedersPerLineup, DSX.lineupFeederPositions, "16 of 16 positions");
  assert.equal(row(REF, "MV switchgear lineup (8DA10)").qty, 2);

  const big = counts("206 MW dsx-vr");
  assert.equal(big.rings, 25);
  assert.ok(big.lineupPairs > 1, "25 rings + aux + BESS cannot fit 16 positions on one pair");
  assert.equal(row("206 MW dsx-vr", "MV switchgear lineup (8DA10)").qty, 2 * big.lineupPairs);
  assert.equal(row("206 MW dsx-vr", "Tie switchgear (SUB1.MSG.T)").qty, big.lineupPairs);
  assert.match(brief(parseBrief("206 MW dsx-vr")), /outgrows the reference substation/);
  assert.doesNotMatch(brief(parseBrief(REF)), /outgrows the reference substation/);
});

test("§5.5: lineupPairs accounts for the aux and BESS feeders EVERY pair needs", () => {
  // Splitting the substation divides the rings, but each pair still carries its own
  // x-52-2 station aux and its own BESS feeders — so ceil(total / 16) under-counts.
  for (const p of [REF, "206 MW dsx-vr", "215 MW dsx-vr, no bess", "400 MW dsx-vr", "1000 MW dsx-vr"]) {
    const c = counts(p);
    const perLineup = Math.ceil(c.rings / c.lineupPairs) + 1 + c.bessPerLineup;
    assert.equal(c.feedersPerLineup, perLineup, `${p}: reported vs recomputed`);
    assert.ok(perLineup <= DSX.lineupFeederPositions,
      `${p}: ${perLineup} positions needed on a ${DSX.lineupFeederPositions}-position lineup`);
    if (c.lineupPairs > 1) {
      const fewer = Math.ceil(c.rings / (c.lineupPairs - 1)) + 1 + (c.bessPerLineup > 0 ? 1 : 0);
      assert.ok(fewer > DSX.lineupFeederPositions, `${p}: ${c.lineupPairs} pairs is more than needed`);
    }
  }
});

test("B1: the DRAWN lineup never exceeds its 16 positions, at any site size", () => {
  for (const p of [REF, "5 MW dsx-vr", "206 MW dsx-vr", "400 MW dsx-vr", "1000 MW dsx-vr", "206 MW dsx-vr, no bess"]) {
    const g = buildTopology(parseBrief(p));
    for (const name of ["SUB1.MSG.A", "SUB1.MSG.B"]) {
      const n = node(g, name);
      // the tie breaker is a separate 2500 A position, not one of the 16 feeders
      const feeders = n.breakers!.filter((b) => b.amp === DSX.lineupFeederA).length;
      assert.ok(feeders <= DSX.lineupFeederPositions,
        `${p} — ${name}: ${feeders} feeders drawn on a ${DSX.lineupFeederPositions}-position lineup`);
      assert.equal(feeders, counts(p).feedersPerLineup, `${p} — ${name}: graph disagrees with the schedule`);
    }
  }
});

test("B1: breaker labels are unique on every card, at every site size", () => {
  for (const p of [REF, "5 MW dsx-vr", "206 MW dsx-vr", "400 MW dsx-vr", "dsx-vr with on-site generation"]) {
    for (const n of buildTopology(parseBrief(p)).nodes) {
      const labs = (n.breakers || []).map((b) => b.label);
      const dup = labs.filter((l, i) => labs.indexOf(l) !== i);
      assert.deepEqual(dup, [], `${p} — ${n.name}: duplicate breaker tags ${JSON.stringify(dup)}`);
    }
  }
});

test("the sourced main ratings survive on the lineups and the core board", () => {
  // Deleting `mainAmp` to silence a diversity warning removes the only datum a
  // drawn lineup can be checked against — it is what let the 31-position lineup
  // through. Keep the rating; flag the diversity.
  const g = buildTopology(parseBrief(REF));
  for (const name of ["SUB1.MSG.A", "SUB1.MSG.B"]) {
    assert.equal(node(g, name).mainAmp, DSX.lineupBusA, `${name} keeps its 2500 A rating`);
    assert.equal(node(g, name).diversity, true, `${name} is flagged diversity-fed`);
  }
  const core = node(g, "MSB-SUPP1");
  assert.equal(core.mainAmp, 5000);
  assert.equal(core.diversity, true);
});

test("M3: a board's mainAmp is its TRIP setting, not its bus or frame rating", () => {
  const g = buildTopology(parseBrief(REF));
  // §2/§3 give bus rating and main frame/trip separately; the protective limit is
  // the trip, and a model that stores the bus overstates it by 20-100%.
  assert.equal(node(g, "MSB-SUPP1 (DU)").mainAmp, 2500, "3000 A bus, 3000AF/2500AT main");
  assert.equal(node(g, "MSB-CHILLERS1 (DU)").mainAmp, 800, "1200 A bus, 800 A '52' main");
  assert.equal(node(g, "MSB-CHILLER1 (core)").mainAmp, 600, "1200 A bus, interlocked 600 A '52' incomers");
  assert.equal(node(g, "MSB-GPU1").mainAmp, 5000, "5000 A bus, 5000AF/5000AT — bus and trip agree here");
});

// ── §5.6 BESS ────────────────────────────────────────────────────────────────

test("§5.6: BESS defaults to the blocks the sheets DRAW, stably across the PUE band", () => {
  // The facility-coverage sizing agreed with the drawn 4 blocks only at PUE 1.2;
  // at PUE 1.5 — inside the sourced 1.2-1.5 band — it declared the reference site
  // infeasible on its own substation. The default must not move with PUE.
  for (const pue of [1.2, 1.3, 1.35, 1.4, 1.5]) {
    const c = counts(`103 MW dsx-vr, PUE ${pue}`);
    assert.equal(c.bessBlocks, 4, `PUE ${pue}: 2 blocks per lineup as drawn`);
    assert.equal(c.lineupPairs, 1, `PUE ${pue}: the reference site still fits its own substation`);
    assert.equal(c.feedersPerLineup, DSX.lineupFeederPositions, `PUE ${pue}`);
  }
});

test("§5.6: whole-site curtailment is an explicit opt-in, never the default", () => {
  assert.equal(parseBrief(REF).bessCoverFacility, false);
  const on = parseBrief("103 MW dsx-vr, curtail the whole site");
  assert.equal(on.bessCoverFacility, true);
  const c = sizePowerChain(on).dsx!;
  const sz = sizePowerChain(on);
  assert.ok(c.bessMW >= sz.facilityMW, "opted in, the whole load is covered");
  assert.match(brief(on), /assumption about note 6/);
  assert.match(brief(parseBrief(REF)), /blocks per lineup the sheets draw/);
});

test("§5.6: no BESS feeder ever exceeds 37.5 MW (note 6)", () => {
  for (const p of [REF, "40 MW dsx-vr", "206 MW dsx-vr", "103 MW dsx-vr, curtail the whole site"]) {
    const c = counts(p);
    assert.ok(c.bessMW / c.bessBlocks <= DSX.bessBlockMW + 1e-9, `${p}`);
  }
});

test("'no bess' opts out entirely — no blocks, no feeders, no schedule rows", () => {
  const c = counts("60 MW dsx-vr, no bess");
  assert.equal(c.bessBlocks, 0);
  assert.equal(c.feedersPerLineup, c.rings + 1, "rings + station aux only");
  const sz = sizePowerChain(parseBrief("60 MW dsx-vr, no bess"));
  assert.equal(sz.schedule.filter((r) => /BESS/.test(r.item)).length, 0);
  assert.equal(byType(buildTopology(parseBrief("60 MW dsx-vr, no bess")), "bess").length, 0);
});

test("on-site base generation is off unless the brief asks for it", () => {
  assert.equal(parseBrief(REF).onsiteGen, false);
  for (const p of ["dsx-vr with on-site generation", "50 MW dsx-vr, HRSG and fuel cells", "dsx, base generation"]) {
    assert.equal(parseBrief(p).onsiteGen, true, p);
  }
  const g = buildTopology(parseBrief("dsx-vr with on-site generation"));
  assert.equal(g.nodes.filter((n) => /On-site generation/.test(n.name)).length, 2, "one block per lineup");
});

// ── the emitted graph obeys the DSX rules ────────────────────────────────────

test("every DSX-VR graph validates clean — no errors AND no warnings", () => {
  for (const p of [
    REF, "5 MW dsx-vr", "40 MW dsx-vr", "206 MW dsx-vr",
    "dsx-vr, no bess", "dsx-vr with on-site generation and HRSG",
    "give me one deployment unit", "grid-direct 250 MW, GB300",
  ]) {
    const d = design(parseBrief(p));
    assert.equal(d.graph.architecture, "dsx-vr", p);
    assert.ok(d.ok, `${p}: ${d.errors.join("; ")}`);
    const v = validate(d.graph);
    assert.deepEqual(v.warnings, [], `${p}: unexpected warnings`);
  }
});

test("§5.1: nothing on the compute path — every GPU board traces to a source through passives only", () => {
  const g = buildTopology(parseBrief(REF));
  const from = new Map<string, string[]>();
  for (const e of g.edges) { if (!from.has(e.to)) from.set(e.to, []); from.get(e.to)!.push(e.from); }
  const gpuBoards = g.nodes.filter((n) => /^MSB-GPU/.test(n.name));
  assert.equal(gpuBoards.length, DSX.du.msbGpu, "one DU is drawn in detail");
  for (const b of gpuBoards) {
    const seen = new Set<string>(), st = [b.id];
    while (st.length) {
      const u = st.pop()!;
      for (const f of from.get(u) || []) if (!seen.has(f)) { seen.add(f); st.push(f); }
    }
    for (const id of seen) {
      const n = g.nodes.find((x) => x.id === id)!;
      assert.ok(!["ups", "paralleling"].includes(n.type), `${b.name} is fed through ${n.name} (${n.type})`);
      // a generator may appear upstream only at site MV — never interposed below it
      if (n.type === "genset") {
        const lands = g.edges.filter((e) => e.from === n.id).map((e) => g.nodes.find((x) => x.id === e.to)!);
        assert.ok(lands.every((t) => (nominalVolts(t.voltage) ?? 0) >= 13800 || t.type === "transformer"),
          `${n.name} sits below MV on the compute path`);
      }
    }
  }
});

test("§5.3: every UPS sits on an interlocked 415 V core board", () => {
  const g = buildTopology(parseBrief(REF));
  const ups = byType(g, "ups");
  assert.equal(ups.length, 8, "8 core UPS drawn — matching the schedule");
  for (const u of ups) {
    const feeders = g.edges.filter((e) => e.to === u.id).map((e) => g.nodes.find((n) => n.id === e.from)!);
    assert.ok(feeders.length > 0);
    for (const f of feeders) {
      assert.equal(f.interlocked, true, `${u.name} fed from non-interlocked ${f.name}`);
      assert.equal(nominalVolts(f.voltage), 415, `${u.name} fed at ${f.voltage}`);
    }
  }
});

test("§5.2: every drawn ring is dual-ended (A + B lineup) with a normally-open point", () => {
  const g = buildTopology(parseBrief(REF));
  const a = node(g, "SUB1.MSG.A"), b = node(g, "SUB1.MSG.B");
  const rmus = byType(g, "rmu");
  assert.equal(rmus.length, DSX.du.skids + DSX.core.itSkids + DSX.core.mechSkids, "6 DU skids + 6 core skids");
  const fedBy = (board: SldNode) => g.edges.filter((e) => e.from === board.id && rmus.some((r) => r.id === e.to));
  assert.equal(fedBy(a).length, DSX.du.skids + 1, "6 DU rings + the core-load ring leave the A lineup");
  assert.equal(fedBy(b).length, DSX.du.skids + 1, "and the same count lands on the B lineup");
  // the B end of every ring is the normal open point
  for (const e of fedBy(b)) {
    const brk = b.breakers!.find((x) => x.id === e.fromBreaker)!;
    assert.equal(brk.status, "open", `${brk.label} should be the ring's open point`);
  }
  for (const e of fedBy(a)) {
    assert.equal(a.breakers!.find((x) => x.id === e.fromBreaker)!.status, "closed");
  }
});

test("§5.2: both tie breakers are normally open, and backup generation lands through XFO-BU-Gen", () => {
  const g = buildTopology(parseBrief(REF));
  for (const name of ["SUB1.MSG.A", "SUB1.MSG.B"]) {
    const tie = node(g, name).breakers!.find((b) => /52T-1/.test(b.label))!;
    assert.equal(tie.status, "open", `${name} tie`);
    assert.equal(tie.amp, DSX.tieA);
  }
  const backup = node(g, "MV backup generation");
  const via = g.edges.filter((e) => e.from === backup.id).map((e) => g.nodes.find((n) => n.id === e.to)!);
  assert.equal(via.length, 1);
  assert.equal(via[0].name, "XFO-BU-Gen", "never straight onto the tie bus");
});

test("RMU skids are 4-way switches whose ways are never over-filled", () => {
  const g = buildTopology(parseBrief(REF));
  for (const r of byType(g, "rmu")) {
    assert.equal(r.breakers!.length, 4, `${r.name} is a 4-way unit`);
    assert.ok(r.breakers!.every((b) => b.amp === 600), "600 A ways");
    assert.equal(r.mainAmp, undefined, "a ring switch has no limiting main");
    const incomers = g.edges.filter((e) => e.to === r.id).length;
    const tees = r.breakers!.filter((b) => g.edges.some((e) => e.from === r.id && e.fromBreaker === b.id)).length;
    assert.ok(incomers + tees <= 4, `${r.name}: ${incomers + tees} circuits on 4 ways`);
  }
});

test("§5.4: every voltage-tagged card sits on a level §4 governs", () => {
  const ok = new Set([38000, 34500, 13800, 4160, 2400, 480, 415]);
  for (const p of [REF, "5 MW dsx-vr", "dsx-vr with on-site generation"]) {
    for (const n of buildTopology(parseBrief(p)).nodes) {
      if (!n.voltage || n.type === "utility") continue;
      assert.ok(ok.has(nominalVolts(n.voltage) ?? -1), `${p}: ${n.name} at ${n.voltage}`);
    }
  }
});

test("the drawn graph is grouped into site / deployment unit / core block", () => {
  const g = buildTopology(parseBrief(REF));
  const names = (g.groups || []).map((x) => x.name);
  assert.equal(names.length, 3);
  assert.match(names[1], /Deployment unit DU1 \(× 8 DUs\)/, "the multiplier is on the drawn DU");
  assert.match(names[2], /Core block × 1/);
  // every member id resolves, and no element is in two groups
  const seen = new Set<string>();
  for (const gr of g.groups!) for (const id of gr.members) {
    assert.ok(g.nodes.some((n) => n.id === id), `${gr.name}: dangling member ${id}`);
    assert.ok(!seen.has(id), `${id} is in two groups`);
    seen.add(id);
  }
});

test("deterministic: same brief → byte-identical graph and schedule", () => {
  const s = parseBrief(REF);
  assert.equal(JSON.stringify(buildTopology(s)), JSON.stringify(buildTopology(s)));
  assert.equal(JSON.stringify(sizePowerChain(s)), JSON.stringify(sizePowerChain(s)));
});

test("no schedule row carries a NaN, an undefined, or a non-positive quantity", () => {
  for (const p of [REF, "5 MW dsx-vr", "206 MW dsx-vr", "dsx-vr, no bess"]) {
    for (const r of sizePowerChain(parseBrief(p)).schedule) {
      assert.ok(Number.isFinite(r.qty) && r.qty > 0, `${p} — ${r.item}: qty=${r.qty}`);
      assert.ok(!/NaN|undefined/.test(r.rating + r.scheme), `${p} — ${r.item}: ${r.rating}`);
    }
  }
});

// ── the brief ────────────────────────────────────────────────────────────────

test("brief() leads with the grid-direct story, not a redundancy table", () => {
  const md = brief(parseBrief(REF));
  assert.match(md, /no UPS and no generator anywhere on the compute path/);
  assert.match(md, /0\.02–0\.04 of PUE/, "the topology claim, sized honestly");
  assert.match(md, /band is set mostly by cooling and climate/, "and separated from the PUE range");
  assert.doesNotMatch(md, /buys the 1\.2/, "no causal claim the source will not support");
  assert.match(md, /curtail/);
  assert.match(md, /8 deployment units/);
  assert.match(md, /\| Equipment \| Qty \|/);
  assert.match(md, /Core UPS \(double-conversion, Li-ion\)/);
  assert.match(md, /Siemens UL Reference Design/);
  assert.doesNotMatch(md, /NaN|undefined/);
});

test("brief() reports the note-1 obligation and the lineup positions it consumes", () => {
  const md = brief(parseBrief(REF));
  assert.match(md, /8\.7 MW/, "0.06 × 103 × 1.40, rounded for display");
  assert.match(md, /\*\*16 of 16\*\* × 1200 A positions/);
  assert.match(md, /N-1 check/, "the corroboration that is actually independent");
});

test("design() round-trips a DSX brief end to end", () => {
  const d = design(parseBrief(REF));
  assert.equal(d.ok, true, d.errors.join("; "));
  assert.equal(d.sizing.spec.architecture, "dsx-vr");
  assert.equal(d.sizing.racks, Math.ceil((103 * 1000) / DSX.rackKW));
  assert.match(d.brief, /MW facility/);
});

// ── sizeDsx is callable directly, and agrees with the dispatch ───────────────

test("sizeDsx(spec) and sizePowerChain(spec) agree", () => {
  const spec = parseBrief(REF);
  assert.deepEqual(sizeDsx(spec).schedule, sizePowerChain(spec).schedule);
});
