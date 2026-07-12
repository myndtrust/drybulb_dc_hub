// node:test for network-equipment specs + shared/dedicated RPP arrangement + the
// aggregate-rating over-subscription check. Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { seed, applyRackSpecObj, addNode, validate, findNode, type SldGraph } from "./sld";
import { NETWORK_SWITCHES, NETWORK_RACKS, NETWORK_RACK_BY_KEY } from "./network-specs.gen";
import { arrangeNetworkRacks } from "./project";

test("network specs: switches + role racks carry power/cooling; kW ≈ Σ SKU power", () => {
  assert.ok(NETWORK_SWITCHES.length >= 4 && NETWORK_RACKS.length >= 4);
  const pwr: Record<string, number> = Object.fromEntries(NETWORK_SWITCHES.map((s) => [s.key, s.power_kw]));
  for (const r of NETWORK_RACKS) {
    assert.ok(r.power.rack_kw > 0 && r.power.circuit_amps > 0, `${r.key} power`);
    assert.ok(typeof r.cooling.type === "string" && r.cooling.liquid_fraction >= 0, `${r.key} cooling`);
    const comp = r.switches.reduce((a, s) => a + (pwr[s.sku] ?? 0) * s.qty, 0);
    assert.ok(Math.abs(r.power.rack_kw - comp) / comp <= 0.1, `${r.key} kW within 10% of composition`);
  }
  for (const k of ["ew-ib-quantum", "ew-eth-spectrumx", "ns-storage", "ns-mgmt"]) assert.ok(NETWORK_RACK_BY_KEY[k], `has ${k}`);
});

test("applyRackSpecObj works on a NET rack (netRack + interface + sized breaker)", () => {
  // start from a seed with a switchboard, add a netrack-ew and feed it from SWBD-A b8
  let g = seed();
  const add = addNode(g, "netrack-ew", 200, 760);
  g = add.graph;
  const swId = g.nodes.find((n) => n.type === "switchboard")!.id;
  // wire SWBD-A b8 (spare) → the netrack
  g.uid++; g.edges.push({ id: "e" + g.uid, from: swId, to: add.id!, fromBreaker: "b8" });
  const spec = NETWORK_RACK_BY_KEY["ew-ib-quantum"];
  const r = applyRackSpecObj(g, add.id!, spec);
  assert.equal(r.ok, true);
  const n = findNode(r.graph, add.id!)!;
  assert.equal(n.netRack, "ew-ib-quantum");
  assert.equal(n.kw, spec.power.rack_kw);
  assert.ok(n.powerIf && n.coolingIf);
  const b = findNode(r.graph, swId)!.breakers!.find((x) => x.id === "b8")!;
  assert.equal(b.amp, spec.power.circuit_amps, "feeding breaker sized to per-whip amps");
});

test("arrangeNetworkRacks dedicated: creates NET-RPPs feeding specced netracks (idempotent)", () => {
  const once = arrangeNetworkRacks(seed(), { mode: "dedicated" }).graph;
  const ew = once.nodes.filter((n) => n.type === "netrack-ew");
  const ns = once.nodes.filter((n) => n.type === "netrack-ns");
  assert.equal(ew.length, 1);
  assert.equal(ns.length, 1);
  assert.ok(once.nodes.some((n) => /^NET-RPP/.test(n.name)), "dedicated NET-RPP created");
  for (const nr of [...ew, ...ns]) {
    assert.ok(nr.netRack, "netrack specced");
    assert.ok(once.edges.some((e) => e.to === nr.id), "netrack fed");
  }
  // idempotent
  const twice = arrangeNetworkRacks(once, { mode: "dedicated" }).graph;
  assert.equal(twice.nodes.filter((n) => n.type === "netrack-ew").length, 1);
  assert.equal(twice.nodes.filter((n) => /^NET-RPP/.test(n.name)).length, once.nodes.filter((n) => /^NET-RPP/.test(n.name)).length);
});

test("arrangeNetworkRacks shared: no NET-RPP; netracks tap the compute RPP", () => {
  const g = arrangeNetworkRacks(seed(), { mode: "shared" }).graph;
  assert.equal(g.nodes.filter((n) => /^NET-RPP/.test(n.name)).length, 0);
  for (const nr of g.nodes.filter((n) => n.type === "netrack-ew" || n.type === "netrack-ns"))
    assert.ok(g.edges.some((e) => e.to === nr.id), "netrack fed from existing distribution");
});

test("aggregate rating: validate warns when served amps exceed a busbar/RPP rating", () => {
  // a busbar (rating 100 A) feeding two 120 kW loads (~167 A each per side) is over-subscribed
  let g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0 };
  g.busbars.push({ id: "b1", name: "BUS", x: 0, y: 0, w: 300, kv: "415 V", ratingA: 100 });
  const a = addNode(g, "rack", 0, 100); g = a.graph;
  const b = addNode(g, "rack", 100, 100); g = b.graph;
  g.uid++; g.edges.push({ id: "e1", from: "b1", to: a.id! });
  g.uid++; g.edges.push({ id: "e2", from: "b1", to: b.id! });
  const v = validate(g);
  assert.ok(v.warnings.some((w) => /over-subscribed/.test(w)), "over-subscription warned");
  // raising the rating clears it
  g.busbars[0].ratingA = 1000;
  assert.equal(validate(g).warnings.some((w) => /over-subscribed/.test(w)), false);
});
