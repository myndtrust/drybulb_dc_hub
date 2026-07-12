// ─────────────────────────────────────────────────────────────────────────────
// AI Factory single-line — shared connector ENGINE (pure, DOM-free).
//
// One source of truth for the graph model + connector operations. Loaded by the
// mockup with a classic <script src> (works on file://, no CORS) and require()'d
// by the Node tests — so the UI and the tests exercise the SAME code.
//
// Mirrors lib/factory/schema.ts (FNode/FEdge, acyclic power DAG). A single-line
// is a tree/DAG: sources (roots) → distribution → loads (leaves). Edges run from
// an OUTPUT port to an INPUT port. Every operation is PURE: it clones the graph,
// validates, and returns {ok, graph, reason?} without mutating its input.
//
// UMD: attaches globalThis.SLD for the browser and module.exports for Node.
// ─────────────────────────────────────────────────────────────────────────────
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SLD = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ── Palette: type → {label, kw, kind:'src'|'eq'|'load', grp?} ───────────────
  const PAL = {
    utility: { label: "Utility feed", kw: 0, kind: "src" },
    genset: { label: "On-site generation", kw: 0, kind: "src" },
    paralleling: { label: "Paralleling / ATS", kw: 0, kind: "eq" },
    transformer: { label: "Transformer", kw: 0, kind: "eq" },
    ups: { label: "Transformer + UPS", kw: 0, kind: "eq" },
    switchboard: { label: "Switchboard", kw: 0, kind: "eq", breakered: true },
    rpp: { label: "RPP (remote power panel)", kw: 0, kind: "eq", breakered: true },
    rack: { label: "GB300 NVL72 rack", kw: 120, kind: "load", grp: "IT" },
    chiller: { label: "Chiller plant", kw: 300, kind: "load", grp: "MECH" },
    cdu: { label: "CDU", kw: 5, kind: "load", grp: "MECH" },
    crah: { label: "CRAH", kw: 40, kind: "load", grp: "MECH" },
    spine: { label: "Spine switch", kw: 8, kind: "load", grp: "NET" },
    leaf: { label: "Leaf switch", kw: 12, kind: "load", grp: "NET" },
  };

  // ── Geometry (kept in lock-step with the mockup CSS/layout) ─────────────────
  const EQW = 150, EQH = 52, BUSH = 10, BRKW = 26;
  function loadW(n) { return n.grp === "IT" ? 96 : 88; }
  function isBreakered(node) { return !!(node && PAL[node.type] && PAL[node.type].breakered); }
  function nodeW(n) {
    if (n.kind === "load") return loadW(n);
    if (isBreakered(n)) return Math.max(EQW, BRKW * ((n.breakers && n.breakers.length) || 0) + 24);
    return EQW;
  }
  function geo(n) { const w = nodeW(n); return { x: n.x, y: n.y, w, h: EQH, cx: n.x + w / 2, top: n.y, bot: n.y + EQH }; }
  function busGeo(b) { return { x: b.x, y: b.y, w: b.w, h: BUSH, cx: b.x + b.w / 2, top: b.y, bot: b.y + BUSH }; }

  // Breaker-bank defaults per breakered type (RPP and busway are interchangeable
  // row-distribution: tap-offs that fan out to racks).
  const BRK_CFG = {
    switchboard: { n: 8, lab: "F", amp: 800, mainAmp: 3200, voltage: "480 V" },
    rpp: { n: 4, lab: "C", amp: 100, mainAmp: 400, voltage: "415/240 V" },
  };
  function brkCfg(type) { return BRK_CFG[type] || { n: 4, lab: "F", amp: 400, mainAmp: 1000, voltage: "480 V" }; }
  /** A breakered card's default feeders/tap-offs (SWBD: F1..F8, RPP: C1..C4, busway: T1..T8). */
  function defaultBreakers(type) {
    const c = brkCfg(type); const out = [];
    for (let i = 1; i <= c.n; i++) out.push({ id: "b" + i, label: c.lab + i, amp: c.amp, poles: 3, status: "closed" });
    return out;
  }
  /** Output taps: breakered → one per feeder breaker, spaced along the bottom; else a
   *  single centre output; loads have none. Returns canvas-absolute {breaker,x,y}. */
  function outTaps(node) {
    if (!node || node.kind === "load") return [];
    const g0 = geo(node);
    if (isBreakered(node) && node.breakers && node.breakers.length) {
      const n = node.breakers.length, pad = 16, span = g0.w - 2 * pad;
      return node.breakers.map((b, i) => ({ breaker: b.id, x: g0.x + pad + (n === 1 ? span / 2 : (span * i) / (n - 1)), y: g0.bot }));
    }
    return [{ breaker: null, x: g0.cx, y: g0.bot }];
  }
  /** Position of a specific output tap (breaker) on a node, or the centre output. */
  function tapPos(node, breakerId) {
    if (breakerId) { const t = outTaps(node).find((t) => t.breaker === breakerId); if (t) return { x: t.x, y: t.y }; }
    const g0 = geo(node); return { x: g0.cx, y: g0.bot };
  }

  // ── Lookups ─────────────────────────────────────────────────────────────────
  function findNode(g, id) { return g.nodes.find((n) => n.id === id) || null; }
  function findBus(g, id) { return g.busbars.find((b) => b.id === id) || null; }
  function ent(g, id) { return findNode(g, id) || findBus(g, id); }

  /** Which ports a card exposes, by role. Sources output-only, loads input-only,
   *  equipment + buses expose both. */
  function ports(node) {
    if (!node) return { input: false, output: false };
    if (node.kind === "src") return { input: false, output: true };
    if (node.kind === "load") return { input: true, output: false };
    return { input: true, output: true }; // eq
  }
  function hasOutput(g, id) { const n = findNode(g, id); if (n) return ports(n).output; return !!findBus(g, id); }
  function hasInput(g, id) { const n = findNode(g, id); if (n) return ports(n).input; return !!findBus(g, id); }

  /** Anchor point of a port. input = top-center, output = bottom-center. */
  function portPos(entity, which, isBus) {
    const gg = isBus ? busGeo(entity) : geo(entity);
    return { x: gg.cx, y: which === "input" ? gg.top : gg.bot };
  }

  // ── Pure helpers ────────────────────────────────────────────────────────────
  function clone(g) { return JSON.parse(JSON.stringify(g)); }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function nextId(g, p) { g.uid = (g.uid || 0) + 1; return p + g.uid; }

  // ── Cycle checks ────────────────────────────────────────────────────────────
  /** Adding from→to creates a cycle iff `from` is already reachable from `to`. */
  function wouldCycle(g, from, to) {
    if (from === to) return true;
    const adj = new Map();
    g.edges.forEach((e) => { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from).push(e.to); });
    const seen = new Set([to]); const st = [to];
    while (st.length) { const u = st.pop(); if (u === from) return true; for (const v of adj.get(u) || []) if (!seen.has(v)) { seen.add(v); st.push(v); } }
    return false;
  }
  function hasCycleAll(g) {
    const adj = new Map();
    g.edges.forEach((e) => { if (!adj.has(e.from)) adj.set(e.from, []); adj.get(e.from).push(e.to); });
    const color = new Map(); // 0 white 1 gray 2 black
    const dfs = (u) => {
      color.set(u, 1);
      for (const v of adj.get(u) || []) { const c = color.get(v) || 0; if (c === 1) return true; if (c === 0 && dfs(v)) return true; }
      color.set(u, 2); return false;
    };
    for (const k of adj.keys()) if ((color.get(k) || 0) === 0 && dfs(k)) return true;
    return false;
  }

  // ── Connection rules ────────────────────────────────────────────────────────
  /** Can an edge run from `fromId` (output) to `toId` (input)? `opts.fromBreaker`
   *  ties the feed to a specific feeder breaker (used once). */
  function canConnect(g, fromId, toId, opts) {
    if (fromId === toId) return { ok: false, reason: "can't connect a card to itself" };
    if (!ent(g, fromId)) return { ok: false, reason: "source endpoint missing" };
    if (!ent(g, toId)) return { ok: false, reason: "target endpoint missing" };
    if (!hasOutput(g, fromId)) return { ok: false, reason: "source has no output port" };
    if (!hasInput(g, toId)) return { ok: false, reason: "target has no input port" };
    if (g.edges.some((e) => e.from === fromId && e.to === toId)) return { ok: false, reason: "already connected" };
    if (g.edges.some((e) => e.from === toId && e.to === fromId)) return { ok: false, reason: "reverse connection exists" };
    if (wouldCycle(g, fromId, toId)) return { ok: false, reason: "would create a loop (single-line must be acyclic)" };
    const br = opts && opts.fromBreaker;
    if (br) {
      const fn = findNode(g, fromId);
      if (!fn || !isBreakered(fn) || !(fn.breakers || []).some((b) => b.id === br)) return { ok: false, reason: "breaker not found on source" };
      if (g.edges.some((e) => e.from === fromId && e.fromBreaker === br)) return { ok: false, reason: "breaker already feeds a circuit" };
    }
    return { ok: true };
  }

  // ── Operations (pure: return {ok, graph, reason?}) ──────────────────────────
  function addEdge(g, fromId, toId, opts) {
    const r = canConnect(g, fromId, toId, opts);
    if (!r.ok) return { ok: false, graph: g, reason: r.reason };
    const ng = clone(g);
    const edge = { id: nextId(ng, "e"), from: fromId, to: toId };
    if (opts && opts.fromBreaker) edge.fromBreaker = opts.fromBreaker;
    ng.edges.push(edge);
    return { ok: true, graph: ng };
  }

  function removeEdge(g, edgeId) {
    if (!g.edges.some((e) => e.id === edgeId)) return { ok: false, graph: g, reason: "connector not found" };
    const ng = clone(g);
    ng.edges = ng.edges.filter((e) => e.id !== edgeId);
    return { ok: true, graph: ng };
  }

  /** Re-route one endpoint of an existing edge. `end` is 'from' or 'to'.
   *  Re-routing the 'from' end onto a breakered card binds `opts.fromBreaker`
   *  (and onto a plain card clears any prior breaker). */
  function moveEdge(g, edgeId, end, newId, opts) {
    const e = g.edges.find((x) => x.id === edgeId);
    if (!e) return { ok: false, graph: g, reason: "connector not found" };
    const from = end === "from" ? newId : e.from;
    const to = end === "to" ? newId : e.to;
    let fromBreaker = e.fromBreaker;
    if (end === "from") { const fn = findNode(g, newId); fromBreaker = fn && isBreakered(fn) && opts && opts.fromBreaker ? opts.fromBreaker : undefined; }
    // validate against the graph with this edge removed (so it doesn't block itself)
    const without = clone(g);
    without.edges = without.edges.filter((x) => x.id !== edgeId);
    const r = canConnect(without, from, to, fromBreaker ? { fromBreaker } : undefined);
    if (!r.ok) return { ok: false, graph: g, reason: r.reason };
    const ng = clone(g);
    const te = ng.edges.find((x) => x.id === edgeId);
    te.from = from; te.to = to;
    if (fromBreaker) te.fromBreaker = fromBreaker; else delete te.fromBreaker;
    return { ok: true, graph: ng };
  }

  /** Build a node, omitting undefined keys so it survives a JSON round-trip cleanly. */
  function mkNode(idStr, type, name, x, y, extra) {
    const p = PAL[type];
    const n = { id: idStr, type, name: name || p.label, x, y, kw: p.kw || 0, kind: p.kind, red: "2N", catalogKey: "", product: "", rating: "" };
    if (p.grp) n.grp = p.grp;
    if (p.breakered) { const c = brkCfg(type); n.voltage = c.voltage; n.mainAmp = c.mainAmp; n.breakers = defaultBreakers(type); }
    return Object.assign(n, extra || {});
  }

  function addNode(g, type, x, y, extra) {
    if (!PAL[type]) return { ok: false, graph: g, reason: "unknown type " + type };
    const ng = clone(g);
    const n = mkNode(nextId(ng, "n"), type, null, x, y, extra);
    ng.nodes.push(n);
    return { ok: true, graph: ng, id: n.id };
  }

  /** Add a busbar (the thick line — any element can tap onto it, in or out). */
  function addBus(g, x, y, name) {
    const ng = clone(g);
    ng.busbars.push({ id: nextId(ng, "n"), name: name || "BUS", x, y, w: 420, kv: "480 V" });
    return { ok: true, graph: ng, id: "n" + ng.uid };
  }

  function removeNode(g, id) {
    if (!ent(g, id)) return { ok: false, graph: g, reason: "card not found" };
    const ng = clone(g);
    ng.nodes = ng.nodes.filter((n) => n.id !== id);
    ng.busbars = ng.busbars.filter((b) => b.id !== id);
    ng.edges = ng.edges.filter((e) => e.from !== id && e.to !== id);
    return { ok: true, graph: ng };
  }

  // ── Breaker CRUD (pure: return {ok, graph, reason?}) ────────────────────────
  function addBreaker(g, nodeId) {
    const n = findNode(g, nodeId); if (!n || !isBreakered(n)) return { ok: false, graph: g, reason: "not a breakered card" };
    const ng = clone(g); const nn = findNode(ng, nodeId);
    const nums = nn.breakers.map((b) => parseInt(String(b.id).replace(/\D/g, ""), 10) || 0);
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    const c = brkCfg(nn.type);
    nn.breakers.push({ id: "b" + next, label: c.lab + next, amp: c.amp, poles: 3, status: "closed" });
    return { ok: true, graph: ng, id: "b" + next };
  }
  function removeBreaker(g, nodeId, brId) {
    const n = findNode(g, nodeId); if (!n || !isBreakered(n)) return { ok: false, graph: g, reason: "not a breakered card" };
    if (!n.breakers.some((b) => b.id === brId)) return { ok: false, graph: g, reason: "breaker not found" };
    const ng = clone(g); const nn = findNode(ng, nodeId);
    nn.breakers = nn.breakers.filter((b) => b.id !== brId);
    ng.edges = ng.edges.filter((e) => !(e.from === nodeId && e.fromBreaker === brId)); // cascade
    return { ok: true, graph: ng };
  }
  function setBreaker(g, nodeId, brId, key, val) {
    const n = findNode(g, nodeId); if (!n || !isBreakered(n)) return { ok: false, graph: g, reason: "not a breakered card" };
    const ng = clone(g); const b = findNode(ng, nodeId).breakers.find((b) => b.id === brId);
    if (!b) return { ok: false, graph: g, reason: "breaker not found" };
    b[key] = val;
    return { ok: true, graph: ng };
  }

  // ── Invariant checker (regression tripwire) ─────────────────────────────────
  /** Structural invariants: no dangling/dup/self edges, valid port roles, acyclic,
   *  every load fed, no source fed. Returns {ok, errors[]}. */
  function validate(g) {
    const errors = [];
    const ids = new Set(g.nodes.map((n) => n.id).concat(g.busbars.map((b) => b.id)));
    const seenPair = new Set();
    const seenBreaker = new Set();
    for (const e of g.edges) {
      if (!ids.has(e.from)) errors.push(`edge ${e.id}: from ${e.from} missing`);
      if (!ids.has(e.to)) errors.push(`edge ${e.id}: to ${e.to} missing`);
      if (e.from === e.to) errors.push(`edge ${e.id}: self-loop`);
      const key = e.from + ">" + e.to;
      if (seenPair.has(key)) errors.push(`duplicate edge ${e.from}->${e.to}`);
      seenPair.add(key);
      if (ids.has(e.from) && !hasOutput(g, e.from)) errors.push(`edge ${e.id}: ${e.from} has no output port`);
      if (ids.has(e.to) && !hasInput(g, e.to)) errors.push(`edge ${e.id}: ${e.to} has no input port`);
      if (e.fromBreaker) {
        const fn = findNode(g, e.from);
        if (!fn || !isBreakered(fn) || !(fn.breakers || []).some((b) => b.id === e.fromBreaker)) errors.push(`edge ${e.id}: breaker ${e.fromBreaker} missing on ${e.from}`);
        const fk = e.from + "/" + e.fromBreaker;
        if (seenBreaker.has(fk)) errors.push(`breaker ${e.fromBreaker} on ${e.from} feeds >1 circuit`);
        seenBreaker.add(fk);
      }
    }
    if (hasCycleAll(g)) errors.push("cycle detected (single-line must be acyclic)");
    for (const n of g.nodes) {
      if (n.kind === "load" && !g.edges.some((e) => e.to === n.id)) errors.push(`load ${n.id} (${n.name}) has no feeder`);
      if (n.kind === "src" && g.edges.some((e) => e.to === n.id)) errors.push(`source ${n.id} (${n.name}) must not have a feeder`);
    }
    return { ok: errors.length === 0, errors };
  }

  // ── Hit-testing (pure → testable headless) ──────────────────────────────────
  function hitTestPort(g, x, y, r) {
    r = r || 11;
    for (const n of g.nodes) {
      const p = ports(n), gg = geo(n);
      if (p.output) {
        for (const t of outTaps(n)) if (dist(x, y, t.x, t.y) <= r) return t.breaker ? { id: n.id, port: "output", breaker: t.breaker } : { id: n.id, port: "output" };
      }
      if (p.input && dist(x, y, gg.cx, gg.top) <= r) return { id: n.id, port: "input" };
    }
    for (const b of g.busbars) {
      if (x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + BUSH + r) {
        return { id: b.id, port: y < b.y + BUSH / 2 ? "input" : "output" };
      }
    }
    return null;
  }

  function edgeEndpoints(g, e) {
    const fa = ent(g, e.from), ta = ent(g, e.to);
    if (!fa || !ta) return null;
    const fromBus = !!findBus(g, e.from), toBus = !!findBus(g, e.to);
    const fg = fromBus ? busGeo(fa) : geo(fa), tg = toBus ? busGeo(ta) : geo(ta);
    const fromX = !fromBus && e.fromBreaker ? tapPos(fa, e.fromBreaker).x : fg.cx;
    return { from: { x: fromX, y: fg.bot }, to: { x: tg.cx, y: tg.top } };
  }

  function hitTestWireEnd(g, x, y, r) {
    r = r || 9; let best = null, bd = r;
    for (const e of g.edges) {
      const ep = edgeEndpoints(g, e); if (!ep) continue;
      const df = dist(x, y, ep.from.x, ep.from.y); if (df <= bd) { bd = df; best = { edgeId: e.id, end: "from" }; }
      const dt = dist(x, y, ep.to.x, ep.to.y); if (dt <= bd) { bd = dt; best = { edgeId: e.id, end: "to" }; }
    }
    return best;
  }

  // ── Serialization (round-trip used by undo / future persistence) ────────────
  function snap(g) { return JSON.stringify(g); }
  function restore(s) { return JSON.parse(s); }

  // ── Seed: GB300 NVL72 single-line — NVIDIA DGX SuperPOD RA topology ──────────
  // UPS layer = 4-to-make-3 (distributed redundant): 4 transformer+UPS blocks feed a
  // shared LV distributed-redundant bus. Distribution = 2N: SWBD-A/B → RPP-A/B → racks
  // (each rack dual-corded across an A-side and a B-side RPP branch breaker). Manifold
  // is passive → excluded from the power view.
  function seed() {
    const g = { nodes: [], edges: [], busbars: [], uid: 0 };
    const N = (type, name, x, y, extra) => { g.uid++; const n = mkNode("n" + g.uid, type, name, x, y, extra); g.nodes.push(n); return n; };
    const BUS = (name, x, y, w, kv) => { g.uid++; const b = { id: "n" + g.uid, name, x, y, w, kv }; g.busbars.push(b); return b; };
    const E = (from, to) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
    const EB = (from, br, to) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };

    // sources → paralleling → MV bus
    const util = N("utility", "Utility feed 115 kV", 250, 18, { rating: "115 kV" });
    const gen = N("genset", "On-site generation", 520, 18, { rating: "N×33 MW" });
    const par = N("paralleling", "Paralleling switchgear", 385, 96, { rating: "ATS" });
    const busMV = BUS("MAIN MV BUS · 13.8 kV", 150, 176, 1180, "13.8 kV");

    // 4-to-make-3 UPS layer: 4 transformer + UPS blocks
    const txX = [], upsX = [];
    for (let i = 0; i < 4; i++) {
      const x = 200 + i * 300;
      txX.push(N("transformer", "Transformer " + (i + 1), x, 212, { rating: "2.5 MVA" }));
      upsX.push(N("ups", "UPS " + (i + 1) + " (4N3)", x, 292, { rating: "1500 kVA" }));
    }
    // shared LV distributed-redundant bus (any 3 of 4 carry the load)
    const busLV = BUS("LV DISTRIBUTED-REDUNDANT BUS · 480 V (4-to-make-3)", 150, 372, 1180, "480 V");

    // 2N distribution: two switchboards off the LV bus
    const swA = N("switchboard", "SWBD-A", 250, 432, { rating: "480 V · 3200 A" });
    const swB = N("switchboard", "SWBD-B", 900, 432, { rating: "480 V · 3200 A" });

    // row panels (RPP) — A1/A2 + B1/B2
    const rA1 = N("rpp", "RPP-A1", 150, 524), rA2 = N("rpp", "RPP-A2", 470, 524);
    const rB1 = N("rpp", "RPP-B1", 800, 524), rB2 = N("rpp", "RPP-B2", 1120, 524);

    // loads
    const racks = []; for (let i = 0; i < 8; i++) racks.push(N("rack", "GB300 rack " + (i + 1), 150 + i * 112, 632));
    const chiller = N("chiller", "Chiller plant", 1060, 632), cdu = N("cdu", "CDU", 1160, 632), crah = N("crah", "CRAH", 1250, 632);
    const spine = N("spine", "Spine", 1340, 632), leaf = N("leaf", "Leaf", 1430, 632);

    // upstream feeds
    E(util, par); E(gen, par); E(par, busMV);
    txX.forEach((tx) => E(busMV, tx));
    txX.forEach((tx, i) => E(tx, upsX[i]));
    upsX.forEach((u) => E(u, busLV));      // 4 UPS → shared LV bus (4N3)
    E(busLV, swA); E(busLV, swB);          // LV bus → 2N switchboards

    // SWBD feeder breakers: F1→RPP1, F2→RPP2, F3-7 → mech/net, F8 spare
    const mechNet = [chiller, cdu, crah, spine, leaf];
    EB(swA, "b1", rA1); EB(swA, "b2", rA2); mechNet.forEach((l, i) => EB(swA, "b" + (i + 3), l));
    EB(swB, "b1", rB1); EB(swB, "b2", rB2); mechNet.forEach((l, i) => EB(swB, "b" + (i + 3), l));

    // RPP branch breakers → racks (2N: A1/B1 feed racks 1-4, A2/B2 feed racks 5-8)
    for (let i = 0; i < 4; i++) { EB(rA1, "b" + (i + 1), racks[i]); EB(rB1, "b" + (i + 1), racks[i]); }
    for (let i = 0; i < 4; i++) { EB(rA2, "b" + (i + 1), racks[i + 4]); EB(rB2, "b" + (i + 1), racks[i + 4]); }
    return g;
  }

  return {
    PAL, EQW, EQH, BUSH, BRKW,
    nodeW, geo, busGeo, ports, portPos, isBreakered, defaultBreakers, outTaps, tapPos,
    findNode, findBus, ent, hasInput, hasOutput,
    canConnect, addEdge, removeEdge, moveEdge, addNode, removeNode, addBus,
    addBreaker, removeBreaker, setBreaker,
    validate, wouldCycle, hasCycleAll,
    hitTestPort, hitTestWireEnd, edgeEndpoints,
    snap, restore, seed,
  };
});
