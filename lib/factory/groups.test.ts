// node:test for the logical-group engine ops (no network — the Supabase lib is
// type-checked only). Run: node --test --import tsx lib/factory/*.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  seed, addNode, createGroup, removeGroup, moveGroup, groupBounds, groupOfNode,
  extractGroup, instantiateGroup, duplicateGroup, removeNode, findNode, snap, restore, type SldGraph,
} from "./sld";

function twoRackGraph() {
  let g = seed();
  const ids = g.nodes.filter((n) => n.type === "rack").slice(0, 2).map((n) => n.id);
  return { g, ids };
}

test("createGroup: tags members, new id; removeGroup keeps members", () => {
  const { g, ids } = twoRackGraph();
  const r = createGroup(g, ids, "Pod A");
  assert.equal(r.ok, true);
  const gr = r.graph.groups!.find((x) => x.id === r.id)!;
  assert.deepEqual(gr.members, ids);
  assert.equal(gr.name, "Pod A");
  assert.equal(groupOfNode(r.graph, ids[0])!.id, r.id);
  const rm = removeGroup(r.graph, r.id!);
  assert.equal((rm.graph.groups || []).length, 0);
  assert.ok(findNode(rm.graph, ids[0]), "member node still present after ungroup");
});

test("moveGroup: offsets every member and nothing else", () => {
  const { g, ids } = twoRackGraph();
  const gg = createGroup(g, ids, "P").graph;
  const gid = gg.groups![0].id;
  const before = ids.map((id) => ({ id, x: findNode(gg, id)!.x, y: findNode(gg, id)!.y }));
  const otherId = gg.nodes.find((n) => !ids.includes(n.id))!.id;
  const ox = findNode(gg, otherId)!.x;
  const moved = moveGroup(gg, gid, 50, -20).graph;
  for (const b of before) { assert.equal(findNode(moved, b.id)!.x, b.x + 50); assert.equal(findNode(moved, b.id)!.y, b.y - 20); }
  assert.equal(findNode(moved, otherId)!.x, ox, "non-member unchanged");
});

test("groupBounds covers members", () => {
  const { g, ids } = twoRackGraph();
  const gg = createGroup(g, ids, "P").graph;
  const b = groupBounds(gg, gg.groups![0]);
  assert.ok(b.w > 0 && b.h > 0);
});

test("extract + instantiate: clone subgraph with fresh ids, internal edges only", () => {
  // build a tiny group: a switchboard feeding a rack (internal edge) + an external feed
  let g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0 };
  const sw = addNode(g, "switchboard", 0, 0); g = sw.graph;
  const rk = addNode(g, "rack", 0, 200); g = rk.graph;
  const ext = addNode(g, "utility", -200, -200); g = ext.graph;
  g.uid++; g.edges.push({ id: "e1", from: sw.id!, to: rk.id!, fromBreaker: "b1" }); // internal
  g.uid++; g.edges.push({ id: "e2", from: ext.id!, to: sw.id! }); // external (ext not in group)
  g = createGroup(g, [sw.id!, rk.id!], "Block").graph;
  const gid = g.groups![0].id;

  const payload = extractGroup(g, gid)!;
  assert.equal(payload.nodes.length, 2);
  assert.equal(payload.edges.length, 1, "only the internal edge is captured");
  assert.equal(payload.edges[0].fromBreaker, "b1");

  const beforeNodes = g.nodes.length;
  const inst = instantiateGroup(g, payload);
  assert.equal(inst.ok, true);
  assert.equal(inst.graph.nodes.length, beforeNodes + 2, "two fresh nodes added");
  const newGroup = inst.graph.groups!.find((x) => x.id === inst.id)!;
  assert.equal(newGroup.members.length, 2);
  // fresh ids (no collision with originals)
  assert.equal(newGroup.members.some((m) => m === sw.id || m === rk.id), false);
  // the internal edge was re-created between the new members
  const newEdges = inst.graph.edges.filter((e) => newGroup.members.includes(e.from) && newGroup.members.includes(e.to));
  assert.equal(newEdges.length, 1);
});

test("duplicateGroup: clones the whole group (members + internal edges + new group)", () => {
  const { g, ids } = twoRackGraph();
  const gg = createGroup(g, ids, "Pod").graph;
  const gid = gg.groups![0].id;
  const r = duplicateGroup(gg, gid);
  assert.equal(r.ok, true);
  assert.equal(gg.groups!.length, 1);
  assert.equal(r.graph.groups!.length, 2, "a new group is added");
  const ng = r.graph.groups!.find((x) => x.id === r.id)!;
  assert.equal(ng.members.length, ids.length);
  assert.equal(ng.members.some((m) => ids.includes(m)), false, "copies have fresh ids");
  assert.match(ng.name, /copy/);
});

test("removeNode cleans group membership; snap/restore round-trips groups", () => {
  const { g, ids } = twoRackGraph();
  const gg = createGroup(g, ids, "P").graph;
  assert.deepEqual(restore(snap(gg)), gg);
  const rm = removeNode(gg, ids[0]).graph;
  const gr = (rm.groups || [])[0];
  assert.ok(!gr || !gr.members.includes(ids[0]), "removed node dropped from group");
});
