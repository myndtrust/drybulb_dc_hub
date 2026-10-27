// Rackline model operations: constructors, rack fill, PDU striping and sizing.
//
// Mutators here (`addDevice`, `autoStripe`, `choosePDU`, …) edit the object
// they are given. The UI only ever calls them on a draft produced by `produce`,
// so committed state is never mutated in place; the read-only functions
// (`stripeLoads`, `occupancy`, `fits`) never mutate.

import { DEF_LIB, MAX_PDU_PAIRS, PDU_TYPES, SQ3 } from "./constants";
import type {
  CableRules, CoolingBasis, Device, ElecBasis, Electrical, ElecNode, LibItem,
  PduKey, Rack, RacklineProject, Scenario, StripeResult,
} from "./types";
import { RACKLINE_SCHEMA_VERSION } from "./types";

export type LibIndex = Record<string, LibItem>;

export const libIndex = (items: LibItem[]): LibIndex =>
  Object.fromEntries(items.map((l) => [l.id, l]));

export const uid = () => Math.random().toString(36).slice(2, 10);

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o)) as T;

/** Clone `base`, let `fn` edit the clone, return it. */
export function produce<T>(base: T, fn: (draft: T) => void): T {
  const d = clone(base);
  fn(d);
  return d;
}

export const DEFAULT_ELEC: ElecBasis = { vLL: 415, vLN: 240, pf: 0.98, derate: 0.8 };

export const DEFAULT_COOL: CoolingBasis = {
  dtF: 25, bypass: 1.3, crahKW: 120, crahCFM: 16000, crahFanKW: 6, red: "N+1",
  rdhxKW: 50, rdhxDtF: 10, cduKW: 250, cduRed: "N+1", fwDtF: 18, tcsLpm: 1.5,
  dlcRej: "drycooler", chKWton: 1.1, margin: 0.1, dryKWkW: 0.03, cduPump: 0.02,
  ambF: 95, upsEff: 0.96,
};

export const DEFAULT_CABLE: CableRules = { perEnd: 2.5, slack: 0.1, tol: 0.6, maxDrop: 3, fillMax: 0.5 };

export function newScenario(name: string): Scenario {
  return {
    id: uid(), name, notes: "", loadFactor: 1,
    racks: [], hacs: [], trays: [], coolers: [],
    electrical: defaultElectrical(),
    cool: { ...DEFAULT_COOL },
    cable: { ...DEFAULT_CABLE },
  };
}

export function newRack(name: string, x: number, y: number, rotDeg = 0): Rack {
  return {
    id: uid(), name, x, y, w: 0.6, d: 1.2, rot: rotDeg, u: 48, role: "compute", rdhx: false,
    pdu: "415-60", pduPairs: 1, feedA: "rppa", feedB: "rppb", devs: [],
  };
}

export function blankProject(name = "New project"): RacklineProject {
  const s = newScenario("Scenario A");
  return {
    schemaVersion: RACKLINE_SCHEMA_VERSION, name, units: "ft", lib: clone(DEF_LIB),
    elec: { ...DEFAULT_ELEC }, bg: null, scenarios: [s], active: s.id,
  };
}

/**
 * A generic 2N room single line with typical ratings and no site-specific
 * equipment: utility → MV switchgear → transformer → LV main switchboard →
 * UPS-A/B → RPP-A/B, plus a mechanical panel. Edit it on the Single line tab.
 */
export function defaultElectrical(): Electrical {
  const n = (id: string, type: ElecNode["type"], name: string, o: Partial<ElecNode>): ElecNode =>
    ({ id, type, name, x: 0, y: 0, ...o });
  const e: Electrical = {
    nodes: [
      n("util", "utility", "Utility service", { v: 12470, scc: 0 }),
      n("mvsw", "switch", "MV switchgear", { v: 12470, amps: 600 }),
      n("tx1", "xfmr", "Transformer T1", { kva: 2500, vp: 12470, v: 415, z: 5.75 }),
      n("msb", "swbd", "LV main switchboard", { v: 415, amps: 4000 }),
      n("upsa", "ups", "UPS-A", { v: 415, kva: 500, eff: 0.96 }),
      n("upsb", "ups", "UPS-B", { v: 415, kva: 500, eff: 0.96 }),
      n("rppa", "rpp", "RPP-A", { v: 415, amps: 400 }),
      n("rppb", "rpp", "RPP-B", { v: 415, amps: 400 }),
      n("mp1", "mech", "Mechanical panel", { v: 415, amps: 800, auto: true, kw: 0 }),
    ],
    links: ([
      ["util", "mvsw"], ["mvsw", "tx1"], ["tx1", "msb"], ["msb", "upsa"], ["upsa", "rppa"],
      ["msb", "upsb"], ["upsb", "rppb"], ["msb", "mp1"],
    ] as const).map(([from, to]) => ({ id: uid(), from, to })),
  };
  autoLayoutElectrical(e);
  return e;
}

/** Tidy tree layout: each node centred over its children, one tier per depth. */
export function autoLayoutElectrical(e: Electrical): void {
  const hasIn = new Set(e.links.map((l) => l.to));
  const seen = new Set<string>();
  let col = 0;
  const byId = new Map(e.nodes.map((n) => [n.id, n]));
  const place = (id: string, dep: number): number | null => {
    if (seen.has(id)) return null;
    seen.add(id);
    const n = byId.get(id);
    if (!n) return null;
    const kids = e.links.filter((l) => l.from === id).map((l) => place(l.to, dep + 1)).filter((v): v is number => v != null);
    n.y = dep * 140 + 20;
    n.x = kids.length ? (Math.min(...kids) + Math.max(...kids)) / 2 : col++ * 200 + 20;
    return n.x;
  };
  e.nodes.filter((n) => !hasIn.has(n.id)).forEach((n) => place(n.id, 0));
  e.nodes.filter((n) => !seen.has(n.id)).forEach((n) => place(n.id, 0));
}

// ── Rack fill ────────────────────────────────────────────────────────────────

/** Occupancy by U (index = U number); holds the device id or null. */
export function occupancy(r: Rack, lib: LibIndex): (string | null)[] {
  const occ: (string | null)[] = new Array(r.u + 2).fill(null);
  for (const d of r.devs) {
    const L = lib[d.lib];
    if (!L) continue;
    for (let k = 0; k < L.u; k++) occ[d.u + k] = d.id;
  }
  return occ;
}

export function fits(r: Rack, L: LibItem, u: number, lib: LibIndex, ignore?: string): boolean {
  if (u < 1 || u + L.u - 1 > r.u) return false;
  const occ = occupancy(r, lib);
  for (let k = 0; k < L.u; k++) {
    const o = occ[u + k];
    if (o && o !== ignore) return false;
  }
  return true;
}

/** Place a device at the lowest (or highest) free position. Returns null when full. */
export function addDevice(r: Rack, libId: string, lib: LibIndex, fromTop = false): Device | null {
  const L = lib[libId];
  if (!L) return null;
  const order: number[] = [];
  for (let u = 1; u <= r.u - L.u + 1; u++) order.push(u);
  if (fromTop) order.reverse();
  const u = order.find((u) => fits(r, L, u, lib));
  if (u == null) return null;
  const d: Device = { id: uid(), lib: libId, u, map: [] };
  r.devs.push(d);
  return d;
}

export const rackLoadKW = (r: Rack, lib: LibIndex, lf: number) =>
  r.devs.reduce((a, d) => a + (lib[d.lib]?.kw ?? 0) * lf, 0);

// ── Power striping ───────────────────────────────────────────────────────────

/**
 * Greedy balance: largest devices first, PSUs alternate A/B, each PSU goes to
 * the least-loaded PDU phase on its feed. A three-phase input (`phase3`) goes to
 * the least-loaded PDU and spreads evenly over its three phases.
 */
export function autoStripe(r: Rack, lib: LibIndex, lf: number): void {
  const n = r.pduPairs || 1;
  const load = { A: [] as number[][], B: [] as number[][] };
  for (let p = 0; p < n; p++) { load.A.push([0, 0, 0]); load.B.push([0, 0, 0]); }
  const order = [...r.devs].sort((a, b) => (lib[b.lib]?.kw || 0) - (lib[a.lib]?.kw || 0));
  for (const d of order) {
    const L = lib[d.lib];
    d.map = [];
    if (!L || !L.psu) continue;
    const np = L.psu, nA = np === 1 ? 1 : Math.ceil(np / 2), nB = np - nA, w = L.kw * 1000 * lf;
    for (let k = 0; k < np; k++) {
      const f = np === 1 || k % 2 === 0 ? "A" : "B";
      const inc = w / (f === "A" ? nA : nB);
      if (L.phase3) {
        let bp = 0;
        for (let p = 1; p < n; p++) if (sum3(load[f][p]) < sum3(load[f][bp]) - 1e-9) bp = p;
        for (let ph = 0; ph < 3; ph++) load[f][bp][ph] += inc / 3;
        d.map.push({ f, p: bp, ph: 0 });
        continue;
      }
      let best: { p: number; ph: number; v: number } | null = null;
      for (let p = 0; p < n; p++)
        for (let ph = 0; ph < 3; ph++) {
          const v = load[f][p][ph];
          if (!best || v < best.v - 1e-9) best = { p, ph, v };
        }
      load[f][best!.p][best!.ph] += inc;
      d.map.push({ f, p: best!.p, ph: best!.ph });
    }
  }
}

const sum3 = (a: number[]) => a[0] + a[1] + a[2];

export function validMap(r: Rack, lib: LibIndex): boolean {
  return r.devs.every((d) => {
    const L = lib[d.lib];
    return !L || !L.psu || (d.map && d.map.length === L.psu && d.map.every((m) => m.p < (r.pduPairs || 1)));
  });
}

/** Re-stripe any rack whose PSU map no longer matches its devices or PDUs. */
export function restripeInvalid(s: Scenario, lib: LibIndex): void {
  for (const r of s.racks) if (!validMap(r, lib)) autoStripe(r, lib, s.loadFactor || 1);
}

/** Per-phase PDU current, normal and with one feed lost. Never mutates `r`. */
export function stripeLoads(r: Rack, lib: LibIndex, elec: ElecBasis, lf: number): StripeResult {
  if (!validMap(r, lib)) { r = clone(r); autoStripe(r, lib, lf); }
  const pt = PDU_TYPES[r.pdu] || PDU_TYPES["415-60"], n = r.pduPairs || 1, V = elec.vLN, pf = elec.pf;
  const lim = pt.amps * elec.derate;
  const mk = () => Array.from({ length: n }, () => [0, 0, 0]);
  const norm = { A: mk(), B: mk() }, fail = { A: mk(), B: mk() };
  const warns: string[] = [];
  for (const d of r.devs) {
    const L = lib[d.lib];
    if (!L || !L.psu) continue;
    const w = L.kw * 1000 * lf, np = L.psu;
    const nA = d.map.filter((m) => m.f === "A").length, nB = np - nA;
    if (!nA || !nB) warns.push(`${L.name}: all PSUs on one feed`);
    if ((nB && w / nB > L.psuW) || (nA && w / nA > L.psuW)) warns.push(`${L.name}: PSU over ${L.psuW} W when one feed is lost`);
    for (const m of d.map) {
      const cnt = m.f === "A" ? nA : nB;
      if (L.phase3) {
        // Balanced 3φ input: line current = P / (√3 · V_LL · pf) on every phase.
        const k = SQ3 * elec.vLL * pf;
        for (let ph = 0; ph < 3; ph++) {
          norm[m.f][m.p][ph] += w / np / k;
          if (cnt) fail[m.f][m.p][ph] += w / cnt / k;
        }
        continue;
      }
      norm[m.f][m.p][m.ph] += w / np / (V * pf);
      if (cnt) fail[m.f][m.p][m.ph] += w / cnt / (V * pf);
    }
  }
  let maxN = 0, maxF = 0, imb = 0;
  for (const f of ["A", "B"] as const)
    for (let p = 0; p < n; p++) {
      const a = norm[f][p], b = fail[f][p];
      maxN = Math.max(maxN, ...a);
      maxF = Math.max(maxF, ...b);
      const avg = (a[0] + a[1] + a[2]) / 3;
      if (avg > 0.5) imb = Math.max(imb, (Math.max(...a) - Math.min(...a)) / avg);
    }
  const capKW = (SQ3 * elec.vLL * pt.amps * elec.derate * pf) / 1000;
  return { lim, norm, fail, maxN, maxF, util: maxF / lim, imb, capKW, warns, pdu: pt, n };
}

/** PDU types for the project's distribution voltage (all of them if none match). */
export function pduKeysFor(elec: ElecBasis): PduKey[] {
  const all = Object.keys(PDU_TYPES) as PduKey[];
  const m = all.filter((k) => PDU_TYPES[k].v === elec.vLL);
  return m.length ? m : all;
}

/**
 * Smallest PDU size × pair count that passes the feed-loss check. False if none
 * fits. Rack-scale three-phase systems may take up to MAX_PDU_PAIRS pairs.
 */
export function choosePDU(r: Rack, lib: LibIndex, elec: ElecBasis, lf: number): boolean {
  const cands: { k: PduKey; n: number; c: number }[] = [];
  const maxN = r.devs.some((d) => lib[d.lib]?.phase3) ? MAX_PDU_PAIRS : 3;
  for (const k of pduKeysFor(elec))
    for (let n = 1; n <= maxN; n++) cands.push({ k, n, c: PDU_TYPES[k].amps * n });
  cands.sort((a, b) => a.c - b.c || a.n - b.n);
  for (const c of cands) {
    r.pdu = c.k;
    r.pduPairs = c.n;
    autoStripe(r, lib, lf);
    if (stripeLoads(r, lib, elec, lf).util <= 1) return true;
  }
  return false;
}

/** Next name in a numbered series that no rack uses yet (R07 → R08). */
export function nextName(name: string, taken: string[]): string {
  const m = name.match(/^(.*?)(\d+)$/);
  if (!m) return name + "-2";
  let k = +m[2] + 1, c: string;
  do { c = m[1] + String(k).padStart(m[2].length, "0"); k++; } while (taken.includes(c));
  return c;
}
