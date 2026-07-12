// node:test suite for the power-topology generator (topology.js). The must-pass
// gate: every spec/scheme/scale must SIZE correctly and emit a single-line that the
// connector engine accepts (SLD.validate). Run: `node --test drafts/sld/*.test.js`
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const SLD = require("./engine.js");
const T = require("./topology.js");

const SCHEMES = ["N", "N+1", "2N", "2N+1", "distributed-4to3", "distributed-3to2", "catcher"];
const valid = (g) => SLD.validate(g);

// ── sizing math ──────────────────────────────────────────────────────────────
test("sizePowerChain: facility = IT × PUE, racks = ceil(IT / rackKW)", () => {
  const sz = T.sizePowerChain({ itMW: 30, pue: 1.2, rackKW: 120 });
  assert.equal(sz.facilityMW, 36);
  assert.equal(sz.racks, Math.ceil((30 * 1000) / 120)); // 250
  assert.equal(sz.gpus, sz.racks * 72);
});

test("sizePowerChain: facilityMW input back-solves IT via PUE", () => {
  const sz = T.sizePowerChain({ facilityMW: 36, pue: 1.2 });
  assert.equal(sz.itMW, 30);
});

test("redundancy block math matches the templates", () => {
  const need = (itMW, pod) => Math.ceil(itMW / pod);
  const n = need(30, 2.5); // 12 pods
  const blocks = (s) => T.sizePowerChain({ itMW: 30, redundancy: { ups: s } }).schedule.find((r) => r.item === "Static UPS block").qty;
  assert.equal(blocks("N"), n);
  assert.equal(blocks("N+1"), n + 1);
  assert.equal(blocks("2N"), 2 * n);
  assert.equal(blocks("distributed-4to3"), Math.ceil(n / 3) * 4);
  assert.equal(blocks("distributed-3to2"), Math.ceil(n / 2) * 3);
  assert.equal(blocks("catcher"), n + 1);
});

// ── topology validity across schemes + scales ────────────────────────────────
test("every UPS scheme emits a graph that passes SLD.validate()", () => {
  for (const ups of SCHEMES) {
    const g = T.buildTopology({ itMW: 24, redundancy: { ups } });
    const r = valid(g);
    assert.ok(r.ok, `ups=${ups}: ${r.errors.join("; ")}`);
  }
});

test("valid across a wide capacity range (1–250 MW) and both distribution modes", () => {
  for (const itMW of [1, 5, 12, 48, 120, 250]) {
    for (const distribution of ["2N", "N"]) {
      const g = T.buildTopology({ itMW, redundancy: { distribution } });
      const r = valid(g);
      assert.ok(r.ok, `itMW=${itMW} dist=${distribution}: ${r.errors.join("; ")}`);
    }
  }
});

test("default spec (no input) is valid and non-empty", () => {
  const g = T.buildTopology();
  assert.ok(valid(g).ok);
  assert.ok(g.nodes.length > 5 && g.edges.length > 5);
});

// ── distribution semantics ───────────────────────────────────────────────────
test("2N distribution dual-cords each rack; N single-cords", () => {
  const feeders = (g, name) => g.edges.filter((e) => e.to === g.nodes.find((n) => n.name === name).id).length;
  const g2 = T.buildTopology({ itMW: 12, redundancy: { distribution: "2N" } });
  const gN = T.buildTopology({ itMW: 12, redundancy: { distribution: "N" } });
  assert.equal(feeders(g2, "rack 1"), 2);
  assert.equal(feeders(gN, "rack 1"), 1);
  // 2N builds B-side switchboard + RPPs; N does not
  assert.ok(g2.nodes.some((n) => n.name === "SWBD-B"));
  assert.ok(!gN.nodes.some((n) => n.name === "SWBD-B"));
});

test("no source carries an incoming feeder (utility/genset are roots)", () => {
  const g = T.buildTopology({ itMW: 48 });
  for (const n of g.nodes.filter((x) => x.kind === "src")) {
    assert.equal(g.edges.some((e) => e.to === n.id), false, `${n.name} must be a root`);
  }
});

// ── determinism + brief ──────────────────────────────────────────────────────
test("same spec → byte-identical graph (deterministic)", () => {
  const spec = { name: "Repeat", itMW: 60, redundancy: { ups: "catcher", distribution: "2N" } };
  assert.equal(JSON.stringify(T.buildTopology(spec)), JSON.stringify(T.buildTopology(spec)));
});

test("schedule has finite qty and defined ratings (no NaN/undefined)", () => {
  for (const ups of SCHEMES) {
    const sz = T.sizePowerChain({ itMW: 48, redundancy: { ups } });
    for (const r of sz.schedule) {
      assert.ok(Number.isFinite(r.qty) && r.qty > 0, `${ups}/${r.item}: qty=${r.qty}`);
      assert.ok(r.rating && !/undefined|NaN/.test(r.rating), `${ups}/${r.item}: rating=${r.rating}`);
    }
  }
});

test("brief renders headline + schedule table from the same spec", () => {
  const md = T.brief({ name: "Aurora-2", itMW: 30, pue: 1.2 });
  assert.match(md, /# Aurora-2/);
  assert.match(md, /36 MW facility/);
  assert.match(md, /\| Equipment \| Qty \|/);
  assert.match(md, /Static UPS block/);
});
