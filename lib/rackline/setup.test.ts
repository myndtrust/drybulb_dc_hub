// node:test for setup records and the automatic helpers (lib/rackline/setup.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { analyze } from "./analysis";
import { DEF_LIB } from "./constants";
import { migrateProject } from "./migrate";
import { DEFAULT_ELEC, blankProject, libIndex, newRack } from "./model";
import { buildNvl72Pod, defaultNvl72Options, ensureNvl72Lib } from "./nvl72";
import { addCoolers, autoFeed, editedSinceSetup, makeSetup, unfedRacks } from "./setup";

const pod = () => {
  const items = DEF_LIB.map((x) => ({ ...x, ports: { ...x.ports } }));
  ensureNvl72Lib(items);
  const res = buildNvl72Pod({ ...defaultNvl72Options(), racks: 4 }, items, DEFAULT_ELEC);
  return { items, lib: libIndex(items), res, s: res.scenario };
};

test("setup: a built scenario is 'as built' until edited, and survives a save round trip", () => {
  const { s } = pod();
  s.setup = makeSetup("nvl72", { racks: 4 }, s);
  assert.equal(editedSinceSetup(s), false);
  s.name = "Renamed"; // the name isn't part of the build
  assert.equal(editedSinceSetup(s), false);
  s.racks[0].x += 0.6;
  assert.equal(editedSinceSetup(s), true);
  const p = blankProject("x");
  p.scenarios = [s]; p.active = s.id;
  const back = migrateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(back.scenarios[0].setup?.kind, "nvl72");
  assert.deepEqual(back.scenarios[0].setup?.options, { racks: 4 });
});

test("setup: a hand-placed rack is flagged unfed, and autoFeed copies the nearest rack's feeds", () => {
  const { s, lib, res } = pod();
  const r = newRack("R199", s.racks[0].x + 0.6, s.racks[0].y);
  r.devs.push({ id: "d1", lib: "gb300-nvl72", u: 1, map: [] });
  s.racks.push(r);
  const an = analyze(s, { lib, elec: res.elec });
  assert.ok(an.warns.some((w) => w.msg.startsWith("R199: no A feed")), "default rppa/rppb don't exist in a generated single line");
  const itOf = (x: typeof r) => an.racks.find((q) => q.r.id === x.id)!.it;
  assert.deepEqual(unfedRacks(s, itOf).map((x) => x.name), ["R199"]);
  const src = autoFeed(s, r)!;
  assert.equal(src.role, "compute");
  assert.equal(r.feedA, src.feedA);
  assert.equal(r.feedB, src.feedB);
  assert.equal(unfedRacks(s, itOf).length, 0);
});

test("setup: addCoolers places units after the last one of the kind", () => {
  const { s } = pod();
  const cdus = s.coolers.filter((c) => c.kind === "cdu");
  const last = cdus[cdus.length - 1];
  const added = addCoolers(s, "cdu", 2, 0.6, 1.2, 1350);
  assert.equal(added.length, 2);
  assert.equal(added[0].x, last.x + last.w);
  assert.equal(added[1].name, `CDU-${cdus.length + 2}`);
  assert.equal(s.coolers.filter((c) => c.kind === "cdu").length, cdus.length + 2);
});

test("setup: generator rules are editable options", () => {
  const items = DEF_LIB.map((x) => ({ ...x, ports: { ...x.ports } }));
  ensureNvl72Lib(items);
  const a = buildNvl72Pod({ ...defaultNvl72Options(), racks: 8, netRackKW: 10 }, items, DEFAULT_ELEC);
  const b = buildNvl72Pod({ ...defaultNvl72Options(), racks: 8 }, items, DEFAULT_ELEC);
  assert.ok(a.scenario.racks.filter((r) => r.role === "network").length > b.scenario.racks.filter((r) => r.role === "network").length);
  const c = buildNvl72Pod({ ...defaultNvl72Options(), racks: 8, fabricAttach: "nearest", uplink: 0.5 }, items, DEFAULT_ELEC);
  const fab = c.scenario.nets!.find((n) => n.id === "net-fabric")!;
  assert.equal(fab.attach, "nearest");
  assert.equal(fab.uplink, 0.5);
  const d = buildNvl72Pod({ ...defaultNvl72Options(), racks: 8, sizeDucts: false }, items, DEFAULT_ELEC);
  assert.ok(d.scenario.trays.filter((t) => t.kind === "fiber").every((t) => t.wmm === 600 && t.dmm === 150));
});
