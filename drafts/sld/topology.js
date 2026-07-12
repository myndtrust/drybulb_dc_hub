// ─────────────────────────────────────────────────────────────────────────────
// AI Factory power-topology GENERATOR (pure, DOM-free) — the deterministic core
// behind the /design-power-topology agent.
//
// Given a SPEC (capacity + redundancy + voltages), it (1) SIZES the utility→chip
// power chain (sizePowerChain), (2) emits a laid-out single-line in the SAME shape
// drafts/sld/engine.js produces (buildTopology) — so it loads on the SLD canvas and
// passes SLD.validate() — and (3) renders a 1-page markdown BRIEF (brief) for sales/
// investors. Same spec in → same diagram + brief out (deterministic, unit-tested).
//
// Knowledge constants mirror data/power-equipment.json (cited inline). Primary
// source: SemiAnalysis "Datacenter Anatomy Part 1: Electrical Systems".
//
// UMD: globalThis.SLDTopo for the browser (alongside SLD), module.exports for Node.
// ─────────────────────────────────────────────────────────────────────────────
(function (root, factory) {
  const engine =
    typeof module !== "undefined" && module.exports
      ? require("./engine.js")
      : root.SLD;
  const api = factory(engine);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SLDTopo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (SLD) {
  "use strict";

  // ── Knowledge constants (mirror data/power-equipment.json; [semi] = SemiAnalysis Part 1) ──
  const K = {
    voltages: { hv: "230 kV", mv: "13.8 kV", lv: "480 V" }, // [semi] HV 138/230/345, MV 11/13.8/22/33, LV 415/480
    hvTransformerMVA: 75, //            [semi] 50-100 MVA, GOES-core, 18-24 mo lead
    unitSubMVA: 2.5, //                 [semi] MV→LV unit sub, 2.5-3 MVA
    gensetMW: 3, //                     [semi] 2-3 MW hyperscale gensets, ~4000 hp at 3 MW
    upsModuleKVA: 400, //               [semi] 200/400 kVA modules, up to 27 MW/system
    podMW: 2.5, //                      [semi] standardised pods 1.6 / 2.0 / 2.5 MW
    rackKW: 120, //                     GB300 NVL72 (data/reference-architectures.json)
    gpusPerRack: 72,
    pue: 1.2,
  };

  // Redundancy schemes → how many capacity blocks for a given `need`. `group` marks
  // distributed-redundant schemes [total, usable] that share a bus. [semi]/[local].
  const SCHEMES = {
    N: { label: "N", blocks: (n) => n, factor: (n) => n },
    "N+1": { label: "N+1", blocks: (n) => n + 1, factor: (n) => n + 1 },
    "2N": { label: "2N", blocks: (n) => 2 * n, factor: (n) => 2 * n },
    "2N+1": { label: "2N+1", blocks: (n) => 2 * n + 1, factor: (n) => 2 * n + 1 },
    "distributed-4to3": { label: "distributed redundant (4-to-make-3)", group: [4, 3], blocks: (n) => Math.ceil(n / 3) * 4 },
    "distributed-3to2": { label: "distributed redundant (3-to-make-2)", group: [3, 2], blocks: (n) => Math.ceil(n / 2) * 3 },
    catcher: { label: "catcher / N+2C (isolated parallel, STS)", reserve: true, blocks: (n) => n + 1 },
  };

  const TIERS = {
    I: { downtime: "28.8 h/yr", attr: "single path" },
    II: { downtime: "22 h/yr", attr: "redundant capacity" },
    III: { downtime: "1.6 h/yr", attr: "concurrently maintainable" },
    IV: { downtime: "0.43 h/yr", attr: "fault tolerant" },
  };

  function scheme(key) { return SCHEMES[key] || SCHEMES.N; }
  function ceil(x) { return Math.ceil(x - 1e-9); }
  function round1(x) { return Math.round(x * 10) / 10; }

  // ── Spec normalisation ──────────────────────────────────────────────────────
  // Accepts a partial spec; fills sourced defaults. itMW is *critical IT* power.
  function normalizeSpec(input) {
    const s = input || {};
    const r = s.redundancy || {};
    const v = s.voltages || {};
    const itMW = s.itMW != null ? Number(s.itMW)
      : s.facilityMW != null ? Number(s.facilityMW) / (s.pue || K.pue)
      : 10;
    const spec = {
      name: s.name || "Untitled AI factory",
      ra: s.ra || "gb300-nvl72",
      itMW,
      pue: s.pue || K.pue,
      rackKW: s.rackKW || K.rackKW,
      gpusPerRack: s.gpusPerRack || K.gpusPerRack,
      podMW: s.podMW || K.podMW,
      cooling: s.cooling || "liquid",
      tier: s.tier || "III",
      redundancy: {
        generation: r.generation || "N+1",
        ups: r.ups || "distributed-4to3",
        distribution: r.distribution || "2N",
      },
      voltages: { hv: v.hv || K.voltages.hv, mv: v.mv || K.voltages.mv, lv: v.lv || K.voltages.lv },
    };
    return spec;
  }

  // ── Sizing: the quantitative power chain (the schedule "truth") ──────────────
  function sizePowerChain(input) {
    const spec = normalizeSpec(input);
    const itMW = spec.itMW;
    const facilityMW = round1(itMW * spec.pue);
    const racks = ceil((itMW * 1000) / spec.rackKW);
    const gpus = racks * spec.gpusPerRack;
    const podsNeeded = ceil(itMW / spec.podMW); // IT pods (transformer+UPS granularity)

    const ups = scheme(spec.redundancy.ups);
    const gen = scheme(spec.redundancy.generation);
    const dist = scheme(spec.redundancy.distribution);

    const upsBlocks = ups.blocks(podsNeeded); // transformer+UPS blocks
    const unitSubs = upsBlocks; // one unit-sub transformer per UPS block
    const upsModules = ups.blocks(ceil((podsNeeded * spec.podMW * 1000) / K.upsModuleKVA)); // sized modules × redundancy

    const genNeed = ceil(facilityMW / K.gensetMW);
    const gensets = gen.blocks(genNeed);

    const hvNeed = ceil(facilityMW / (K.hvTransformerMVA * 0.95)); // MVA≈MW, ~5% PF allowance
    const hvTransformers = gen.blocks(hvNeed);

    // 2N distribution → A/B switchboards + RPP A/B pairs per pod
    const swbds = dist.blocks(podsNeeded);
    const rpps = dist === SCHEMES["2N"] || spec.redundancy.distribution === "2N" ? 4 * podsNeeded : 2 * podsNeeded;

    return {
      spec,
      facilityMW,
      itMW: round1(itMW),
      racks,
      gpus,
      podsNeeded,
      schedule: [
        { item: "HV substation transformer", qty: hvTransformers, rating: K.hvTransformerMVA + " MVA", scheme: gen.label, catalogKey: "transformers", lead: "18-24 mo", risk: "high" },
        { item: "MV switchgear / paralleling", qty: 1, rating: spec.voltages.mv, scheme: "—", catalogKey: "switchgear", lead: "~50 wk", risk: "high" },
        { item: "Standby genset", qty: gensets, rating: K.gensetMW + " MW", scheme: gen.label, catalogKey: "generators", lead: "18 mo", risk: "high" },
        { item: "Unit-sub transformer (MV→LV)", qty: unitSubs, rating: spec.podMW + " MVA", scheme: ups.label, catalogKey: "transformers", lead: "—", risk: "med" },
        { item: "Static UPS block", qty: upsBlocks, rating: spec.podMW + " MVA", scheme: ups.label, catalogKey: "ups", lead: "—", risk: "med" },
        { item: "UPS power module", qty: upsModules, rating: K.upsModuleKVA + " kVA", scheme: ups.label, catalogKey: "ups", lead: "—", risk: "low" },
        { item: "LV main switchboard", qty: swbds, rating: spec.voltages.lv + " · 3200 A", scheme: spec.redundancy.distribution, catalogKey: "lv", lead: "—", risk: "low" },
        { item: "Remote power panel (RPP)", qty: rpps, rating: "415/240 V", scheme: spec.redundancy.distribution, catalogKey: "lv", lead: "—", risk: "low" },
        { item: "Compute rack", qty: racks, rating: spec.rackKW + " kW", scheme: spec.redundancy.distribution + " cords", catalogKey: "accel", lead: "—", risk: "—" },
      ],
    };
  }

  // ── Topology: a representative, VALID single-line (engine.js format) ─────────
  // Shows one power block (per-scheme shape) with campus multipliers annotated in
  // node ratings + graph.meta. The schedule above carries the full quantitative count.
  function buildTopology(input) {
    const sz = sizePowerChain(input);
    const spec = sz.spec;
    const ups = scheme(spec.redundancy.ups);
    const twoN = spec.redundancy.distribution === "2N";

    const g = { nodes: [], busbars: [], edges: [], uid: 0, meta: null };
    const N = (type, name, x, y, extra) => { g.uid++; const n = mkNode("n" + g.uid, type, name, x, y, extra); g.nodes.push(n); return n; };
    const BUS = (name, x, y, w, kv) => { g.uid++; const b = { id: "n" + g.uid, name, x, y, w, kv }; g.busbars.push(b); return b; };
    const E = (from, to) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
    const EB = (from, br, to) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };

    // sources → paralleling → MV bus
    const util = N("utility", "Utility feed " + spec.voltages.hv, 250, 18, { rating: spec.voltages.hv });
    const gen = N("genset", "On-site generation", 560, 18, { rating: sz.schedule[2].qty + " × " + K.gensetMW + " MW (" + spec.redundancy.generation + ")" });
    const par = N("paralleling", "Paralleling switchgear", 405, 96, { rating: "ATS · " + spec.voltages.mv });
    const busMV = BUS("MAIN MV BUS · " + spec.voltages.mv, 150, 176, 1180, spec.voltages.mv);
    E(util, par); E(gen, par); E(par, busMV);

    // UPS layer — number of blocks SHOWN reflects the scheme shape (≤4)
    let shown = 2, busLabel = "LV BUS · " + spec.voltages.lv;
    if (ups.group) { shown = ups.group[0]; busLabel = "LV DISTRIBUTED-REDUNDANT BUS · " + spec.voltages.lv + " (" + ups.group[0] + "-to-make-" + ups.group[1] + ")"; }
    else if (spec.redundancy.ups === "2N") { shown = 2; busLabel = "LV BUS · " + spec.voltages.lv + " (2N A/B)"; }
    else if (spec.redundancy.ups === "catcher") { shown = 3; busLabel = "LV BUS · " + spec.voltages.lv + " (N + reserve catcher)"; }
    else if (spec.redundancy.ups === "N+1") { shown = 3; busLabel = "LV BUS · " + spec.voltages.lv + " (N+1)"; }
    shown = Math.min(shown, 4);

    const txX = [], upsX = [];
    for (let i = 0; i < shown; i++) {
      const x = 200 + i * 300;
      const isReserve = spec.redundancy.ups === "catcher" && i === shown - 1;
      txX.push(N("transformer", "Transformer " + (i + 1), x, 212, { rating: spec.podMW + " MVA" }));
      upsX.push(N("ups", isReserve ? "UPS R (reserve)" : "UPS " + (i + 1), x, 292, { rating: spec.upsModuleKVA + " kVA modules", red: spec.redundancy.ups }));
    }
    const busLV = BUS(busLabel, 150, 372, 1180, spec.voltages.lv);
    txX.forEach((tx) => E(busMV, tx));
    txX.forEach((tx, i) => E(tx, upsX[i]));
    upsX.forEach((u) => E(u, busLV));

    // distribution — 2N: SWBD-A/B; else single SWBD
    const mult = sz.podsNeeded > 1 ? " · × " + sz.podsNeeded + " pods" : "";
    const swA = N("switchboard", twoN ? "SWBD-A" : "SWBD", 250, 432, { rating: spec.voltages.lv + " · 3200 A" + mult });
    const swB = twoN ? N("switchboard", "SWBD-B", 900, 432, { rating: spec.voltages.lv + " · 3200 A" + mult }) : null;
    E(busLV, swA); if (swB) E(busLV, swB);

    // row panels (RPP)
    const rA1 = N("rpp", twoN ? "RPP-A1" : "RPP-1", 150, 524);
    const rA2 = N("rpp", twoN ? "RPP-A2" : "RPP-2", 470, 524);
    const rB1 = twoN ? N("rpp", "RPP-B1", 800, 524) : null;
    const rB2 = twoN ? N("rpp", "RPP-B2", 1120, 524) : null;
    EB(swA, "b1", rA1); EB(swA, "b2", rA2);
    if (twoN) { EB(swB, "b1", rB1); EB(swB, "b2", rB2); }

    // loads — representative racks (≤8) + mech/net; dual-corded in 2N
    const rackShow = Math.min(sz.racks, 8);
    const racks = [];
    for (let i = 0; i < rackShow; i++) {
      const last = i === rackShow - 1 && sz.racks > rackShow;
      racks.push(N("rack", last ? "rack " + (i + 1) + " … (× " + sz.racks + ")" : "rack " + (i + 1), 150 + i * 112, 632, { rating: spec.rackKW + " kW" }));
    }
    const half = Math.ceil(rackShow / 2);
    for (let i = 0; i < rackShow; i++) {
      const aPanel = i < half ? rA1 : rA2;
      const bPanel = i < half ? rB1 : rB2;
      const aBr = "b" + ((i % half) + 1);
      EB(aPanel, aBr, racks[i]);
      if (twoN && bPanel) EB(bPanel, aBr, racks[i]);
    }

    // mech + net summary loads off SWBD feeder breakers
    const chiller = N("chiller", "Chiller plant", 1060, 632), cdu = N("cdu", "CDU", 1160, 632), crah = N("crah", "CRAH", 1250, 632);
    const spine = N("spine", "Spine", 1340, 632), leaf = N("leaf", "Leaf", 1430, 632);
    const mechNet = [chiller, cdu, crah, spine, leaf];
    mechNet.forEach((l, i) => EB(swA, "b" + (i + 3), l));

    g.meta = {
      spec,
      facilityMW: sz.facilityMW,
      itMW: sz.itMW,
      racks: sz.racks,
      gpus: sz.gpus,
      podsNeeded: sz.podsNeeded,
      multipliers: { pods: sz.podsNeeded, racksShown: rackShow, racksTotal: sz.racks, upsBlocksShown: shown, upsBlocksTotal: sz.schedule[4].qty },
    };
    return g;
  }

  // mkNode mirrors engine.js (kept local so the generator controls layout/breakers).
  function mkNode(idStr, type, name, x, y, extra) {
    const p = SLD.PAL[type];
    const n = { id: idStr, type, name: name || p.label, x, y, kw: p.kw || 0, kind: p.kind, red: "2N", catalogKey: "", product: "", rating: "" };
    if (p.grp) n.grp = p.grp;
    if (p.breakered) { n.voltage = type === "rpp" ? "415/240 V" : "480 V"; n.mainAmp = type === "rpp" ? 400 : 3200; n.breakers = SLD.defaultBreakers(type); }
    return Object.assign(n, extra || {});
  }

  // ── 1-page brief (markdown) for sales / investors ───────────────────────────
  function brief(input) {
    const sz = sizePowerChain(input);
    const spec = sz.spec;
    const t = TIERS[spec.tier] || TIERS.III;
    const ups = scheme(spec.redundancy.ups).label;
    const gen = scheme(spec.redundancy.generation).label;
    const L = [];
    L.push("# " + spec.name);
    L.push("");
    L.push("**" + sz.facilityMW + " MW facility** · " + sz.itMW + " MW critical IT · " + sz.racks.toLocaleString() + " × " + spec.rackKW + " kW racks · " + sz.gpus.toLocaleString() + " GPUs · PUE " + spec.pue + " · " + spec.cooling + "-cooled");
    L.push("");
    L.push("## Topology");
    L.push("Utility " + spec.voltages.hv + " → on-site substation → MV switchgear (" + spec.voltages.mv + ", utility ∥ gensets via paralleling/ATS) → unit-sub transformers (" + spec.podMW + " MVA) → **" + ups + "** UPS → LV " + spec.voltages.lv + " switchboards → RPP row panels → " + spec.redundancy.distribution + " dual-corded racks.");
    L.push("");
    L.push("## Resilience — Tier " + spec.tier + " (" + t.attr + ", " + t.downtime + ")");
    L.push("- **Generation / transformers:** " + gen);
    L.push("- **UPS layer:** " + ups);
    L.push("- **Distribution to rack:** " + spec.redundancy.distribution + " (independent A/B cords per rack)");
    L.push("");
    L.push("## Major equipment schedule");
    L.push("| Equipment | Qty | Unit rating | Redundancy | Lead / risk |");
    L.push("|---|---:|---|---|---|");
    sz.schedule.forEach((r) => L.push("| " + r.item + " | " + r.qty.toLocaleString() + " | " + r.rating + " | " + r.scheme + " | " + r.lead + " · " + r.risk + " |"));
    L.push("");
    L.push("*Source: SemiAnalysis “Datacenter Anatomy Part 1: Electrical Systems” + data/power-equipment.json. Sized estimate — verify against the governing NVIDIA RA and project basis of design.*");
    return L.join("\n");
  }

  return { normalizeSpec, sizePowerChain, buildTopology, brief, SCHEMES, TIERS, K };
});
