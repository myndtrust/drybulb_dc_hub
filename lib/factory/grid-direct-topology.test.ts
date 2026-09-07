// node:test suite for the modular-pod GENERATOR (lib/factory/grid-direct-topology.ts
// + the architecture dispatch in ./topology, + validateGridDirect in ./sld). A
// second grid-direct pattern alongside DSX-VR — the point of this suite is the
// one respect it differs from dsx-vr: zero UPS anywhere (not even a core block),
// and single-corded racks instead of dual-fed. Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validate, seed, type SldGraph } from "./sld";
import { MOD, sizeGridDirect } from "./grid-direct-topology";
import { parseBrief, sizePowerChain, buildTopology, design, brief, normalizeSpec } from "./topology";

const byType = (g: SldGraph, type: string) => g.nodes.filter((n) => n.type === type);
const REF = "50 MW modular pods, GB300";

// ── the architecture gate ────────────────────────────────────────────────────

test("gate: modular-pod phrases select it, without disturbing dsx-vr's own triggers", () => {
  for (const p of ["40 MW modular pods", "single-corded 60 MW facility", "30 MW row-redundant MDC", "pod-based 20 MW deployment", "a facility with panelboard-fed racks"]) {
    assert.equal(parseBrief(p).architecture, "modular-pod", p);
  }
  // dsx-vr's bare "grid-direct"/"no ups"/"curtailable"/"deployment unit" triggers
  // must still resolve to dsx-vr, not collide with the new architecture.
  for (const p of ["40 MW, grid-direct compute", "30 MW with no UPS", "a fully curtailable 60 MW factory", "give me one deployment unit"]) {
    assert.equal(parseBrief(p).architecture, "dsx-vr", p);
  }
  // legacy briefs are untouched
  for (const p of ["48 MW GB300 campus, Tier III, 2N to the rack", ""]) {
    assert.equal(parseBrief(p).architecture, "ups-chain", p);
  }
});

test("gate: the legacy UPS-chain seed tagged modular-pod fails the rules", () => {
  const g: SldGraph = { ...seed(), architecture: "modular-pod" };
  const v = validate(g);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /UPS.*has no place in the modular-pod pattern/.test(e)), "UPS rule fires");
  assert.ok(v.errors.some((e) => /single-corded/.test(e)), "dual-corded racks rule fires");
});

// ── sizing ───────────────────────────────────────────────────────────────────

test("sizeGridDirect: whole-pod quantization, itMW/facilityMW track the QUANTIZED build", () => {
  const spec = normalizeSpec(parseBrief(REF));
  const sz = sizeGridDirect(spec);
  const podRacks = MOD.panelboardsPerSide * MOD.racksPerPanelboard * 2;
  assert.equal(sz.racks % podRacks, 0, "racks are always a whole number of pods");
  assert.equal(sz.racks, sz.podsNeeded * podRacks);
  // itMW/facilityMW are derived from the quantized racks, not the raw ask — so
  // they never drift from what's actually drawn and priced (unlike the raw ask,
  // which can sit well inside the last pod and overstate what's built).
  assert.equal(sz.itMW, Math.round(((sz.racks * spec.rackKW) / 1000) * 10) / 10);
  assert.equal(sz.facilityMW, Math.round(sz.itMW * spec.pue * 10) / 10);
  assert.equal(sz.gpus, sz.racks * spec.gpusPerRack);
});

test("sizeGridDirect: a request landing just inside a pod boundary doesn't overstate the build", () => {
  // A tiny ask (well under one pod's ~5.76 MW capacity) must still report itMW
  // consistent with the one whole pod actually built, not the raw ask.
  const spec = normalizeSpec(parseBrief("5 MW modular pods"));
  const sz = sizeGridDirect(spec);
  assert.equal(sz.podsNeeded, 1);
  assert.equal(sz.itMW, Math.round(((sz.racks * spec.rackKW) / 1000) * 10) / 10);
});

test("sizeGridDirect: schedule has no UPS row and no genset row unless onsiteGen is asked for", () => {
  const off = sizePowerChain(parseBrief(REF));
  assert.ok(!off.schedule.some((r) => /ups/i.test(r.item)), "no UPS anywhere in the schedule");
  assert.ok(!off.schedule.some((r) => /genset/i.test(r.item)), "no genset unless opted in");
  const on = sizePowerChain(parseBrief(REF + ", with on-site generation"));
  assert.ok(on.schedule.some((r) => /genset/i.test(r.item)), "opt-in draws a genset row");
});

test("HV/MV utility-transformer qty scales with facility size, not fixed at 2", () => {
  const small = sizeGridDirect(normalizeSpec(parseBrief("40 MW modular pods")));
  const huge = sizeGridDirect(normalizeSpec(parseBrief("500 MW modular pods")));
  const rowOf = (sz: ReturnType<typeof sizeGridDirect>) => sz.schedule.find((r) => r.item.startsWith("HV/MV utility transformer"))!;
  assert.equal(rowOf(small).qty, MOD.utilityServices, "at nominal scale, one transformer per service is enough");
  assert.ok(rowOf(huge).qty > rowOf(small).qty, "a materially bigger facility needs more transformer capacity");
  assert.equal(rowOf(huge).qty % MOD.utilityServices, 0, "qty stays split evenly across the two diverse services");
});

test("MV common-bus mainAmp scales with facility size instead of a flat generic default", () => {
  const small = buildTopology(parseBrief("40 MW modular pods"));
  const huge = buildTopology(parseBrief("500 MW modular pods"));
  const mvOf = (g: SldGraph) => g.nodes.find((n) => n.name.includes("MV SWBD"))!;
  assert.ok((mvOf(huge).mainAmp ?? 0) > (mvOf(small).mainAmp ?? 0), "a bigger facility gets a bigger MV bus rating");
});

test("deterministic: same spec → byte-identical graph", () => {
  const a = buildTopology(parseBrief(REF));
  const b = buildTopology(parseBrief(REF));
  assert.deepEqual(a, b);
});

test("rack node's kw carries the spec's rack size — the cost rollup reads kw, not the rating string", () => {
  const g = buildTopology(parseBrief("40 MW modular pods, PUE 1.2, 200 kW/rack"));
  const racks = g.nodes.filter((n) => n.kind === "load" && n.grp === "IT");
  assert.ok(racks.length > 0);
  for (const r of racks) assert.equal(r.kw, 200, r.name);
});

// ── topology invariants ─────────────────────────────────────────────────────

test("buildGridDirect: valid, no UPS node anywhere, architecture tag set", () => {
  const g = buildTopology(parseBrief(REF));
  assert.equal(g.architecture, "modular-pod");
  assert.equal(byType(g, "ups").length, 0);
  const v = validate(g);
  assert.deepEqual(v.errors, []);
});

test("compute racks are single-corded — exactly one feeder each", () => {
  const g = buildTopology(parseBrief(REF));
  const racks = g.nodes.filter((n) => n.kind === "load" && n.grp === "IT");
  assert.ok(racks.length > 0);
  for (const r of racks) {
    const feeders = g.edges.filter((e) => e.to === r.id).length;
    assert.equal(feeders, 1, r.name);
  }
});

test("the ATS backs up the chiller only — never reaches a compute rack", () => {
  const g = buildTopology(parseBrief(REF));
  const ats = g.nodes.find((n) => n.type === "paralleling")!;
  assert.ok(ats);
  const adj = new Map<string, string[]>();
  for (const e of g.edges) { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from)!.push(e.to); }
  const seen = new Set<string>(); const st = [ats.id];
  while (st.length) { const u = st.pop()!; for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
  const reached = [...seen].map((id) => g.nodes.find((n) => n.id === id)).filter(Boolean);
  assert.ok(reached.every((n) => n!.grp !== "IT" && n!.grp !== "NET"), "ATS never reaches compute/network load");
  assert.ok(reached.some((n) => n!.type === "chiller"), "ATS does reach the chiller it backs up");
});

test("MV common bus has no tie breaker and both utility mains land on it", () => {
  const g = buildTopology(parseBrief(REF));
  const mv = g.nodes.find((n) => n.name.includes("MV SWBD"))!;
  const incoming = g.edges.filter((e) => e.to === mv.id);
  assert.equal(incoming.length >= 2, true, "both utility mains feed the common bus");
  // No breaker labeled "TIE" anywhere — the convention ups-chain/dsx-vr use for
  // their normally-open bus tie. This pattern has a single common bus instead.
  assert.ok(!g.nodes.some((n) => (n.breakers || []).some((b) => b.label === "TIE")), "no tie breaker — this pattern has no split-bus tie");
});

test("BESS defaults on; on-site generation is opt-in and off by default", () => {
  const on = buildTopology(parseBrief(REF));
  assert.ok(byType(on, "bess").length === 1);
  assert.equal(byType(on, "genset").length, 0);
  const withGen = buildTopology(parseBrief(REF + ", with on-site generation"));
  assert.equal(byType(withGen, "genset").length, 1);
});

test("design(): ok=true and the brief carries the headline", () => {
  const d = design(parseBrief(REF));
  assert.equal(d.ok, true);
  assert.match(d.brief, /No UPS anywhere in the design/);
});

test("brief() renders a schedule table", () => {
  const md = brief(parseBrief(REF));
  assert.match(md, /\| Compute rack \|/);
  assert.match(md, /single-corded/);
});
