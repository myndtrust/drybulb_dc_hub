// node:test for change-by-change review (lib/rackline/changes.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { applyChanges, diffChanges, sameDesign } from "./changes";
import { DEF_LIB } from "./constants";
import { DEFAULT_ELEC, clone, newRack, newScenario } from "./model";
import type { RacklineProject } from "./types";

function base(): RacklineProject {
  const s = newScenario("A");
  s.racks = [newRack("R1", 0, 0), newRack("R2", 1, 0), newRack("R3", 2, 0)];
  return { schemaVersion: 1, name: "Owner's name", units: "ft", lib: DEF_LIB, elec: DEFAULT_ELEC, bg: null, scenarios: [s], active: s.id };
}

test("changes: each edited item is its own change; the name never is", () => {
  const b = base();
  const p = clone(b);
  p.name = "Editor renamed it";
  p.scenarios[0].racks[0].x = 5;                 // R1 moved
  p.scenarios[0].racks.splice(1, 1);             // R2 removed
  p.scenarios[0].racks.push(newRack("R4", 3, 0)); // R4 added
  const ch = diffChanges(b, p, b);
  assert.deepEqual(ch.map((c) => c.kind).sort(), ["added", "changed", "removed"]);
  assert.ok(ch.find((c) => c.kind === "changed")!.label.includes("moved"));
  assert.ok(ch.every((c) => !c.conflict && !c.blocked));
});

test("changes: applying a subset leaves the rest of the owner's version alone", () => {
  const b = base();
  const p = clone(b);
  p.scenarios[0].racks[0].x = 5;
  p.scenarios[0].racks[2].x = 9;
  const cur = clone(b);
  cur.name = "Owner renamed later";
  cur.scenarios[0].racks[1].x = 7; // the owner's own edit since
  const ch = diffChanges(b, p, cur);
  assert.equal(ch.length, 2);
  const r1 = ch.find((c) => c.label.includes("R1"))!;
  const out = applyChanges(b, p, cur, [r1.key]);
  assert.equal(out.name, "Owner renamed later");
  assert.equal(out.scenarios[0].racks[0].x, 5);   // accepted
  assert.equal(out.scenarios[0].racks[1].x, 7);   // owner's edit kept
  assert.equal(out.scenarios[0].racks[2].x, 2);   // declined
});

test("changes: conflicts are flagged, applied changes disappear", () => {
  const b = base();
  const p = clone(b);
  p.scenarios[0].racks[0].x = 5;
  const cur = clone(b);
  cur.scenarios[0].racks[0].x = 6;
  assert.equal(diffChanges(b, p, cur)[0].conflict, true);
  const after = applyChanges(b, p, cur, diffChanges(b, p, cur).map((c) => c.key));
  assert.equal(diffChanges(b, p, after).length, 0);
  assert.ok(sameDesign(after, p));
});

test("changes: a new scenario is one change, not one per rack", () => {
  const b = base();
  const p = clone(b);
  const s = newScenario("B");
  s.racks = [newRack("X1", 0, 0), newRack("X2", 1, 0)];
  p.scenarios.push(s);
  const ch = diffChanges(b, p, b);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].kind, "added");
  assert.equal(applyChanges(b, p, b, [ch[0].key]).scenarios.length, 2);
});

test("changes: edits inside a scenario the owner deleted are blocked", () => {
  const b = base();
  b.scenarios.push(newScenario("B"));
  const p = clone(b);
  p.scenarios[1].racks.push(newRack("Y1", 0, 0));
  const cur = clone(b);
  cur.scenarios.splice(1, 1);
  const ch = diffChanges(b, p, cur);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].blocked, true);
});
