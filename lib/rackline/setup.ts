// What a layout generator leaves behind for later editing: its answers (so
// "Edit setup" reopens with them), a fingerprint that tells whether the user has
// changed the result since, and the small automatic helpers the Layout tab uses
// when the user extends a generated layout by hand (each one only proposes;
// everything it sets stays editable on its tab).

import { canon } from "./changes";
import { uid } from "./model";
import type { Cooler, CoolerKind, Rack, Scenario, ScenarioSetup } from "./types";

/** Short stable hash of a string (FNV-1a, 32-bit). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** Fingerprint of everything a generator builds: layout, single line, networks, cooling basis. */
export const fingerprint = (s: Scenario) =>
  hash(canon({ racks: s.racks, hacs: s.hacs, trays: s.trays, coolers: s.coolers, electrical: s.electrical, nets: s.nets ?? null, cool: s.cool }));

export const makeSetup = (kind: ScenarioSetup["kind"], options: object, s: Scenario): ScenarioSetup =>
  ({ kind, options: JSON.parse(JSON.stringify(options)), built: fingerprint(s), at: new Date().toISOString() });

/** True once the scenario differs from what its generator built. */
export const editedSinceSetup = (s: Scenario) => !!s.setup && s.setup.built !== fingerprint(s);

const fed = (s: Scenario, r: Rack) => {
  const ids = new Set(s.electrical.nodes.map((n) => n.id));
  return !!r.feedA && !!r.feedB && ids.has(r.feedA) && ids.has(r.feedB);
};

/**
 * The rack to copy feeds from for `r`: the nearest fed rack of the same role,
 * else the nearest fed rack. Null when no rack is fed.
 */
export function feedSource(s: Scenario, r: Rack): Rack | null {
  const cand = s.racks.filter((x) => x.id !== r.id && fed(s, x));
  if (!cand.length) return null;
  const d = (x: Rack) => Math.hypot(x.x - r.x, x.y - r.y) + (x.role === r.role ? 0 : 1000);
  return cand.reduce((a, x) => (d(x) < d(a) ? x : a));
}

/** Give `r` the A/B feeds of its nearest like rack. Returns that rack, or null if none is fed. */
export function autoFeed(s: Scenario, r: Rack): Rack | null {
  const src = feedSource(s, r);
  if (src) { r.feedA = src.feedA; r.feedB = src.feedB; }
  return src;
}

/** Racks with IT load whose A or B feed is missing or points at nothing. */
export function unfedRacks(s: Scenario, itOf: (r: Rack) => number): Rack[] {
  const ids = new Set(s.electrical.nodes.map((n) => n.id));
  return s.racks.filter((r) => itOf(r) > 0 && (!r.feedA || !r.feedB || !ids.has(r.feedA) || !ids.has(r.feedB)));
}

/** Place `n` more cooling units of `kind` in a line after the last one of that kind (or near the racks). */
export function addCoolers(s: Scenario, kind: CoolerKind, n: number, w: number, d: number, cap: number): Cooler[] {
  const same = s.coolers.filter((c) => c.kind === kind);
  const last = same[same.length - 1];
  const prefix = kind === "cdu" ? "CDU" : kind === "crah" ? "CRAH" : kind.toUpperCase();
  let x: number, y: number, rot: number;
  if (last) { x = last.x + last.w; y = last.y; rot = last.rot; }
  else {
    const xs = s.racks.map((r) => r.x), ys = s.racks.map((r) => r.y);
    x = xs.length ? Math.max(...xs) + 1.5 : 0; y = ys.length ? Math.min(...ys) : 0; rot = 0;
  }
  const out: Cooler[] = [];
  for (let i = 0; i < n; i++) {
    const c: Cooler = { id: uid(), name: `${prefix}-${same.length + i + 1}`, kind, x: x + i * w, y, w, d, rot, cap };
    s.coolers.push(c);
    out.push(c);
  }
  return out;
}
