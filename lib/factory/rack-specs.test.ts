// node:test for rack interface specs + the rack/network journey.
// Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { seed, applyRackSpec, validate, findNode } from "./sld";
import { RACK_SPECS, RACK_SPEC_BY_KEY } from "./rack-specs.gen";
import { requiredNetworkRacks, arrangeNetworkRacks } from "./project";

const rackId = (g = seed()) => g.nodes.find((n) => n.type === "rack")!.id;

test("rack specs: all entries carry power + cooling + network interfaces", () => {
  assert.ok(RACK_SPECS.length >= 7);
  for (const s of RACK_SPECS) {
    assert.ok(s.power.rack_kw > 0, `${s.key} kW`);
    assert.ok(s.power.feeds >= 1 && s.power.circuit_amps > 0, `${s.key} circuit`);
    assert.ok(typeof s.power.circuit_size === "string" && s.power.circuit_size.length > 0);
    assert.ok(s.cooling.liquid_fraction >= 0 && s.cooling.liquid_fraction <= 1, `${s.key} liquid frac`);
    assert.ok(typeof s.cooling.manifold === "string");
    assert.ok(s.network.racks_per_su > 0 && s.network.leaf_per_rack > 0, `${s.key} network`);
  }
  for (const k of ["h100", "gb200-nvl72", "gb300-nvl72", "vr200-nvl144", "amd-mi355x", "tpu-ironwood", "trainium2"])
    assert.ok(RACK_SPEC_BY_KEY[k], `has ${k}`);
});

test("applyRackSpec: sets kW + interface and auto-sizes the feeding circuit", () => {
  const g = seed();
  const id = rackId(g);
  assert.equal(findNode(g, id)!.aiRack, undefined, "starts generic");
  const r = applyRackSpec(g, id, "gb200-nvl72");
  assert.equal(r.ok, true);
  const n = findNode(r.graph, id)!;
  assert.equal(n.aiRack, "gb200-nvl72");
  assert.equal(n.kw, 120);
  const spec = RACK_SPEC_BY_KEY["gb200-nvl72"];
  assert.equal(n.powerIf!.circuit_amps, spec.power.circuit_amps);
  assert.ok(n.coolingIf!.type === "liquid-dlc");
  // every feeder carries the conductor size; each whip breaker = the per-whip amps
  const feeders = r.graph.edges.filter((e) => e.to === id);
  assert.ok(feeders.length >= 2, "dual-corded");
  for (const e of feeders) {
    assert.equal(e.size, spec.power.circuit_size);
    if (e.fromBreaker) {
      const b = findNode(r.graph, e.from)!.breakers!.find((x) => x.id === e.fromBreaker)!;
      assert.equal(b.amp, spec.power.circuit_amps, "whip breaker = per-whip amps");
    }
  }
  assert.equal(validate(r.graph).ok, true);
});

test("applyRackSpec: rejects a non-rack target and an unknown spec", () => {
  const g = seed();
  const swId = g.nodes.find((n) => n.type === "switchboard")!.id;
  assert.equal(applyRackSpec(g, swId, "gb200-nvl72").ok, false);
  assert.equal(applyRackSpec(g, rackId(g), "nope").ok, false);
});

test("requiredNetworkRacks: sizes from compute racks (8 racks → 1 SU)", () => {
  const need = requiredNetworkRacks(seed());
  assert.equal(need.computeRacks, 8);
  assert.equal(need.suCount, 1);
  assert.equal(need.ewRacks, 1);
  assert.equal(need.nsRacks, 1);
});

test("arrangeNetworkRacks: idempotent + adds fed E-W and N-S racks", () => {
  const once = arrangeNetworkRacks(seed()).graph;
  const ew = once.nodes.filter((n) => n.type === "netrack-ew").length;
  const ns = once.nodes.filter((n) => n.type === "netrack-ns").length;
  assert.equal(ew, 1);
  assert.equal(ns, 1);
  // every network rack is fed
  for (const nr of once.nodes.filter((n) => n.type === "netrack-ew" || n.type === "netrack-ns"))
    assert.ok(once.edges.some((e) => e.to === nr.id), "netrack fed");
  assert.equal(validate(once).ok, true);
  // running again yields the same counts (idempotent)
  const twice = arrangeNetworkRacks(once).graph;
  assert.equal(twice.nodes.filter((n) => n.type === "netrack-ew").length, 1);
  assert.equal(twice.nodes.filter((n) => n.type === "netrack-ns").length, 1);
});
