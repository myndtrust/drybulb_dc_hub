// node:test for network systems (lib/rackline/network.ts + cable routing in analysis.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./analysis";
import { DEF_LIB } from "./constants";
import { DEFAULT_ELEC, addDevice, clone, libIndex, newRack, newScenario } from "./model";
import { DEFAULT_NETS, apportion, netGraph, netSummaries } from "./network";
import { buildNvl72Pod, defaultNvl72Options, ensureNvl72Lib } from "./nvl72";
import type { LibItem } from "./types";

const libItems = (): LibItem[] => { const l = DEF_LIB.map((x) => ({ ...x, ports: { ...x.ports } })); ensureNvl72Lib(l); return l; };

test("network: untagged rooms route as before, one group per system and type", () => {
  const items = libItems(), lib = libIndex(items);
  const s = newScenario("t");
  const c = newRack("R01", 0, 0); addDevice(c, "b300-air", lib); s.racks.push(c);
  const n = newRack("NET", 3, 0); n.role = "network"; addDevice(n, "leaf-800", lib); s.racks.push(n);
  const an = analyze(s, { lib, elec: DEFAULT_ELEC });
  assert.deepEqual(an.cab.groups.map((g) => [g.net, g.type, g.count, g.to.name]).sort(), [
    ["net-fabric", "fabric", 8, "NET"], ["net-mgmt", "mgmt", 1, "NET"], ["net-oob", "bmc", 1, "NET"], ["net-storage", "storage", 2, "NET"],
  ]);
  assert.ok(an.cab.groups.every((g) => g.link === "access"));
});

test("network: each system goes to the racks holding its leaves; spines get uplinks only", () => {
  const items = libItems();
  const res = buildNvl72Pod({ ...defaultNvl72Options(), racks: 8 }, items, DEFAULT_ELEC);
  const s = res.scenario, lib = libIndex(items);
  const an = analyze(s, { lib, elec: res.elec });
  const spine = s.racks.find((r) => r.name === "NET-SPINE")!;
  assert.ok(spine, "spine rack");
  // No endpoint cable lands on the spine rack.
  assert.ok(!an.cab.groups.some((g) => g.link === "access" && g.to.id === spine.id));
  const fabric = netSummaries(s, lib, an.cab.groups).find((n) => n.sys.id === "net-fabric")!;
  assert.equal(fabric.access, 8 * 144);
  assert.equal(fabric.uplink, 8 * 144); // non-blocking: one uplink per endpoint cable
  assert.equal(fabric.spines, res.net.computeSpine + res.net.superSpine);
  // OOB has no spines, so no uplinks.
  const oob = netSummaries(s, lib, an.cab.groups).find((n) => n.sys.id === "net-oob")!;
  assert.equal(oob.uplink, 0);
  assert.equal(oob.access, 8 * 54 + 12); // in-rack BMC ports + the control plane's 12 nodes
  assert.ok(!an.warns.some((w) => /leaf switch ports|no network system/.test(w.msg)), an.warns.map((w) => w.msg).join("\n"));
});

test("network: a cable type in no system is flagged; a custom system takes it", () => {
  const items = libItems(), lib = libIndex(items);
  const s = newScenario("t");
  const c = newRack("R01", 0, 0); addDevice(c, "b300-air", lib); s.racks.push(c);
  const n = newRack("NET", 3, 0); n.role = "network"; s.racks.push(n);
  s.nets = clone(DEFAULT_NETS).filter((x) => x.id !== "net-mgmt");
  let an = analyze(s, { lib, elec: DEFAULT_ELEC });
  assert.ok(an.cab.groups.some((g) => g.net === "net-none" && g.type === "mgmt"));
  assert.ok(an.warns.some((w) => /no network system/.test(w.msg)));
  s.nets.push({ id: "x", name: "Mgmt", color: "#000", cables: ["mgmt"], racks: [n.id], uplink: 0 });
  an = analyze(s, { lib, elec: DEFAULT_ELEC });
  assert.ok(an.cab.groups.some((g) => g.net === "x" && g.type === "mgmt"));
});

test("network: graph edges add up to the cable groups; spread reaches every leaf", () => {
  const items = libItems();
  const res = buildNvl72Pod({ ...defaultNvl72Options(), racks: 8 }, items, DEFAULT_ELEC);
  const s = res.scenario, lib = libIndex(items);
  const an = analyze(s, { lib, elec: res.elec });
  const g = netGraph(s, lib, an.cab.groups);
  const sum = (l: { net: string; link: string; count: number }[], net: string, link: string) => l.filter((x) => x.net === net && x.link === link).reduce((a, x) => a + x.count, 0);
  for (const net of ["net-fabric", "net-storage", "net-oob"]) for (const link of ["access", "uplink"])
    assert.equal(sum(g.edges, net, link), sum(an.cab.groups, net, link), `${net} ${link}`);
  // Rail-optimised: one compute rack's fabric ports land on every fabric leaf.
  const leaves = g.nodes.filter((n) => n.kind === "leaf" && n.nets.includes("net-fabric"));
  const r101 = g.nodes.find((n) => n.kind === "endpoint" && n.label === "R101")!;
  const reached = new Set(g.edges.filter((e) => e.a === r101.id && e.net === "net-fabric").map((e) => e.b));
  assert.equal(reached.size, leaves.length);
  // Each leaf's uplinks go to as many different spines as it has uplinks (full mesh when there are enough).
  const spines = g.nodes.filter((n) => n.kind === "spine" && n.nets.includes("net-fabric"));
  for (const l of leaves) {
    const up = g.edges.filter((e) => e.a === l.id && e.link === "uplink");
    const n = up.reduce((a, e) => a + e.count, 0);
    assert.equal(new Set(up.map((e) => e.b)).size, Math.min(n, spines.length), l.label);
  }
  // No single leaf rack is over its ports.
  assert.ok(!an.warns.some((w) => /leaf switch ports/.test(w.msg)), an.warns.map((w) => w.msg).join("; "));
});

test("network: apportion splits exactly", () => {
  assert.deepEqual(apportion(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(apportion(7, [0, 0]), [4, 3]);
  assert.equal(apportion(144, [8, 8, 8, 7]).reduce((a, v) => a + v, 0), 144);
});
