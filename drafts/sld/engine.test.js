// node:test logic suite for the SLD connector engine — the must-pass regression
// gate for editable input/output connectors + breakered distribution (switchboard /
// RPP). Run: `node --test drafts/sld/*.test.js`
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const SLD = require("./engine.js");

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.golden.json"), "utf8"));

// helpers
const byName = (g, name) => g.nodes.find((n) => n.name === name) || g.busbars.find((b) => b.name === name);
const id = (g, name) => byName(g, name).id;
const edge = (g, fromName, toName) => g.edges.find((e) => e.from === id(g, fromName) && e.to === id(g, toName));
const MVBUS = "MAIN MV BUS · 13.8 kV";

// ── ports per card ───────────────────────────────────────────────────────────
test("ports: source is output-only, load is input-only, equipment is both", () => {
  assert.deepEqual(SLD.ports({ kind: "src" }), { input: false, output: true });
  assert.deepEqual(SLD.ports({ kind: "load" }), { input: true, output: false });
  assert.deepEqual(SLD.ports({ kind: "eq" }), { input: true, output: true });
});

test("ports: each seeded card type exposes the expected ports", () => {
  const g = SLD.seed();
  assert.deepEqual(SLD.ports(byName(g, "Utility feed 115 kV")), { input: false, output: true });
  assert.deepEqual(SLD.ports(byName(g, "GB300 rack 1")), { input: true, output: false });
  assert.deepEqual(SLD.ports(byName(g, "Transformer 1")), { input: true, output: true });
  assert.equal(SLD.hasInput(g, id(g, MVBUS)), true);
  assert.equal(SLD.hasOutput(g, id(g, MVBUS)), true);
});

// ── add (output → input) + every guard ──────────────────────────────────────
test("addEdge: happy path adds exactly one edge and stays valid", () => {
  const g = SLD.seed();
  const before = g.edges.length;
  const r = SLD.addEdge(g, id(g, "Transformer 1"), id(g, "UPS 2 (4N3)"));
  assert.equal(r.ok, true);
  assert.equal(r.graph.edges.length, before + 1);
  assert.equal(g.edges.length, before, "input graph is not mutated (pure)");
  assert.equal(SLD.validate(r.graph).ok, true);
});

test("addEdge guard: no self-connection", () => {
  const g = SLD.seed();
  const r = SLD.addEdge(g, id(g, "Transformer 1"), id(g, "Transformer 1"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /itself/);
  assert.equal(r.graph.edges.length, g.edges.length);
});

test("addEdge guard: no duplicate", () => {
  const g = SLD.seed();
  const r = SLD.addEdge(g, id(g, "RPP-A1"), id(g, "GB300 rack 1"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /already connected/);
});

test("addEdge guard: no immediate reverse", () => {
  const g = SLD.seed();
  // Transformer 1 → UPS 1 exists; UPS 1 → Transformer 1 must be refused
  const r = SLD.addEdge(g, id(g, "UPS 1 (4N3)"), id(g, "Transformer 1"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /reverse/);
});

test("addEdge guard: rejects a cycle", () => {
  const g = SLD.seed();
  // par → MV bus → Transformer 1 … exists; wiring Transformer 1 → par closes a loop
  const r = SLD.addEdge(g, id(g, "Transformer 1"), id(g, "Paralleling switchgear"));
  assert.equal(r.ok, false);
  assert.match(r.reason, /loop|acyclic/);
});

test("addEdge guard: port roles (a load has no output, a source has no input)", () => {
  const g = SLD.seed();
  assert.equal(SLD.addEdge(g, id(g, "GB300 rack 1"), id(g, "GB300 rack 2")).ok, false);
  assert.equal(SLD.addEdge(g, id(g, "Transformer 1"), id(g, "Utility feed 115 kV")).ok, false);
});

// ── delete ───────────────────────────────────────────────────────────────────
test("removeEdge: drops exactly the target edge, rest intact, no dangling refs", () => {
  const g = SLD.seed();
  const e = edge(g, "Transformer 1", "UPS 1 (4N3)");
  const r = SLD.removeEdge(g, e.id);
  assert.equal(r.ok, true);
  assert.equal(r.graph.edges.length, g.edges.length - 1);
  assert.equal(r.graph.edges.some((x) => x.id === e.id), false);
  const ids = new Set(r.graph.nodes.map((n) => n.id).concat(r.graph.busbars.map((b) => b.id)));
  assert.equal(r.graph.edges.every((x) => ids.has(x.from) && ids.has(x.to)), true);
});

test("removeEdge: unknown id is a no-op failure", () => {
  const g = SLD.seed();
  const r = SLD.removeEdge(g, "nope");
  assert.equal(r.ok, false);
  assert.equal(r.graph.edges.length, g.edges.length);
});

// ── move / re-route ──────────────────────────────────────────────────────────
test("moveEdge: re-route the 'to' endpoint changes only that end", () => {
  const g = SLD.seed();
  const e = edge(g, "Transformer 1", "UPS 1 (4N3)");
  const r = SLD.moveEdge(g, e.id, "to", id(g, "UPS 2 (4N3)"));
  assert.equal(r.ok, true);
  const moved = r.graph.edges.find((x) => x.id === e.id);
  assert.equal(moved.from, e.from, "from endpoint unchanged");
  assert.equal(moved.to, id(g, "UPS 2 (4N3)"), "to endpoint re-routed");
  assert.equal(SLD.validate(r.graph).ok, true);
});

test("moveEdge: re-route the 'from' endpoint", () => {
  const g = SLD.seed();
  const e = edge(g, "Transformer 1", "UPS 1 (4N3)");
  const r = SLD.moveEdge(g, e.id, "from", id(g, "Transformer 2"));
  assert.equal(r.ok, true);
  const moved = r.graph.edges.find((x) => x.id === e.id);
  assert.equal(moved.from, id(g, "Transformer 2"));
  assert.equal(moved.to, e.to);
});

test("moveEdge: a re-route that would create a cycle is rejected unchanged", () => {
  const g = SLD.seed();
  const e = edge(g, "Paralleling switchgear", MVBUS);
  const r = SLD.moveEdge(g, e.id, "to", id(g, "Utility feed 115 kV"));
  assert.equal(r.ok, false);
  assert.deepEqual(r.graph, g, "graph returned unchanged on rejected re-route");
});

// ── hit-testing ──────────────────────────────────────────────────────────────
test("hitTestPort: finds the output/input of a plain card and null off-target", () => {
  const g = SLD.seed();
  const tx = byName(g, "Transformer 1");
  const gg = SLD.geo(tx);
  assert.deepEqual(SLD.hitTestPort(g, gg.cx, gg.bot), { id: tx.id, port: "output" });
  assert.deepEqual(SLD.hitTestPort(g, gg.cx, gg.top), { id: tx.id, port: "input" });
  assert.equal(SLD.hitTestPort(g, -500, -500), null);
});

test("hitTestPort: a breakered card returns the specific breaker tap", () => {
  const g = SLD.seed();
  const sw = byName(g, "SWBD-A");
  const taps = SLD.outTaps(sw);
  const t = taps[2];
  assert.deepEqual(SLD.hitTestPort(g, t.x, t.y), { id: sw.id, port: "output", breaker: t.breaker });
});

test("hitTestWireEnd: grabs the nearest wire endpoint", () => {
  const g = SLD.seed();
  const e = edge(g, "Transformer 1", "UPS 1 (4N3)");
  const ep = SLD.edgeEndpoints(g, e);
  const hit = SLD.hitTestWireEnd(g, ep.to.x, ep.to.y);
  assert.equal(hit.edgeId, e.id);
  assert.equal(hit.end, "to");
});

// ── breakered distribution: switchboard / RPP ────────────────────────────────
test("breakered: switchboard exposes one output tap per feeder breaker", () => {
  const g = SLD.seed();
  const sw = byName(g, "SWBD-A");
  assert.equal(sw.breakers.length, 8);
  assert.equal(SLD.outTaps(sw).length, sw.breakers.length);
  assert.equal(SLD.outTaps(byName(g, "RPP-A1")).length, 4);
});

test("addEdge: a feeder breaker feeds at most one circuit", () => {
  const g = SLD.seed();
  const sw = byName(g, "SWBD-A"); // b8 is the spare feeder in the seed
  const r1 = SLD.addEdge(g, sw.id, id(g, "GB300 rack 1"), { fromBreaker: "b8" });
  assert.equal(r1.ok, true);
  assert.ok(r1.graph.edges.find((x) => x.from === sw.id && x.fromBreaker === "b8"));
  const r2 = SLD.addEdge(r1.graph, sw.id, id(g, "GB300 rack 2"), { fromBreaker: "b8" });
  assert.equal(r2.ok, false);
  assert.match(r2.reason, /already feeds/);
});

test("addEdge: an unknown breaker id is rejected", () => {
  const g = SLD.seed();
  const r = SLD.addEdge(g, id(g, "SWBD-A"), id(g, "GB300 rack 1"), { fromBreaker: "zzz" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /breaker not found/);
});

test("removeBreaker: removes the breaker and cascades its feeder edge", () => {
  const g = SLD.seed();
  const sw = byName(g, "SWBD-A"); // b1 → RPP-A1
  const before = g.edges.length;
  const r = SLD.removeBreaker(g, sw.id, "b1");
  assert.equal(r.ok, true);
  assert.equal(r.graph.nodes.find((n) => n.id === sw.id).breakers.some((b) => b.id === "b1"), false);
  assert.equal(r.graph.edges.some((e) => e.from === sw.id && e.fromBreaker === "b1"), false);
  assert.equal(r.graph.edges.length, before - 1);
  assert.equal(SLD.validate(r.graph).ok, true);
});

test("setBreaker: updates a breaker field", () => {
  const g = SLD.seed();
  const sw = byName(g, "SWBD-A");
  const r = SLD.setBreaker(g, sw.id, "b1", "status", "open");
  assert.equal(r.ok, true);
  assert.equal(r.graph.nodes.find((n) => n.id === sw.id).breakers.find((b) => b.id === "b1").status, "open");
});

test("moveEdge: re-route 'from' onto another breaker binds it", () => {
  const g = SLD.seed();
  const swA = byName(g, "SWBD-A"), swB = byName(g, "SWBD-B");
  const e = g.edges.find((x) => x.from === swA.id && x.fromBreaker === "b1"); // SWBD-A b1 → RPP-A1 (SWBD-B doesn't feed RPP-A1)
  const r = SLD.moveEdge(g, e.id, "from", swB.id, { fromBreaker: "b8" }); // SWBD-B b8 is spare
  assert.equal(r.ok, true);
  const m = r.graph.edges.find((x) => x.id === e.id);
  assert.equal(m.from, swB.id);
  assert.equal(m.fromBreaker, "b8");
  assert.equal(SLD.validate(r.graph).ok, true);
});

test("validate: catches a dangling breaker reference and a double-used breaker", () => {
  const g = SLD.seed();
  const sw = byName(g, "SWBD-A");
  const g1 = JSON.parse(JSON.stringify(g));
  g1.edges.find((e) => e.from === sw.id && e.fromBreaker === "b1").fromBreaker = "zzz";
  assert.equal(SLD.validate(g1).ok, false);
  const g2 = JSON.parse(JSON.stringify(g));
  g2.edges.push({ id: "eX", from: sw.id, to: id(g, "GB300 rack 1"), fromBreaker: "b1" }); // b1 already feeds RPP-A1
  assert.equal(SLD.validate(g2).ok, false);
});

// ── seed golden + structural guarantees ──────────────────────────────────────
test("seed golden: matches the checked-in snapshot (topology unchanged)", () => {
  assert.deepEqual(SLD.seed(), golden);
});

test("seed: valid, acyclic, every load fed, 8 GB300 racks, 4-to-make-3 UPS + 2N RPP", () => {
  const g = SLD.seed();
  assert.equal(SLD.validate(g).ok, true);
  assert.equal(SLD.hasCycleAll(g), false);
  assert.equal(g.nodes.filter((n) => n.type === "rack").length, 8);
  assert.equal(g.nodes.filter((n) => n.type === "ups").length, 4, "4-to-make-3 UPS layer");
  assert.equal(g.nodes.filter((n) => n.type === "switchboard").length, 2);
  assert.equal(g.nodes.filter((n) => n.type === "rpp").length, 4);
  // every rack is dual-corded (an A-side and a B-side RPP feeder)
  for (const rk of g.nodes.filter((n) => n.type === "rack")) {
    assert.ok(g.edges.filter((e) => e.to === rk.id).length >= 2, `${rk.name} dual-fed`);
  }
  for (const s of g.nodes.filter((n) => n.kind === "src")) {
    assert.equal(g.edges.some((e) => e.to === s.id), false);
    assert.equal(g.edges.some((e) => e.from === s.id), true);
  }
});

// ── serialization round-trip ─────────────────────────────────────────────────
test("round-trip: restore(snap(g)) deep-equals g", () => {
  const g = SLD.seed();
  assert.deepEqual(SLD.restore(SLD.snap(g)), g);
});

// ── lightweight deterministic fuzz: invariants always hold ───────────────────
test("fuzz: a long random sequence of ops never corrupts the graph", () => {
  let s = 0x9e3779b9;
  const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  let g = SLD.seed();
  for (let i = 0; i < 600; i++) {
    const allIds = g.nodes.map((n) => n.id).concat(g.busbars.map((b) => b.id));
    const op = rnd();
    let r;
    if (op < 0.4) r = SLD.addEdge(g, pick(allIds), pick(allIds));
    else if (op < 0.62 && g.edges.length) r = SLD.removeEdge(g, pick(g.edges).id);
    else if (op < 0.82 && g.edges.length) r = SLD.moveEdge(g, pick(g.edges).id, rnd() < 0.5 ? "from" : "to", pick(allIds));
    else r = SLD.addNode(g, pick(Object.keys(SLD.PAL)), Math.floor(rnd() * 1400), Math.floor(rnd() * 800));
    if (r.ok) {
      g = r.graph;
      const structural = SLD.validate(g).errors.filter((e) => !/has no feeder/.test(e));
      assert.deepEqual(structural, [], "no dangling/dup/cycle/role/breaker errors after op " + i);
    } else {
      assert.equal(r.graph, g, "rejected op left the graph reference unchanged");
    }
  }
});
