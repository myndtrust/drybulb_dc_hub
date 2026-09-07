// node:test logic suite for the typed single-line engine (lib/factory/sld.ts).
// Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as SLD from "./sld";
import type { SldGraph, SldNode } from "./sld";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(join(here, "sld.seed.golden.json"), "utf8"));

const byName = (g: SldGraph, name: string) =>
  g.nodes.find((n) => n.name === name) || g.busbars.find((b) => b.name === name)!;
const id = (g: SldGraph, name: string) => byName(g, name).id;
const edge = (g: SldGraph, fromName: string, toName: string) =>
  g.edges.find((e) => e.from === id(g, fromName) && e.to === id(g, toName))!;
const MVSWBD = "MV SWBD-A · 13.8 kV";

test("ports: source out-only, load in-only, equipment both", () => {
  assert.deepEqual(SLD.ports({ kind: "src" }), { input: false, output: true });
  assert.deepEqual(SLD.ports({ kind: "load" }), { input: true, output: false });
  assert.deepEqual(SLD.ports({ kind: "eq" }), { input: true, output: true });
});

test("ports: seeded card types expose expected ports", () => {
  const g = SLD.seed();
  assert.deepEqual(SLD.ports(byName(g, "Utility feed 230 kV") as any), { input: false, output: true });
  assert.deepEqual(SLD.ports(byName(g, "GB300 rack 1") as any), { input: true, output: false });
  assert.deepEqual(SLD.ports(byName(g, "Transformer 1") as any), { input: true, output: true });
  assert.equal(SLD.hasInput(g, id(g, MVSWBD)), true);
  assert.equal(SLD.hasOutput(g, id(g, MVSWBD)), true);
});

test("addEdge: happy path adds one edge, stays valid, input unmutated", () => {
  const g = SLD.seed();
  const before = g.edges.length;
  const r = SLD.addEdge(g, id(g, "Transformer 1"), id(g, "UPS 2 (4N3)"));
  assert.equal(r.ok, true);
  assert.equal(r.graph.edges.length, before + 1);
  assert.equal(g.edges.length, before);
  assert.equal(SLD.validate(r.graph).ok, true);
});

test("addEdge guards: self / duplicate / reverse / cycle / roles", () => {
  const g = SLD.seed();
  assert.match(SLD.addEdge(g, id(g, "Transformer 1"), id(g, "Transformer 1")).reason!, /itself/);
  // RPP-A1 b1 already feeds rack 1 → same circuit is a duplicate
  assert.match(SLD.addEdge(g, id(g, "RPP-A1"), id(g, "GB300 rack 1"), { fromBreaker: "b1" }).reason!, /already connected/);
  // SWBD-A → UPS 1 is a direct edge (the transfer switchboard's breaker feed); its
  // exact reverse is caught before the general cycle check.
  assert.match(SLD.addEdge(g, id(g, "UPS 1 (4N3)"), id(g, "SWBD-A")).reason!, /reverse/);
  // multi-hop cycle: UPS 1 is downstream of MV SWBD-A (MV-A → Tx1 → SWBD-A → UPS 1)
  assert.match(SLD.addEdge(g, id(g, "UPS 1 (4N3)"), id(g, "MV SWBD-A · 13.8 kV")).reason!, /loop|acyclic/);
  assert.equal(SLD.addEdge(g, id(g, "GB300 rack 1"), id(g, "GB300 rack 2")).ok, false);
  assert.equal(SLD.addEdge(g, id(g, "Transformer 1"), id(g, "Utility feed 230 kV")).ok, false);
});

test("removeEdge: drops exactly one, no dangling refs; unknown is no-op", () => {
  const g = SLD.seed();
  const e = edge(g, "SWBD-A", "UPS 1 (4N3)");
  const r = SLD.removeEdge(g, e.id);
  assert.equal(r.ok, true);
  assert.equal(r.graph.edges.length, g.edges.length - 1);
  const ids = new Set(r.graph.nodes.map((n) => n.id).concat(r.graph.busbars.map((b) => b.id)));
  assert.ok(r.graph.edges.every((x) => ids.has(x.from) && ids.has(x.to)));
  assert.equal(SLD.removeEdge(g, "nope").ok, false);
});

test("moveEdge: re-route 'to' and 'from'; cycle re-route rejected unchanged", () => {
  const g = SLD.seed();
  const e = edge(g, "Transformer 1", "Normal bus A");
  const rt = SLD.moveEdge(g, e.id, "to", id(g, "Normal bus B"));
  assert.equal(rt.ok, true);
  assert.equal(rt.graph.edges.find((x) => x.id === e.id)!.to, id(g, "Normal bus B"));
  // "Transformer 2" already feeds Normal bus A too, so re-targeting there would
  // collide; "Main transformer A" doesn't, and re-routing a plain (non-breakered)
  // edge's source has no restriction against an already-used output.
  const rf = SLD.moveEdge(g, e.id, "from", id(g, "Main transformer A"));
  assert.equal(rf.ok, true);
  assert.equal(rf.graph.edges.find((x) => x.id === e.id)!.from, id(g, "Main transformer A"));
  const e2 = edge(g, "Main transformer A", MVSWBD);
  const bad = SLD.moveEdge(g, e2.id, "to", id(g, "Utility feed 230 kV"));
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.graph, g);
});

test("hit-testing: ports, breaker taps, wire ends", () => {
  const g = SLD.seed();
  const tx = byName(g, "Transformer 1") as any;
  const gg = SLD.geo(tx);
  assert.deepEqual(SLD.hitTestPort(g, gg.cx, gg.bot), { id: tx.id, port: "output" });
  assert.deepEqual(SLD.hitTestPort(g, gg.cx, gg.top), { id: tx.id, port: "input" });
  assert.equal(SLD.hitTestPort(g, -500, -500), null);
  const sw = byName(g, "SWBD-A") as any;
  const t = SLD.outTaps(sw)[2];
  assert.deepEqual(SLD.hitTestPort(g, t.x, t.y), { id: sw.id, port: "output", breaker: t.breaker });
  // Single-feed edge, so its "to" endpoint is unambiguous. Everything past the
  // main transformers has (deliberately) more than one source landing on the
  // same input point — MV SWBD-A (transformer + BESS), MV SWBD-B (transformer +
  // MV tie), UPS 1 (unit-sub transformer + generator paralleling board) — and
  // hit-testing at a shared point is a valid grab for either wire.
  const e = edge(g, "Utility feed 230 kV", "Main transformer A");
  const ep = SLD.edgeEndpoints(g, e)!;
  assert.deepEqual(SLD.hitTestWireEnd(g, ep.to.x, ep.to.y), { edgeId: e.id, end: "to" });
});

test("breakered: switchboard/RPP expose one tap per breaker", () => {
  const g = SLD.seed();
  const sw = byName(g, "SWBD-A") as any;
  assert.equal(sw.breakers.length, 8);
  assert.equal(SLD.outTaps(sw).length, 8);
  assert.equal(SLD.outTaps(byName(g, "RPP-A1") as any).length, 4);
});

test("breaker: single-use feed, unknown breaker, removeBreaker cascade, setBreaker", () => {
  const g = SLD.seed();
  const swId = id(g, "SWBD-A");
  const r1 = SLD.addEdge(g, swId, id(g, "GB300 rack 1"), { fromBreaker: "b8" });
  assert.equal(r1.ok, true);
  assert.match(SLD.addEdge(r1.graph, swId, id(g, "GB300 rack 2"), { fromBreaker: "b8" }).reason!, /already feeds/);
  assert.match(SLD.addEdge(g, swId, id(g, "GB300 rack 1"), { fromBreaker: "zzz" }).reason!, /breaker not found/);
  const rm = SLD.removeBreaker(g, swId, "b1");
  assert.equal(rm.ok, true);
  assert.equal(rm.graph.edges.some((e) => e.from === swId && e.fromBreaker === "b1"), false);
  assert.equal(SLD.validate(rm.graph).ok, true);
  const sb = SLD.setBreaker(g, swId, "b1", "status", "open");
  assert.equal(SLD.findNode(sb.graph, swId)!.breakers!.find((b) => b.id === "b1")!.status, "open");
});

test("moveEdge: re-route 'from' onto a breaker binds it", () => {
  const g = SLD.seed();
  const swA = id(g, "SWBD-A"), swB = id(g, "SWBD-B");
  const e = g.edges.find((x) => x.from === swA && x.fromBreaker === "b1")!; // SWBD-A b1 → RPP-A1
  const r = SLD.moveEdge(g, e.id, "from", swB, { fromBreaker: "b8" });
  assert.equal(r.ok, true);
  const m = r.graph.edges.find((x) => x.id === e.id)!;
  assert.equal(m.from, swB);
  assert.equal(m.fromBreaker, "b8");
  assert.equal(SLD.validate(r.graph).ok, true);
});

test("validate: dangling breaker ref and double-used breaker", () => {
  const g = SLD.seed();
  const swId = id(g, "SWBD-A");
  const g1: SldGraph = JSON.parse(JSON.stringify(g));
  g1.edges.find((e) => e.from === swId && e.fromBreaker === "b1")!.fromBreaker = "zzz";
  assert.equal(SLD.validate(g1).ok, false);
  const g2: SldGraph = JSON.parse(JSON.stringify(g));
  g2.edges.push({ id: "eX", from: swId, to: id(g, "GB300 rack 1"), fromBreaker: "b1" });
  assert.equal(SLD.validate(g2).ok, false);
});

test("multi-feeder: a rack accepts many connections (GB300 = 8 whips) via different breakers", () => {
  let g = SLD.seed();
  const rackId = g.nodes.find((n) => n.type === "rack")!.id;
  const add = SLD.addNode(g, "switchboard", 100, 820); g = add.graph; const swId = add.id!; // fresh: 8 free breakers
  // wire 8 distinct switchboard breakers → the same rack
  let made = 0;
  for (const b of SLD.findNode(g, swId)!.breakers!) {
    const r = SLD.addEdge(g, swId, rackId, { fromBreaker: b.id });
    if (r.ok) { g = r.graph; made++; }
  }
  assert.equal(made, 8, "8 whip connections accepted");
  assert.ok(g.edges.filter((e) => e.from === swId && e.to === rackId).length === 8);
  // the same source+breaker again is rejected as a duplicate circuit
  const dup = SLD.addEdge(g, swId, rackId, { fromBreaker: "b1" });
  assert.equal(dup.ok, false);
  assert.match(dup.reason!, /already connected|already feeds/);
  assert.equal(SLD.validate(g).ok, true);
});

test("duplicateNode: copies a card (with breakers) and a bus as fresh instances", () => {
  const g = SLD.seed();
  const swId = g.nodes.find((n) => n.type === "switchboard")!.id;
  const r = SLD.duplicateNode(g, swId);
  assert.equal(r.ok, true);
  assert.notEqual(r.id, swId);
  const copy = SLD.findNode(r.graph, r.id!)!;
  const src = SLD.findNode(g, swId)!;
  assert.equal(copy.type, "switchboard");
  assert.match(copy.name, /copy/);
  assert.equal(copy.breakers!.length, src.breakers!.length);
  assert.equal(r.graph.nodes.length, g.nodes.length + 1);
  assert.equal(r.graph.edges.length, g.edges.length, "copy is unconnected");
  // deep-independent breakers
  copy.breakers![0].amp = 9999;
  assert.notEqual(src.breakers![0].amp, 9999);
  // a bus duplicates too (seed has none → add one first)
  const ab = SLD.addBus(g, 100, 100, "BUS");
  const rb = SLD.duplicateNode(ab.graph, ab.id!);
  assert.equal(rb.graph.busbars.length, ab.graph.busbars.length + 1);
});

test("bus: addBus and addNode behave purely", () => {
  const g = SLD.seed();
  const rb = SLD.addBus(g, 100, 100, "BUS");
  assert.equal(rb.graph.busbars.length, g.busbars.length + 1);
  assert.equal(g.busbars.length, 0);
  const rn = SLD.addNode(g, "switchboard", 50, 50);
  assert.equal(rn.graph.nodes.length, g.nodes.length + 1);
  assert.equal(SLD.findNode(rn.graph, rn.id!)!.breakers!.length, 8);
});

test("seed golden: matches checked-in snapshot", () => {
  assert.deepEqual(SLD.seed(), golden);
});

test("seed: valid, acyclic, 8 racks, 4 UPS + 8 SWBD + 4 RPP, dual-corded", () => {
  const g = SLD.seed();
  assert.equal(SLD.validate(g).ok, true);
  assert.equal(SLD.hasCycleAll(g), false);
  assert.equal(g.nodes.filter((n) => n.type === "rack").length, 8);
  assert.equal(g.nodes.filter((n) => n.type === "ups").length, 4);
  assert.equal(g.nodes.filter((n) => n.type === "switchboard").length, 8); // MV-A/B + Normal bus A/B + SWBD-A/B (transfer) + LV SWBD-A/B
  assert.equal(g.nodes.filter((n) => n.type === "bess").length, 1); // BESS at the interconnection
  assert.equal(g.nodes.filter((n) => n.type === "rpp").length, 4);
  for (const rk of g.nodes.filter((n) => n.type === "rack")) {
    assert.ok(g.edges.filter((e) => e.to === rk.id).length >= 2);
  }
});

test("round-trip: restore(snap(g)) deep-equals g", () => {
  const g = SLD.seed();
  assert.deepEqual(SLD.restore(SLD.snap(g)), g);
});

test("fuzz: random ops never corrupt structural invariants", () => {
  let s = 0x9e3779b9;
  const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  let g = SLD.seed();
  for (let i = 0; i < 500; i++) {
    const ids = g.nodes.map((n) => n.id).concat(g.busbars.map((b) => b.id));
    const op = rnd();
    let r: SLD.OpResult;
    if (op < 0.4) r = SLD.addEdge(g, pick(ids), pick(ids));
    else if (op < 0.62 && g.edges.length) r = SLD.removeEdge(g, pick(g.edges).id);
    else if (op < 0.82 && g.edges.length) r = SLD.moveEdge(g, pick(g.edges).id, rnd() < 0.5 ? "from" : "to", pick(ids));
    else r = SLD.addNode(g, pick(Object.keys(SLD.PAL)), Math.floor(rnd() * 1400), Math.floor(rnd() * 800));
    if (r.ok) {
      g = r.graph;
      // "has no feeder" and "transfer board has N incomers" are both design-
      // completeness checks a low-level edit can transiently violate (delete one
      // of a transfer board's two incomer wires, same as unwiring a load) —
      // tolerated here the same way, not treated as graph corruption.
      const structural = SLD.validate(g).errors.filter((e) => !/has no feeder/.test(e) && !/transfer board has/.test(e));
      assert.deepEqual(structural, [], "no structural errors after op " + i);
    } else {
      assert.equal(r.graph, g);
    }
  }
});

test("diversity flag suppresses the capacity warning without discarding the rating", () => {
  const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0 };
  const board = SLD.mkNode("n1", "switchboard", "Lineup", 0, 0, { mainAmp: 2500 });
  board.breakers = [
    { id: "b1", label: "F1", amp: 1200, poles: 3, status: "closed" },
    { id: "b2", label: "F2", amp: 1200, poles: 3, status: "closed" },
    { id: "b3", label: "F3", amp: 1200, poles: 3, status: "closed" },
  ];
  const l1 = SLD.mkNode("n2", "rack", "L1", 0, 0);
  const l2 = SLD.mkNode("n3", "rack", "L2", 0, 0);
  const l3 = SLD.mkNode("n4", "rack", "L3", 0, 0);
  g.nodes.push(board, l1, l2, l3);
  g.edges.push(
    { id: "e1", from: "n1", to: "n2", fromBreaker: "b1" },
    { id: "e2", from: "n1", to: "n3", fromBreaker: "b2" },
    { id: "e3", from: "n1", to: "n4", fromBreaker: "b3" },
  );
  assert.equal(SLD.validate(g).warnings.filter((w) => /over-subscribed/.test(w)).length, 1,
    "3600 A of trips on a 2500 A main warns by default");
  board.diversity = true;
  assert.deepEqual(SLD.validate(g).warnings, [], "flagged diversity-fed, it does not");
  assert.equal(board.mainAmp, 2500, "the sourced rating is still there");
  assert.equal(SLD.aggregateRatingA(g, "n1"), 2500, "and still readable");
});

test("transferSource: universal (not architecture-gated) — exactly two incomers required", () => {
  const mk = (id: string, type: string, name: string, extra?: Partial<SldNode>) => SLD.mkNode(id, type, name, 0, 0, extra);
  const build = (incomerCount: 1 | 2 | 3) => {
    const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0 }; // no architecture tag
    const xfer = mk("n1", "switchboard", "SWBD-A", { transferSource: true });
    const tx = mk("n2", "transformer", "Transformer 1");
    const gen = mk("n3", "genset", "Generator");
    const ups = mk("n4", "ups", "UPS 1");
    g.nodes.push(xfer, tx, gen, ups);
    g.edges.push({ id: "e1", from: "n2", to: "n1" }); // transformer -> transfer board
    if (incomerCount >= 2) g.edges.push({ id: "e2", from: "n3", to: "n1" }); // + generator
    if (incomerCount >= 3) {
      const stray = mk("n5", "bess", "Stray source"); g.nodes.push(stray);
      g.edges.push({ id: "e3", from: "n5", to: "n1" }); // a third, illegitimate incomer
    }
    g.edges.push({ id: "e4", from: "n1", to: "n4", fromBreaker: xfer.breakers![0].id });
    return g;
  };
  assert.match(SLD.validate(build(1)).errors.join(";"), /SWBD-A: transfer board has 1 incomer/);
  assert.deepEqual(SLD.validate(build(2)).errors, []);
  assert.match(SLD.validate(build(3)).errors.join(";"), /SWBD-A: transfer board has 3 incomers/);
  // untagged (no transferSource) boards are never held to this rule
  const untagged = build(1); untagged.nodes[0].transferSource = false;
  assert.deepEqual(SLD.validate(untagged).errors, []);
});
