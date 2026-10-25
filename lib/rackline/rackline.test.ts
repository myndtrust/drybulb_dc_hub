// node:test for the Rackline engine (no network — saved-projects.ts is
// type-checked only). Run: node --test --import tsx lib/rackline/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { analyze, cableAnalysis, isContained } from "./analysis";
import { DEF_LIB, PDU_TYPES } from "./constants";
import { parseDXF } from "./dxf";
import { buildScenario } from "./generate";
import { rackRows } from "./geometry";
import { migrateProject, RacklineDocError } from "./migrate";
import {
  DEFAULT_ELEC, addDevice, autoStripe, choosePDU, fits, libIndex, newRack, newScenario, produce, stripeLoads,
} from "./model";
import { sweep } from "./sweep";
import type { RacklineProject } from "./types";

const lib = libIndex(DEF_LIB);
const ctx = { lib, elec: DEFAULT_ELEC };
/** Test fixture: 8 generic 8-GPU nodes at 1, 2 and 4 per rack (built, not bundled). */
function exampleProject(): RacklineProject {
  const base = { nodes: 8, model: "b300-air", pattern: "pod" as const, rackW: 0.6, cold: 1.2, hot: 1.2, net: true, red: "N+1" as const, ox: 3, oy: 4 };
  const scenarios = [
    buildScenario({ ...base, name: "A", perRack: 1, cooling: "hac" }, DEF_LIB, DEFAULT_ELEC),
    buildScenario({ ...base, name: "B", perRack: 2, cooling: "hac" }, DEF_LIB, DEFAULT_ELEC),
    buildScenario({ ...base, name: "C", perRack: 4, cooling: "rdhx", pattern: "single" }, DEF_LIB, DEFAULT_ELEC),
  ];
  return { schemaVersion: 1, name: "fixture", units: "ft", lib: DEF_LIB, elec: DEFAULT_ELEC, bg: null, scenarios, active: scenarios[0].id };
}

const near = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);

test("example project: 8 nodes at 1 / 2 / 4 per rack", () => {
  const p = exampleProject();
  const [A, B, C] = p.scenarios.map((s) => analyze(s, ctx));
  for (const a of [A, B, C]) {
    assert.equal(a.nodes, 8);
    near(a.it, 123.75, 0.01, "IT kW"); // 8 × 14.5 kW + network rack 7.75 kW
  }
  assert.equal(A.racks.length, 9);
  assert.equal(B.racks.length, 5);
  assert.equal(C.racks.length, 3);
  near(A.maxRack, 14.5, 1e-9);
  near(B.maxRack, 29, 1e-9);
  near(C.maxRack, 58, 1e-9);
});

test("PDU sizing: smallest size × pairs that passes feed loss", () => {
  const p = exampleProject();
  const pick = (si: number) => {
    const r = p.scenarios[si].racks.find((r) => r.role === "compute")!;
    return `${r.pduPairs}×${PDU_TYPES[r.pdu].amps}`;
  };
  assert.equal(pick(0), "1×32");
  assert.equal(pick(1), "1×60");
  assert.equal(pick(2), "2×60");
  for (const s of p.scenarios) for (const r of s.racks) assert.ok(stripeLoads(r, lib, DEFAULT_ELEC, 1).util <= 1, r.name);
});

test("striping: PSUs split A/B and feed loss doubles phase current", () => {
  const r = newRack("R1", 0, 0);
  addDevice(r, "b300-air", lib);
  autoStripe(r, lib, 1);
  const m = r.devs[0].map;
  assert.equal(m.length, 12);
  assert.equal(m.filter((x) => x.f === "A").length, 6);
  const st = stripeLoads(r, lib, DEFAULT_ELEC, 1);
  near(st.maxF, st.maxN * 2, 1e-9);
  // 14.5 kW over 12 PSUs at 240 V × 0.98 pf, 2 PSUs per phase per feed.
  near(st.maxN, (14500 / 12 / (240 * 0.98)) * 2, 1e-6);
});

test("stripeLoads never mutates an unstriped rack", () => {
  const r = newRack("R1", 0, 0);
  addDevice(r, "b300-air", lib);
  const before = JSON.stringify(r);
  stripeLoads(r, lib, DEFAULT_ELEC, 1);
  assert.equal(JSON.stringify(r), before);
});

test("fits / addDevice respect occupancy and height", () => {
  const r = newRack("R1", 0, 0);
  for (let i = 0; i < 4; i++) assert.ok(addDevice(r, "b300-air", lib));
  assert.equal(addDevice(r, "b300-air", lib), null, "fifth 10U node does not fit in 48U");
  assert.equal(fits(r, lib["b300-air"], 1, lib), false);
  assert.ok(addDevice(r, "mgmt-sw", lib, true));
});

test("RDHx shortfall is flagged in the 4-per-rack scenario", () => {
  const a = analyze(exampleProject().scenarios[2], ctx);
  assert.ok(a.warns.some((w) => /RDHx short by 8\.0 kW/.test(w.msg)), a.warns.map((w) => w.msg).join("; "));
});

test("containment: racks open into the HAC, moving one out uncontains it", () => {
  const s = exampleProject().scenarios[0];
  const compute = s.racks.filter((r) => r.role === "compute");
  assert.ok(compute.every((r) => isContained(s, r)));
  const moved = produce(s, (d) => { d.racks[0].y -= 5; });
  assert.equal(isContained(moved, moved.racks[0]), false);
});

test("multiple HACs: each pod can have its own containment", () => {
  const s = produce(exampleProject().scenarios[0], (d) => {
    const h = d.hacs[0];
    d.hacs.push({ ...h, id: "hac2", name: "HAC-2", x: h.x + 20 });
    for (const r of d.racks) r.x += 20; // shift every rack under HAC-2
  });
  assert.ok(s.racks.filter((r) => r.role === "compute").every((r) => isContained(s, r)));
});

test("single line: TX-1 load, A/B feed-loss case and secondary fault current", () => {
  const a = analyze(exampleProject().scenarios[1], ctx);
  const tx = a.elec.tx1, rppa = a.elec.rppa;
  assert.ok(tx.design > a.it && tx.util < 0.2, `tx design ${tx.design}`);
  near(rppa.a, 0, 1e-9, "RPP-A carries nothing with feed A lost");
  near(rppa.b, (a.it / 0.95), 0.01, "RPP-A carries all IT with feed B lost");
  // 2500 kVA, 415 V, 5.75 %Z on an infinite bus.
  near(tx.isc!, 2500e3 / (Math.sqrt(3) * 415 * 0.0575) / 1000, 1e-6);
});

test("cable routing goes over trays and reports fill", () => {
  const s = exampleProject().scenarios[0];
  const c = cableAnalysis(s, lib);
  assert.ok(c.groups.length > 0);
  assert.equal(c.noPath, 0);
  assert.ok(c.groups.every((g) => g.via !== "direct"));
  assert.ok(c.segs.some((sg) => sg.fill > 0));
  assert.ok(c.groups.every((g) => g.std >= g.len));
});

test("rackRows: two-row pod gives two rows, rear view reverses order", () => {
  const s = exampleProject().scenarios[0];
  const f = rackRows(s, "front"), r = rackRows(s, "rear");
  assert.equal(f.length, 2);
  assert.deepEqual(r[0].racks.map((x) => x.id), [...f[0].racks].reverse().map((x) => x.id));
});

test("choosePDU reports failure when no single size fits", () => {
  const r = newRack("R1", 0, 0);
  r.u = 58;
  for (let i = 0; i < 5; i++) addDevice(r, "b300-air", lib);
  const ok = choosePDU(r, lib, DEFAULT_ELEC, 3);
  assert.equal(ok, false);
});

test("migrate: fills defaults, maps prototype `sld`, refuses newer schema", () => {
  const s = newScenario("x");
  const legacy = { name: "Old", scenarios: [{ ...s, electrical: undefined, sld: s.electrical, cool: { dtF: 20 } }], bg: { kind: "image", asset: "abc", scale: 1, x: 0, y: 0, rot: 0, opacity: 1, name: "a" } };
  const p = migrateProject(legacy);
  assert.equal(p.scenarios[0].electrical.nodes.length, s.electrical.nodes.length);
  assert.equal(p.scenarios[0].cool.dtF, 20);
  assert.equal(p.scenarios[0].cool.crahKW, 120);
  assert.equal(p.lib.length, DEF_LIB.length);
  assert.equal((p.bg as unknown as Record<string, unknown>).asset, undefined);
  assert.throws(() => migrateProject({ schemaVersion: 999, scenarios: [s] }), RacklineDocError);
  assert.throws(() => migrateProject({ foo: 1 }), RacklineDocError);
});

test("parseDXF: lines, polylines, circles, text and blocks", () => {
  const dxf = [
    "0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "6", "0", "ENDSEC",
    "0", "SECTION", "2", "BLOCKS",
    "0", "BLOCK", "2", "BOX", "10", "0", "20", "0",
    "0", "LINE", "10", "0", "20", "0", "11", "1", "21", "0",
    "0", "ENDBLK",
    "0", "ENDSEC",
    "0", "SECTION", "2", "ENTITIES",
    "0", "LINE", "10", "0", "20", "0", "11", "10", "21", "0",
    "0", "LWPOLYLINE", "70", "1", "10", "0", "20", "0", "10", "5", "20", "0", "10", "5", "20", "5",
    "0", "CIRCLE", "10", "2", "20", "2", "40", "1",
    "0", "TEXT", "10", "1", "20", "1", "40", "0.5", "1", "ROOM 101",
    "0", "INSERT", "2", "BOX", "10", "20", "20", "20",
    "0", "ENDSEC", "0", "EOF",
  ].join("\n");
  const d = parseDXF(dxf);
  assert.equal(d.insunits, 6);
  assert.equal(d.count, 4);
  assert.equal(d.texts[0].s, "ROOM 101");
  assert.deepEqual(d.bounds, [0, 0, 21, 20]);
});

test("sweep ranks generated layouts and caps the grid", () => {
  const rows = sweep({
    base: { nodes: 8, model: "b300-air", rackW: 0.6, hot: 1.2, cold: 1.2, net: true, red: "N+1" },
    grid: { perRack: [1, 2, 4], pattern: ["pod"], cooling: ["hac", "rdhx"] },
    lib: DEF_LIB, elec: DEFAULT_ELEC,
  });
  assert.equal(rows.length, 6);
  const firstFail = rows.findIndex((r) => r.fails > 0);
  if (firstFail >= 0) assert.ok(rows.slice(firstFail).every((r) => r.fails > 0), "passing designs rank first");
  assert.throws(() => sweep({
    base: { nodes: 8, model: "b300-air", rackW: 0.6, hot: 1.2, cold: 1.2, net: true, red: "N+1" },
    grid: { perRack: Array.from({ length: 50 }, (_, i) => i + 1), pattern: ["pod", "single"], cooling: ["hac", "rdhx"] },
    lib: DEF_LIB, elec: DEFAULT_ELEC,
  }), /too large/);
});
