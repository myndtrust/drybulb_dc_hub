// node:test suite for the in-app power-topology generator (lib/factory/topology.ts).
// Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { validate, type SldGraph } from "./sld";
import { parseBrief, sizePowerChain, buildTopology, design, brief } from "./topology";

const SCHEMES = ["N", "N+1", "2N", "2N+1", "distributed-4to3", "distributed-3to2", "catcher"] as const;
const feeders = (g: SldGraph, name: string) => g.edges.filter((e) => e.to === g.nodes.find((n) => n.name === name)!.id).length;

// ── NL parser ────────────────────────────────────────────────────────────────
test("parseBrief reads capacity, schemes, tier, platform from prose", () => {
  const s = parseBrief('48 MW "Stargate" GB300 campus, Tier III, N+1 generation, distributed 4-to-make-3 UPS, 2N to the rack');
  assert.equal(s.itMW, 48);
  assert.equal(s.name, "Stargate");
  assert.equal(s.tier, "III");
  assert.equal(s.redundancy.generation, "N+1");
  assert.equal(s.redundancy.ups, "distributed-4to3");
  assert.equal(s.redundancy.distribution, "2N");
  assert.equal(s.rackKW, 120);
});

test("parseBrief: 'facility' MW back-solves IT via PUE; catcher + GB200 detected", () => {
  const s = parseBrief("100 MW facility, PUE 1.25, GB200, catcher UPS");
  assert.equal(s.redundancy.ups, "catcher");
  assert.equal(s.rackKW, 132);
  assert.equal(Math.round(s.itMW), 80); // 100 / 1.25
});

test("parseBrief: empty/garbage falls back to sourced defaults", () => {
  const s = parseBrief("");
  assert.equal(s.itMW, 10);
  assert.equal(s.redundancy.ups, "distributed-4to3");
  assert.equal(s.tier, "III");
});

// ── sizing ─────────────────────────────────────────────────────────────────--
test("sizePowerChain: facility = IT × PUE; racks = ceil(IT / rackKW); no NaN", () => {
  const sz = sizePowerChain({ itMW: 30, pue: 1.2, rackKW: 120 });
  assert.equal(sz.facilityMW, 36);
  assert.equal(sz.racks, 250);
  assert.equal(sz.gpus, 250 * 72);
  for (const r of sz.schedule) {
    assert.ok(Number.isFinite(r.qty) && r.qty > 0, `${r.item}: qty=${r.qty}`);
    assert.ok(!/NaN|undefined/.test(r.rating), `${r.item}: ${r.rating}`);
  }
});

test("UPS block math matches the redundancy templates", () => {
  const n = Math.ceil(30 / 2.5); // 12 pods
  const q = (s: string) => sizePowerChain({ itMW: 30, redundancy: { ups: s as never } }).schedule.find((r) => r.item === "Static UPS block")!.qty;
  assert.equal(q("N+1"), n + 1);
  assert.equal(q("2N"), 2 * n);
  assert.equal(q("distributed-4to3"), Math.ceil(n / 3) * 4);
  assert.equal(q("catcher"), n + 1);
});

// ── topology validity ────────────────────────────────────────────────────────
test("every UPS scheme × capacity emits a graph that passes sld.validate()", () => {
  for (const ups of SCHEMES) {
    for (const itMW of [1, 12, 48, 250]) {
      const g = buildTopology({ itMW, redundancy: { ups } });
      const r = validate(g);
      assert.ok(r.ok, `ups=${ups} itMW=${itMW}: ${r.errors.join("; ")}`);
    }
  }
});

test("2N dual-cords each rack and builds SWBD-B; N single-cords", () => {
  const g2 = buildTopology({ itMW: 12, redundancy: { distribution: "2N" } });
  const gN = buildTopology({ itMW: 12, redundancy: { distribution: "N" } });
  assert.equal(feeders(g2, "rack 1"), 2);
  assert.equal(feeders(gN, "rack 1"), 1);
  assert.ok(g2.nodes.some((n) => n.name === "SWBD-B"));
  assert.ok(!gN.nodes.some((n) => n.name === "SWBD-B"));
});

test("design(): from a prompt-derived spec, ok=true and brief carries the headline", () => {
  const spec = parseBrief("48 MW GB300 campus, distributed 4-to-make-3 UPS, 2N");
  const d = design(spec);
  assert.equal(d.ok, true, d.errors.join("; "));
  assert.match(d.brief, /MW facility/);
});

test("main-tie-main MV: two MV boards + tie; BESS at PCC; gensets at LV not MV", () => {
  const g = buildTopology(parseBrief("48 MW GB300 campus, distributed 4-to-make-3 UPS, 2N to the rack"));
  const mvBoards = g.nodes.filter((n) => n.type === "switchboard" && /MV SWBD-[AB]/.test(n.name));
  assert.equal(mvBoards.length, 2, "two MV switchboards");
  // normally-open tie breaker MV-A → MV-B
  const tie = g.edges.find((e) => e.from === mvBoards.find((n) => /MV SWBD-A/.test(n.name))!.id && e.to === mvBoards.find((n) => /MV SWBD-B/.test(n.name))!.id);
  assert.ok(tie, "MV-A → MV-B tie edge exists");
  // BESS present, and no genset feeds an MV board (gens are on 480 V)
  assert.equal(g.nodes.filter((n) => n.type === "bess").length, 1);
  const gen = g.nodes.find((n) => n.type === "genset")!;
  const genTargets = g.edges.filter((e) => e.from === gen.id).map((e) => g.nodes.find((n) => n.id === e.to)!);
  assert.ok(genTargets.every((t) => !/MV SWBD/.test(t.name)), "gensets do not feed an MV board");
  assert.ok(genTargets.some((t) => /GEN PARALLEL/.test(t.name)), "gensets feed the 480 V paralleling board");
});

test("no bess opt-out and MV-gen override are honored", () => {
  const noBess = buildTopology(parseBrief("20 MW, no bess"));
  assert.equal(noBess.nodes.filter((n) => n.type === "bess").length, 0);
  const mvGen = buildTopology(parseBrief("30 MW, MV generators"));
  const gen = mvGen.nodes.find((n) => n.type === "genset")!;
  assert.ok(mvGen.edges.some((e) => e.from === gen.id && /MV SWBD/.test(mvGen.nodes.find((n) => n.id === e.to)!.name)));
});

test("deterministic: same spec → byte-identical graph", () => {
  const spec = { name: "Repeat", itMW: 60, redundancy: { ups: "catcher" as const, distribution: "2N" as const } };
  assert.equal(JSON.stringify(buildTopology(spec)), JSON.stringify(buildTopology(spec)));
});

test("brief renders a schedule table", () => {
  const md = brief(parseBrief("30 MW, PUE 1.2"));
  assert.match(md, /\| Equipment \| Qty \|/);
  assert.match(md, /Static UPS block/);
});
