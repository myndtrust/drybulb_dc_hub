// Rackline analysis: per-rack heat and power, cooling plant sizing, room
// single-line loading and fault current, and cable routing over the tray graph.
// Pure — reads a scenario, returns results, never mutates.
//
//   Airflow     CFM = BTU/h ÷ (1.08 × ΔT°F)
//   Water flow  GPM = BTU/h ÷ (500 × ΔT°F)
//   Fault       Isc = kVA ÷ (√3 × V × (Z + Z_utility))
//   Tray fill   Σ π/4 · OD² ÷ (tray width × depth)

import { BTU, CABLE_T, DERATED, SQ3, STD_LEN, redN } from "./constants";
import { corners, dist, inRect, proj, rackRear } from "./geometry";
import { stripeLoads, type LibIndex } from "./model";
import { UNASSIGNED, apportionCarry, netById, netSummaries, netSystems, servedRacks, spineRacks, switchesIn, systemFor, uplinks } from "./network";
import type {
  Analysis, CableGroup, CableResult, CableType, Check, ElecBasis, ElecNode, ElecResult,
  Feed, NetSystem, Rack, RackResult, Scenario, TraySeg, Vec,
} from "./types";

const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const n1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (v: number) => Math.round(v * 100) + "%";

export const isContained = (s: Scenario, r: Rack) => s.hacs.some((h) => inRect(rackRear(r), h, 0.05));

export interface AnalysisCtx {
  lib: LibIndex;
  elec: ElecBasis;
}

export function analyze(s: Scenario, ctx: AnalysisCtx): Analysis {
  const { lib, elec } = ctx;
  const c = s.cool, lf = s.loadFactor || 1;

  const fedBy = new Set(s.electrical.nodes.map((n) => n.id));
  const racks: RackResult[] = s.racks.map((r) => {
    let it = 0, liq = 0, u = 0, nodes = 0;
    for (const d of r.devs) {
      const L = lib[d.lib];
      if (!L) continue;
      it += L.kw * lf;
      liq += L.kw * lf * (L.liq || 0);
      u += L.u;
      if (L.cat === "compute") nodes++;
    }
    const air = it - liq, door = r.rdhx ? Math.min(air, c.rdhxKW) : 0, room = air - door;
    const contained = isContained(s, r);
    const st = stripeLoads(r, lib, elec, lf);
    const warn = [...st.warns];
    if (st.util > 1) warn.push(`PDU phase over limit on feed loss (${pct(st.util)})`);
    if (room > 20 && !contained) warn.push(`${n1(room)} kW to room without containment`);
    if (air > 45 && !r.rdhx) warn.push(`${n1(air)} kW air load per rack is past practical air cooling`);
    if (r.rdhx && air > c.rdhxKW) warn.push(`RDHx short by ${n1(air - c.rdhxKW)} kW`);
    if (u > r.u) warn.push("Rack over-filled");
    if (it > 0) for (const [f, id] of [["A", r.feedA], ["B", r.feedB]] as const)
      if (!id || !fedBy.has(id)) warn.push(`no ${f} feed: assign one in Power striping`);
    return {
      r, it, liq, air, door, room, contained, u, nodes, st, warn,
      cfm: (air * BTU) / (1.08 * c.dtF),
      gpm: (door * BTU) / (500 * c.rdhxDtF),
    };
  });

  const sum = (k: "it" | "liq" | "air" | "door" | "room" | "nodes" | "gpm") => racks.reduce((a, x) => a + x[k], 0);
  const it = sum("it"), liq = sum("liq"), air = sum("air"), door = sum("door"), room = sum("room"), nodes = sum("nodes");

  // Air side: contained racks get 5% leakage, uncontained the bypass factor.
  const roomCFM = racks.reduce((a, x) => a + ((x.room * BTU) / (1.08 * c.dtF)) * (x.contained ? 1.05 : c.bypass), 0);
  const crahN = room > 0 ? Math.max(Math.ceil(room / c.crahKW), Math.ceil(roomCFM / c.crahCFM)) : 0;
  const crahTot = crahN + (crahN ? redN(c.red, crahN) : 0);
  const crahPlaced = s.coolers.filter((o) => o.kind === "crah" || o.kind === "inrow").reduce((a, o) => a + (+o.cap || 0), 0);
  const rdhxN = racks.filter((x) => x.r.rdhx).length, rdhxGPM = sum("gpm");

  // Liquid side and plant.
  const cduN = liq > 0 ? Math.ceil(liq / c.cduKW) : 0, cduTot = cduN + (cduN ? redN(c.cduRed, cduN) : 0);
  const fwGPM = (liq * BTU) / (500 * c.fwDtF), tcsLPM = liq * c.tcsLpm;
  const chHeat = room + door + (c.dlcRej === "chiller" ? liq : 0);
  const tons = (chHeat / 3.517) * (1 + c.margin);
  const dryKW = c.dlcRej === "drycooler" ? liq * (1 + c.margin) : 0;
  const mechKW = tons * c.chKWton + crahN * c.crahFanKW + liq * c.cduPump + dryKW * c.dryKWkW;
  const lossKW = it * (1 / c.upsEff - 1) + (it + mechKW) * 0.015;
  const pue = it ? (it + mechKW + lossKW) / it : 0;

  // Planning footprint: bounding box of racks and containment plus 1.2 m clearance each side.
  const pts: Vec[] = [...s.racks.flatMap(corners), ...s.hacs.flatMap(corners)];
  let area = 0;
  if (pts.length) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    area = (Math.max(...xs) - Math.min(...xs) + 2.4) * (Math.max(...ys) - Math.min(...ys) + 2.4);
  }
  const maxRack = racks.reduce((a, x) => Math.max(a, x.it), 0);
  const pduWorst = racks.reduce((a, x) => Math.max(a, x.st.util), 0);

  const warns: Check[] = [];
  for (const x of racks) for (const w of x.warn) warns.push({ sev: /over|short|past/.test(w) ? "bad" : "warn", msg: `${x.r.name}: ${w}` });
  const cduPlaced = s.coolers.filter((o) => o.kind === "cdu").length;
  if (cduPlaced && cduPlaced < cduTot)
    warns.push({ sev: "warn", msg: `Placed CDUs ${cduPlaced} are fewer than required ${cduTot} (${c.cduRed})` });
  if (crahPlaced && crahPlaced < crahTot * c.crahKW)
    warns.push({ sev: "warn", msg: `Placed air cooling ${n0(crahPlaced)} kW is below required ${n0(crahTot * c.crahKW)} kW (${c.red})` });

  const out: Analysis = {
    s, racks, it, liq, air, door, room, nodes, roomCFM, crahN, crahTot, crahPlaced, rdhxN, rdhxGPM,
    cduN, cduTot, fwGPM, tcsLPM, tons, dryKW, mechKW, lossKW, pue, area, maxRack, pduWorst,
    elec: {}, cab: { groups: [], total: 0, count: 0, segs: [], noPath: 0 }, warns,
  };
  out.elec = electricalLoads(s, racks, mechKW, elec);
  out.cab = cableAnalysis(s, lib);

  for (const x of Object.values(out.elec)) {
    if (x.util > 1) warns.push({ sev: "bad", msg: `${x.n.name}: design load ${n0(x.design)} kVA exceeds rating ${n0(x.cap ?? 0)} kVA` });
    else if (x.util > 0.8) warns.push({ sev: "warn", msg: `${x.n.name}: ${pct(x.util)} loaded at design` });
  }
  if (out.cab.noPath) warns.push({ sev: "warn", msg: `${out.cab.noPath} cable groups have no tray path; lengths estimated point to point` });
  for (const g of out.cab.segs)
    if (g.fill > s.cable.fillMax) warns.push({ sev: "bad", msg: `${g.t.name} segment ${g.i + 1}: tray fill ${pct(g.fill)} over ${pct(s.cable.fillMax)}` });
  for (const n of netSummaries(s, lib, out.cab.groups)) {
    if (n.sys.id === UNASSIGNED.id) warns.push({ sev: "warn", msg: `${n0(n.access)} cables belong to no network system; add their cable type to one on the Network tab` });
  }
  // Each leaf rack: its endpoint cables plus its uplinks against its leaves' ports.
  const onLeaf = new Map<string, { net: string; r: Rack; n: number }>();
  for (const g of out.cab.groups) {
    const r = g.link === "access" ? g.to : g.from;
    const k = g.net + "|" + r.id;
    (onLeaf.get(k) ?? onLeaf.set(k, { net: g.net, r, n: 0 }).get(k)!).n += g.count;
  }
  for (const { net, r, n } of onLeaf.values()) {
    const ports = switchesIn(r, lib, net, "leaf").reduce((a, d) => a + (lib[d.lib]?.swPorts ?? 0), 0);
    if (ports && n > ports) warns.push({ sev: "bad", msg: `${r.name}: ${n0(n)} ${netById(netSystems(s), net).name} cables on ${n0(ports)} leaf switch ports` });
  }
  return out;
}

/** Nameplate capacity (kVA); breakered distribution carries the continuous derate. */
export function capKVA(n: ElecNode, elec: ElecBasis): number | null {
  if (n.kva) return +n.kva;
  if (n.amps && n.v) return ((SQ3 * n.v * n.amps) / 1000) * (DERATED.includes(n.type) ? elec.derate : 1);
  return null;
}

/**
 * Load every single-line node three ways — normal, A feed lost, B feed lost —
 * and take the worst as design. Racks split evenly across distinct A/B sources;
 * a lost feed shifts the whole rack to the survivor. UPS and transformer
 * losses gross up the load seen upstream.
 */
export function electricalLoads(s: Scenario, racks: RackResult[], mechKW: number, elec: ElecBasis): Record<string, ElecResult> {
  const sld = s.electrical;
  const byId = new Map(sld.nodes.map((n) => [n.id, n]));
  const pfIT = 0.95, pfM = 0.9;
  const kids = (id: string) => sld.links.filter((l) => l.from === id && byId.has(l.to)).map((l) => l.to);
  const mechAuto = sld.nodes.filter((n) => n.type === "mech" && n.auto);
  type Case = "nl" | "a" | "b";

  const own = (n: ElecNode, cs: Case) => {
    let kva = 0;
    for (const x of racks) {
      const r = x.r;
      const a = r.feedA && byId.has(r.feedA) ? r.feedA : null;
      const b = r.feedB && byId.has(r.feedB) ? r.feedB : null;
      let la = 0, lb = 0;
      if (a && b && a !== b) {
        if (cs === "nl") la = lb = x.it / 2;
        else if (cs === "a") lb = x.it;
        else la = x.it;
      } else if (a || b) {
        const one = a || b;
        const lost = (cs === "a" && one === a && !b) || (cs === "b" && one === b && !a);
        if (!lost) { if (one === a) la = x.it; else lb = x.it; }
      }
      if (n.id === a) kva += la / pfIT;
      if (n.id === b) kva += lb / pfIT;
    }
    if (n.type === "mech" && n.auto) kva += mechKW / mechAuto.length / pfM;
    if ((n.type === "load" || n.type === "mech") && +(n.kw ?? 0)) kva += (n.kw ?? 0) / pfM;
    return kva;
  };

  const racksOn: Record<string, { x: RackResult; f: Feed }[]> = {};
  for (const x of racks)
    for (const [f, id] of [["A", x.r.feedA], ["B", x.r.feedB]] as const)
      if (id && byId.has(id)) (racksOn[id] ??= []).push({ x, f });

  const res: Record<string, ElecResult> = {};
  for (const n of sld.nodes) res[n.id] = { n, nl: 0, a: 0, b: 0, design: 0, cap: null, util: 0, racks: [] };

  for (const cs of ["nl", "a", "b"] as Case[]) {
    const memo = new Map<string, number>(), vis = new Set<string>();
    const thr = (id: string): number => {
      const m = memo.get(id);
      if (m != null) return m;
      if (vis.has(id)) return 0; // guard against loops drawn by the user
      vis.add(id);
      let t = own(byId.get(id)!, cs);
      for (const k of kids(id)) t += inp(k);
      memo.set(id, t);
      return t;
    };
    const inp = (id: string) => {
      const n = byId.get(id)!;
      const e = n.type === "ups" ? +(n.eff || 0.96) : n.type === "xfmr" ? 0.985 : 1;
      return thr(id) / e;
    };
    for (const n of sld.nodes) res[n.id][cs] = thr(n.id);
  }

  for (const x of Object.values(res)) {
    x.design = Math.max(x.nl, x.a, x.b);
    x.cap = capKVA(x.n, elec);
    x.util = x.cap ? x.design / x.cap : 0;
    x.racks = racksOn[x.n.id] || [];
    const n = x.n;
    if (n.type === "xfmr" && n.kva && n.v && n.z) {
      // Walk upstream to the utility for its source impedance (on the transformer base).
      let zu = 0;
      for (let k = 0, cur = n.id; k < 6; k++) {
        const pl = sld.links.find((l) => l.to === cur);
        if (!pl) break;
        const pn = byId.get(pl.from);
        if (pn && pn.type === "utility") { if (+(pn.scc ?? 0)) zu = n.kva / (pn.scc! * 1000); break; }
        cur = pl.from;
      }
      x.isc = (n.kva * 1000) / (SQ3 * n.v * (n.z / 100 + zu)) / 1000;
    }
  }
  return res;
}

/**
 * Route every rack's ports to the nearest network rack along fiber ducts and
 * ladder trays (Dijkstra over tray segments, tray-to-tray junctions snapped
 * within `tol`, racks attached to the nearest segment within `maxDrop`).
 * Racks with no tray path fall back to a Manhattan estimate.
 */
export function cableAnalysis(s: Scenario, lib: LibIndex): CableResult {
  const c = s.cable;
  const trays = s.trays.filter((t) => (t.kind === "fiber" || t.kind === "ladder") && t.pts.length > 1);
  interface Edge { ka: string; kb: string; d: number; area: number }
  interface Seg extends TraySeg { ex: Vec[]; edges: Edge[] }
  const segs: Seg[] = [];
  for (const t of trays)
    for (let i = 0; i < t.pts.length - 1; i++) segs.push({ t, i, a: t.pts[i], b: t.pts[i + 1], ex: [], fill: 0, area: 0, edges: [] });

  const key = (p: Vec) => Math.round(p[0] * 100) + "," + Math.round(p[1] * 100);
  const adj = new Map<string, Edge[]>();
  const addE = (p: Vec, q: Vec, sg: Seg | null) => {
    const ka = key(p), kb = key(q);
    if (ka === kb) return;
    const e: Edge = { ka, kb, d: dist(p, q), area: 0 };
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka)!.push(e);
    adj.get(kb)!.push(e);
    if (sg) sg.edges.push(e);
  };

  // Junctions: a tray vertex near another tray's segment joins the two.
  for (const t of trays)
    for (const v of t.pts)
      for (const sg of segs) {
        if (sg.t === t) continue;
        const pr = proj(v, sg.a, sg.b);
        if (pr.d < c.tol) { sg.ex.push(pr.p); addE(v, pr.p, null); }
      }

  const att: Record<string, { k: string; h: number }> = {};
  for (const r of s.racks) {
    let best: { p: Vec; d: number; sg: Seg } | null = null;
    for (const sg of segs) {
      const pr = proj([r.x, r.y], sg.a, sg.b);
      if (!best || pr.d < best.d) best = { p: pr.p, d: pr.d, sg };
    }
    if (best && best.d <= c.maxDrop) { best.sg.ex.push(best.p); att[r.id] = { k: key(best.p), h: best.d }; }
  }
  for (const sg of segs) {
    const pts = [sg.a, sg.b, ...sg.ex].map((p) => ({ p, t: proj(p, sg.a, sg.b).t })).sort((x, y) => x.t - y.t);
    for (let i = 0; i < pts.length - 1; i++) addE(pts[i].p, pts[i + 1].p, sg);
  }

  const dj = new Map<string, { D: Map<string, number>; prev: Map<string, Edge> }>();
  const dijk = (src: string) => {
    const hit = dj.get(src);
    if (hit) return hit;
    const D = new Map<string, number>([[src, 0]]), prev = new Map<string, Edge>(), done = new Set<string>();
    for (;;) {
      let u: string | null = null, ud = Infinity;
      D.forEach((d, k) => { if (!done.has(k) && d < ud) { ud = d; u = k; } });
      if (u == null) break;
      const cur: string = u;
      done.add(cur);
      for (const e of adj.get(cur) || []) {
        const v = e.ka === cur ? e.kb : e.ka;
        const nd = ud + e.d;
        if (nd < (D.get(v) ?? Infinity)) { D.set(v, nd); prev.set(v, e); }
      }
    }
    const out = { D, prev };
    dj.set(src, out);
    return out;
  };

  type Path = { R: ReturnType<typeof dijk>; to: string } | null;
  const route = (r: Rack, t: Rack): { t: Rack; len: number; via: CableGroup["via"]; path: Path } => {
    if (t.id === r.id) return { t, len: 3, via: "in-rack", path: null };
    if (att[r.id] && att[t.id] && dijk(att[r.id].k).D.has(att[t.id].k)) {
      const R = dijk(att[r.id].k);
      return { t, len: (R.D.get(att[t.id].k)! + att[r.id].h + att[t.id].h + 2 * c.perEnd) * (1 + c.slack), via: "tray", path: { R, to: att[t.id].k } };
    }
    return { t, len: (Math.abs(r.x - t.x) + Math.abs(r.y - t.y) + 2 * c.perEnd) * (1 + c.slack), via: "direct", path: null };
  };
  const groups: CableGroup[] = [];
  let noPath = 0;
  const add = (from: Rack, best: ReturnType<typeof route>, net: string, link: CableGroup["link"], k: CableType, v: number) => {
    groups.push({ from, to: best.t, net, link, type: k, count: v, len: best.len, std: STD_LEN.find((x) => x >= best.len) || Math.ceil(best.len), via: best.via });
    if (!best.path) return;
    // Walk the path back, adding this group's cable cross-section to every edge.
    let cur = best.path.to, g = 0;
    const area = ((v * Math.PI) / 4) * CABLE_T[k].od ** 2;
    while (best.path.R.prev.has(cur) && g++ < 5000) {
      const e = best.path.R.prev.get(cur)!;
      e.area += area;
      cur = e.ka === cur ? e.kb : e.ka;
    }
  };

  // Each system's endpoint cables go to the nearest of the racks serving it.
  const systems = netSystems(s);
  const served = new Map<string, Rack[]>();
  const accessIn = new Map<string, Map<string, number>>(); // system → leaf rack → endpoint cables
  // Rounding carried from rack to rack per (system, cable type) when ports are spread over leaf racks.
  const carries = new Map<string, number[]>();
  const carryOf = (key: string, n: number) => carries.get(key) ?? carries.set(key, new Array(n).fill(0)).get(key)!;
  const servedBy = (sys: NetSystem) => served.get(sys.id) ?? served.set(sys.id, servedRacks(s, lib, sys)).get(sys.id)!;
  for (const r of s.racks) {
    const bySys = new Map<NetSystem, Partial<Record<CableType, number>>>();
    for (const d of r.devs) {
      const L = lib[d.lib];
      if (!L || !L.ports) continue;
      if (r.role === "network" && L.cat === "network") continue; // switches terminate, they don't uplink here
      for (const [k, v] of Object.entries(L.ports) as [CableType, number][]) {
        if (!v) continue;
        const sys = systemFor(systems, k);
        const ports = bySys.get(sys) ?? bySys.set(sys, {}).get(sys)!;
        ports[k] = (ports[k] || 0) + v;
      }
    }
    for (const [sys, ports] of bySys) {
      const targets = servedBy(sys);
      if (!targets.length) continue;
      const m = accessIn.get(sys.id) ?? accessIn.set(sys.id, new Map()).get(sys.id)!;
      if (sys.attach === "spread" && targets.length > 1) {
        // Each cable type split over every leaf rack by its leaf count.
        const w = targets.map((t) => switchesIn(t, lib, sys.id, "leaf").length);
        const routes = targets.map((t) => route(r, t));
        if (routes.some((x) => x.via === "direct")) noPath++;
        for (const [k, v] of Object.entries(ports) as [CableType, number][]) {
          apportionCarry(v, w, carryOf(sys.id + "|" + k, w.length)).forEach((c, i) => {
            if (!c) return;
            add(r, routes[i], sys.id, "access", k, c);
            m.set(targets[i].id, (m.get(targets[i].id) || 0) + c);
          });
        }
        continue;
      }
      let best: ReturnType<typeof route> | null = null;
      for (const t of targets) { const x = route(r, t); if (!best || x.len < best.len) best = x; }
      if (!best) continue;
      if (best.via === "direct") noPath++;
      for (const [k, v] of Object.entries(ports) as [CableType, number][]) add(r, best, sys.id, "access", k, v);
      m.set(best.t.id, (m.get(best.t.id) || 0) + Object.values(ports).reduce((a, v) => a + (v || 0), 0));
    }
  }
  // Leaf-to-spine uplinks, for systems with spine switches.
  for (const sys of systems) {
    const spines = spineRacks(s, lib, sys);
    if (!spines.length) continue;
    const k = sys.cables[0] ?? "fabric";
    for (const [rid, n] of accessIn.get(sys.id) ?? []) {
      const r = s.racks.find((x) => x.id === rid)!;
      for (const u of uplinks(r, n, sys, spines)) {
        const best = route(r, u.to);
        if (best.via === "direct") noPath++;
        add(r, best, sys.id, "uplink", k, u.count);
      }
    }
  }
  for (const sg of segs) {
    sg.area = sg.edges.reduce((a, e) => Math.max(a, e.area), 0);
    sg.fill = sg.area / ((+sg.t.wmm || 300) * (+sg.t.dmm || 100));
  }
  const total = groups.reduce((a, g) => a + g.count * g.len, 0), count = groups.reduce((a, g) => a + g.count, 0);
  return {
    groups, total, count, noPath,
    segs: segs.map(({ t, i, a, b, area, fill }) => ({ t, i, a, b, area, fill })),
  };
}
