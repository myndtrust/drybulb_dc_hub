// node:test for the single-line ↔ cost-model adapter (lib/factory/project.ts).
// Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { makeLocation } from "../cost/types";
import { computeCost } from "../cost/model";
import { validate, seed } from "./sld";
import {
  rollupGraph, graphToLocation, applyLocationPatch, locationToGraph, buildGraphForRacks,
} from "./project";

test("rollupGraph: GB300 golden anchors (8 racks / 576 GPU / 0.96 MW)", () => {
  const roll = rollupGraph(seed());
  assert.equal(roll.rackCount, 8);
  assert.equal(roll.gpus, 576);
  assert.equal(roll.itKW, 960); // 8 × 120 kW
  assert.equal(roll.itKW / 1000, 0.96);
  assert.equal(roll.counts["ups"], 4);
  assert.equal(roll.counts["switchboard"], 5); // MV-A/B + LV SWBD-A/B + gen paralleling
  assert.equal(roll.counts["rpp"], 4);
});

test("graphToLocation: IT capacity flows to capacityMW", () => {
  const base = makeLocation("X");
  const patch = graphToLocation(seed(), base);
  assert.equal(patch.capacityMW, 0.96);
});

test("buildGraphForRacks: produces a valid, sized, dual-corded single-line", () => {
  for (const n of [1, 4, 5, 8, 13, 16]) {
    const g = buildGraphForRacks(n);
    assert.equal(validate(g).ok, true, `n=${n} valid`);
    assert.equal(g.nodes.filter((x) => x.type === "rack").length, n);
    for (const rk of g.nodes.filter((x) => x.type === "rack")) {
      assert.equal(g.edges.filter((e) => e.to === rk.id).length, 2, "each rack dual-corded");
    }
  }
});

test("round-trip: locationToGraph → rollupGraph is idempotent on capacity", () => {
  for (const mw of [0.96, 1.2, 1.92, 3.6]) {
    const loc = applyLocationPatch(makeLocation("RT"), { capacityMW: mw });
    const g = locationToGraph(loc);
    const back = graphToLocation(g, loc).capacityMW!;
    // rack quantisation: capacity rounds to a whole number of 120 kW racks
    const racks = Math.round((mw * 1000) / 120);
    assert.equal(g.nodes.filter((n) => n.type === "rack").length, racks);
    assert.equal(back, (racks * 120) / 1000);
  }
});

test("capex identity: graph→capacity is a clean scalar (linear, no double count)", () => {
  const base = makeLocation("CAP");
  const loc1 = applyLocationPatch(base, graphToLocation(buildGraphForRacks(8), base));
  const loc2 = applyLocationPatch(base, graphToLocation(buildGraphForRacks(16), base));
  const c1 = computeCost(loc1, null).totalCapex;
  const c2 = computeCost(loc2, null).totalCapex;
  assert.ok(c1 > 0 && Number.isFinite(c1));
  assert.equal(loc2.capacityMW, 2 * loc1.capacityMW); // 16 vs 8 racks
  // doubling the IT capacity doubles total capex (no hidden additive terms)
  assert.ok(Math.abs(c2 - 2 * c1) / c2 < 1e-9, `c2≈2·c1 (got ${c1}, ${c2})`);
});

test("power conservation: Σ IT load kW == capacityMW × 1000", () => {
  const g = buildGraphForRacks(13);
  const loc = applyLocationPatch(makeLocation("PC"), graphToLocation(g, makeLocation("PC")));
  const itKW = g.nodes.filter((n) => n.grp === "IT").reduce((a, n) => a + n.kw, 0);
  assert.equal(itKW, loc.capacityMW * 1000);
});
