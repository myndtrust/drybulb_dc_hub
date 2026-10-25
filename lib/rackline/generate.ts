// Rackline layout generator.

import { analyze } from "./analysis";
import { COOL_K } from "./constants";
import { addDevice, choosePDU, libIndex, newRack, newScenario, uid } from "./model";
import type { ElecBasis, LibItem, Redundancy, Scenario } from "./types";

export type CoolingScheme = "hac" | "rdhx" | "hac+rdhx";

export interface GenOptions {
  name: string;
  /** Compute nodes to place. */
  nodes: number;
  perRack: number;
  /** Library id of the compute node. */
  model: string;
  pattern: "pod" | "single";
  cooling: CoolingScheme;
  rackW: number;
  /** Hot / cold aisle widths (m). */
  hot: number;
  cold: number;
  /** Add a network rack in the middle of the first row. */
  net: boolean;
  red: Redundancy;
  /** Plan offset (m). */
  ox?: number;
  oy?: number;
}

export const COOLING_LABEL: Record<CoolingScheme, string> = { hac: "HAC", rdhx: "RDHx", "hac+rdhx": "HAC+RDHx" };

/**
 * Build a complete scenario: racks filled with nodes, a network rack sized
 * from the port count, containment, fiber trays + busway per row, CRAH and CDU
 * counts from the cooling basis, and PDUs auto-sized per rack.
 */
export function buildScenario(o: GenOptions, libItems: LibItem[], elec: ElecBasis): Scenario {
  const lib = libIndex(libItems);
  const s = newScenario(o.name);
  const L = lib[o.model];
  if (!L) throw new Error(`Unknown node model "${o.model}"`);
  const maxPer = Math.max(1, Math.floor((48 - 2) / L.u));
  const per = Math.min(Math.max(1, o.perRack), maxPer);
  const nRacks = Math.ceil(o.nodes / per);
  const total = nRacks + (o.net ? 1 : 0);
  const rows = o.pattern === "pod" && total > 1 ? 2 : 1;
  const perRow = Math.ceil(total / rows);
  const W = o.rackW, D = 1.2, H = o.hot;
  s.cool.red = o.red;
  const lf = s.loadFactor;

  const slots: { rI: number; i: number }[] = [];
  for (let rI = 0; rI < rows; rI++) for (let i = 0; i < perRow; i++) slots.push({ rI, i });
  const netSlot = o.net ? Math.floor(perRow / 2) : -1;
  let left = o.nodes;
  for (const sl of slots.slice(0, total)) {
    // Row 2 faces row 1 across the shared hot aisle.
    const y = sl.rI === 0 ? 0 : D + H, rotD = sl.rI === 0 ? 0 : 180, x = sl.i * W + W / 2;
    const isNet = sl.rI === 0 && sl.i === netSlot;
    const r = newRack(isNet ? "NET-01" : `R${sl.rI + 1}${String(sl.i + 1).padStart(2, "0")}`, x, y, rotD);
    if (isNet) {
      r.role = "network";
      const fab = o.nodes * (L.ports?.fabric || 8), sto = o.nodes * (L.ports?.storage || 2);
      for (let i = 0; i < Math.max(1, Math.ceil(fab / 64)); i++) addDevice(r, "leaf-800", lib, true);
      for (let i = 0; i < Math.max(1, Math.ceil(sto / 64)); i++) addDevice(r, "ns-400", lib, true);
      for (let i = 0; i < Math.max(1, Math.ceil((o.nodes * 2) / 48)); i++) addDevice(r, "mgmt-sw", lib, true);
      addDevice(r, "patch", lib, true);
      addDevice(r, "patch", lib, true);
      addDevice(r, "head", lib);
      addDevice(r, "stor", lib);
      addDevice(r, "stor", lib);
    } else {
      const k = Math.min(per, left);
      left -= k;
      for (let i = 0; i < k; i++) {
        const d = addDevice(r, o.model, lib);
        if (d && i === 0 && d.u === 1) d.u = 2; // leave U1 for a blank / cable management
      }
    }
    r.rdhx = !isNet && (o.cooling === "rdhx" || o.cooling === "hac+rdhx");
    choosePDU(r, lib, elec, lf);
    s.racks.push(r);
  }

  const rowLen = perRow * W;
  if (o.cooling === "hac" || o.cooling === "hac+rdhx")
    s.hacs.push({ id: uid(), name: "HAC-1", x: rowLen / 2, y: D / 2 + H / 2, w: rowLen, d: H, rot: 0 });

  // Fiber on the cold side, busway over the rear, one of each per row; a spine joins two rows.
  [0, D + H].slice(0, rows).forEach((y, i) => {
    const sgn = i ? -1 : 1;
    s.trays.push({ id: uid(), name: `Fiber row ${i + 1}`, kind: "fiber", wmm: 300, dmm: 100, elev: 2.9, pts: [[-0.9, y - 0.15 * sgn], [rowLen + 0.3, y - 0.15 * sgn]] });
    s.trays.push({ id: uid(), name: `Busway row ${i + 1}`, kind: "busway", wmm: 200, dmm: 150, elev: 2.6, pts: [[0, y + 0.35 * sgn], [rowLen, y + 0.35 * sgn]] });
  });
  if (rows === 2) s.trays.push({ id: uid(), name: "Fiber spine", kind: "fiber", wmm: 300, dmm: 100, elev: 2.9, pts: [[-0.9, -0.15], [-0.9, D + H + 0.15]] });

  const an = analyze(s, { lib, elec });
  const crahY = -D / 2 - o.cold - 0.45;
  for (let i = 0; i < an.crahTot; i++) {
    const k = COOL_K.crah;
    s.coolers.push({ id: uid(), name: `CRAH-${i + 1}`, kind: "crah", x: rowLen / 2 + (i - (an.crahTot - 1) / 2) * 3.2, y: crahY, w: k.w, d: k.d, rot: 180, cap: s.cool.crahKW });
  }
  for (let i = 0; i < an.cduTot; i++)
    s.coolers.push({ id: uid(), name: `CDU-${i + 1}`, kind: "cdu", x: rowLen + 1.2 + i * 0.8, y: 0, w: 0.6, d: 1.2, rot: 0, cap: s.cool.cduKW });
  if (an.rdhxN)
    s.coolers.push({ id: uid(), name: "RDHx CDU-1", kind: "rdhxcdu", x: -1.6, y: rows === 2 ? (D + H) / 2 : 0, w: 0.8, d: 1.0, rot: 90, cap: 300 });

  const ox = o.ox || 0, oy = o.oy || 0;
  for (const r of s.racks) { r.x += ox; r.y += oy; }
  for (const h of s.hacs) { h.x += ox; h.y += oy; }
  for (const c of s.coolers) { c.x += ox; c.y += oy; }
  for (const t of s.trays) t.pts = t.pts.map((p) => [p[0] + ox, p[1] + oy]);

  const cool = { hac: "hot aisle containment + CRAH", rdhx: "rear door heat exchangers", "hac+rdhx": "HAC + RDHx" }[o.cooling];
  s.notes = `${o.nodes}× ${L.name}, ${per} per rack, ${o.pattern === "pod" ? "two-row pod" : "single row"}, ${cool}`;
  return s;
}
