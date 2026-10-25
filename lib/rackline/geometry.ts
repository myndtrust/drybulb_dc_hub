// Plan geometry helpers (metres, degrees clockwise in screen space).

import type { Rack, Scenario, Vec } from "./types";

export const dist = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function rot(p: Vec, deg: number): Vec {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/** Closest point on segment ab to p, with its parameter t and distance. */
export function proj(p: Vec, a: Vec, b: Vec): { p: Vec; t: number; d: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  const q: Vec = [a[0] + t * dx, a[1] + t * dy];
  return { p: q, t, d: dist(p, q) };
}

/** Is p inside a rotated rectangle centred at (x, y), grown by margin m? */
export function inRect(
  p: Vec,
  o: { x: number; y: number; w: number; d: number; rot: number },
  m = 0,
): boolean {
  const q = rot([p[0] - o.x, p[1] - o.y], -(o.rot || 0));
  return Math.abs(q[0]) <= o.w / 2 + m && Math.abs(q[1]) <= o.d / 2 + m;
}

/** A point just behind the rack's rear face. */
export function rackRear(r: Rack, off = 0.15): Vec {
  const q = rot([0, r.d / 2 + off], r.rot || 0);
  return [r.x + q[0], r.y + q[1]];
}

/** Rectangle corners of a rotated footprint. */
export function corners(o: { x: number; y: number; w: number; d: number; rot: number }): Vec[] {
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Vec[]).map(([a, b]) => {
    const q = rot([(a * o.w) / 2, (b * o.d) / 2], o.rot || 0);
    return [o.x + q[0], o.y + q[1]] as Vec;
  });
}

export const polyLength = (pts: Vec[]) =>
  pts.reduce((a, p, i) => (i ? a + dist(p, pts[i - 1]) : a), 0);

export interface RackRow {
  rot: number;
  vert: boolean;
  key: number;
  racks: Rack[];
  name: string;
}

/**
 * Rows derived from the plan: racks with the same rotation whose fronts line up
 * (within 0.3 m) form one row. Racks are ordered left to right as seen standing
 * at the face being viewed.
 */
export function rackRows(s: Scenario, face: "front" | "rear"): RackRow[] {
  const rows: RackRow[] = [];
  for (const r of s.racks) {
    const ro = (((r.rot || 0) % 360) + 360) % 360;
    const vert = ro % 180 !== 0;
    const key = vert ? r.x : r.y;
    let w = rows.find((w) => w.rot === ro && Math.abs(w.key - key) < 0.3);
    if (!w) { w = { rot: ro, vert, key, racks: [], name: "" }; rows.push(w); }
    w.racks.push(r);
  }
  for (const w of rows) {
    const f = rot([0, face === "rear" ? -1 : 1], w.rot), right = rot(f, 90);
    w.racks.sort((a, b) => a.x * right[0] + a.y * right[1] - (b.x * right[0] + b.y * right[1]));
  }
  rows.sort((a, b) => Number(a.vert) - Number(b.vert) || a.key - b.key);
  rows.forEach((w, i) => {
    const plan = [...w.racks].sort((a, b) => (w.vert ? a.y - b.y : a.x - b.x));
    w.name = `Row ${i + 1} · ${plan[0].name}${plan.length > 1 ? "–" + plan[plan.length - 1].name : ""}`;
  });
  return rows;
}
