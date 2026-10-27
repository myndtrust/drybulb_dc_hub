// Change requests, change by change. An editor's proposal is compared with the
// version they started from (base) to find what THEY changed, and with the owner's
// current version to skip what is already there and flag what the owner changed
// too. The owner applies any subset onto their current version (a 3-way merge at
// the level of whole items: a rack, a tray, a library entry, a scenario's
// settings…), so accepting one change never drags the rest of the file along.
// The project name is never part of a change: it belongs to the owner.

import { clone, libIndex, restripeInvalid } from "./model";
import type { RacklineProject, Scenario } from "./types";

export type ChangeKind = "added" | "removed" | "changed";

export interface Change {
  key: string;
  /** "Project" or the scenario's name. */
  group: string;
  label: string;
  kind: ChangeKind;
  /** The owner changed this too since the editor started; accepting replaces the owner's edit. */
  conflict: boolean;
  /** Can't apply: its scenario no longer exists in the owner's version. */
  blocked: boolean;
}

/** Same value? Key order differs after a jsonb round trip, so compare canonically. */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x) ?? "undefined";
}
const eq = (a: unknown, b: unknown) => canon(a) === canon(b);

/** Same design, ignoring the name (the owner's) and which scenario is showing (view state). */
export const sameDesign = (a: RacklineProject, b: RacklineProject) =>
  eq({ ...a, name: "", active: "" }, { ...b, name: "", active: "" });

interface Unit {
  key: string;
  group: string;
  noun: string;
  get: (d: RacklineProject) => unknown;
  /** Write `v` (undefined = remove). False if the target has nowhere to put it. */
  set: (d: RacklineProject, v: unknown) => boolean;
  named?: boolean;
}

interface Keyed { id: string; name?: string }

function listUnit<T extends Keyed>(
  key: string, group: string, noun: string, id: string,
  list: (d: RacklineProject) => T[] | undefined,
): Unit {
  return {
    key, group, noun, named: true,
    get: (d) => list(d)?.find((x) => x.id === id),
    set: (d, v) => {
      const l = list(d);
      if (!l) return false;
      const i = l.findIndex((x) => x.id === id);
      if (v === undefined) { if (i >= 0) l.splice(i, 1); }
      else if (i >= 0) l[i] = v as T;
      else l.push(v as T);
      return true;
    },
  };
}

const ids = <T extends Keyed>(...lists: (T[] | undefined)[]) => [...new Set(lists.flatMap((l) => (l ?? []).map((x) => x.id)))];
const scn = (d: RacklineProject, id: string) => d.scenarios.find((s) => s.id === id);

const SCN_LISTS = [
  ["racks", "Rack"], ["hacs", "Containment"], ["trays", "Tray"], ["coolers", "Cooler"],
] as const;
const SCN_FIELDS = [["cool", "Cooling basis"], ["cable", "Cable rules"], ["nets", "Network systems"], ["setup", "Setup answers"]] as const;

function units(docs: RacklineProject[]): Unit[] {
  const out: Unit[] = [];
  const P = "Project";
  out.push({ key: "units", group: P, noun: "Units", get: (d) => d.units, set: (d, v) => { d.units = v as RacklineProject["units"]; return true; } });
  out.push({ key: "elec", group: P, noun: "Electrical basis", get: (d) => d.elec, set: (d, v) => { d.elec = v as RacklineProject["elec"]; return true; } });
  out.push({ key: "bg", group: P, noun: "Background drawing", get: (d) => d.bg ?? undefined, set: (d, v) => { d.bg = (v as RacklineProject["bg"]) ?? null; return true; } });
  for (const id of ids(...docs.map((d) => d.lib))) out.push(listUnit(`lib:${id}`, "Equipment library", "Library item", id, (d) => d.lib));

  for (const sid of ids(...docs.map((d) => d.scenarios))) {
    const name = docs.map((d) => scn(d, sid)?.name).find(Boolean) ?? "Scenario";
    const g = `Scenario: ${name}`;
    out.push({
      key: `scn:${sid}`, group: g, noun: "Scenario", named: true,
      get: (d) => scn(d, sid),
      set: (d, v) => {
        const i = d.scenarios.findIndex((s) => s.id === sid);
        if (v === undefined) {
          if (i >= 0 && d.scenarios.length > 1) d.scenarios.splice(i, 1);
          else if (i >= 0) return false; // never remove the last scenario
        } else if (i >= 0) d.scenarios[i] = v as Scenario;
        else d.scenarios.push(v as Scenario);
        return true;
      },
    });
    const inScn = (d: RacklineProject) => scn(d, sid);
    out.push({
      key: `scn:${sid}:settings`, group: g, noun: "Scenario settings",
      get: (d) => { const s = inScn(d); return s && { name: s.name, notes: s.notes, loadFactor: s.loadFactor }; },
      set: (d, v) => { const s = inScn(d); if (!s || !v) return false; Object.assign(s, v); return true; },
    });
    for (const [f, noun] of SCN_FIELDS) {
      out.push({
        key: `scn:${sid}:${f}`, group: g, noun,
        get: (d) => inScn(d)?.[f],
        set: (d, v) => { const s = inScn(d); if (!s || !v) return false; (s as unknown as Record<string, unknown>)[f] = v; return true; },
      });
    }
    for (const [f, noun] of SCN_LISTS) {
      for (const id of ids(...docs.map((d) => scn(d, sid)?.[f] as Keyed[] | undefined))) {
        out.push(listUnit(`scn:${sid}:${f}:${id}`, g, noun, id, (d) => inScn(d)?.[f] as Keyed[] | undefined));
      }
    }
    for (const id of ids(...docs.map((d) => scn(d, sid)?.electrical.nodes))) {
      out.push(listUnit(`scn:${sid}:node:${id}`, g, "Single-line item", id, (d) => inScn(d)?.electrical.nodes));
    }
    for (const id of ids(...docs.map((d) => scn(d, sid)?.electrical.links))) {
      out.push({ ...listUnit(`scn:${sid}:link:${id}`, g, "Single-line connection", id, (d) => inScn(d)?.electrical.links), named: false });
    }
  }
  return out;
}

const FIELD_WORDS: Record<string, string> = {
  x: "moved", y: "moved", pts: "moved", rot: "rotated", w: "resized", d: "resized", u: "height",
  devs: "equipment", name: "renamed", feedA: "feeds", feedB: "feeds", pdu: "PDUs", pduPairs: "PDUs", elev: "elevation",
};

function describe(u: Unit, b: unknown, p: unknown, kind: ChangeKind): string {
  const item = (b ?? p) as Keyed | undefined;
  const title = u.named && item?.name ? `${u.noun} “${(p as Keyed | undefined)?.name ?? item.name}”` : u.noun;
  if (kind !== "changed") return `${title} ${kind}`;
  if (u.named && b && p && typeof b === "object" && typeof p === "object" && u.noun !== "Scenario") {
    const keys = [...new Set([...Object.keys(b), ...Object.keys(p)])]
      .filter((k) => !eq((b as Record<string, unknown>)[k], (p as Record<string, unknown>)[k]));
    const words = [...new Set(keys.map((k) => FIELD_WORDS[k] ?? k))];
    if (words.length) return `${title}: ${words.join(", ")}`;
  }
  return `${title} changed`;
}

/**
 * What the editor changed (base → proposed) that isn't already in `current`.
 * Without a base (requests sent before bases were recorded) the owner's current
 * version stands in for it.
 */
export function diffChanges(base: RacklineProject | null, proposed: RacklineProject, current: RacklineProject): Change[] {
  const B = base ?? current;
  const out: Change[] = [];
  const scnAdded = new Set<string>();
  for (const u of units([B, proposed, current])) {
    // A scenario that was added or removed is one change, not one per rack in it.
    const sid = u.key.startsWith("scn:") ? u.key.split(":")[1] : null;
    if (sid && u.key !== `scn:${sid}` && scnAdded.has(sid)) continue;
    const b = u.get(B), p = u.get(proposed), c = u.get(current);
    if (u.key === `scn:${sid}`) {
      if (b !== undefined && p !== undefined) continue; // in both: compared item by item below
      if (sid) scnAdded.add(sid);
    }
    if (eq(b, p) || eq(c, p)) continue;
    const kind: ChangeKind = b === undefined ? "added" : p === undefined ? "removed" : "changed";
    const blocked = !u.set(clone(current), p === undefined ? undefined : clone(p));
    out.push({ key: u.key, group: u.group, label: describe(u, b, p, kind), kind, conflict: !eq(c, b), blocked });
  }
  return out;
}

/** The owner's current version with the chosen changes from `proposed` applied. */
export function applyChanges(
  base: RacklineProject | null, proposed: RacklineProject, current: RacklineProject, keys: Iterable<string>,
): RacklineProject {
  const want = new Set(keys);
  const d = clone(current);
  for (const u of units([base ?? current, proposed, current])) {
    if (!want.has(u.key)) continue;
    const p = u.get(proposed);
    u.set(d, p === undefined ? undefined : clone(p));
  }
  if (!d.scenarios.some((s) => s.id === d.active)) d.active = d.scenarios[0].id;
  const lib = libIndex(d.lib);
  for (const s of d.scenarios) restripeInvalid(s, lib);
  d.name = current.name;
  return d;
}
