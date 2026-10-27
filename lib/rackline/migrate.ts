// Load-time normalisation for Rackline documents: saved rows, imported JSON
// files, and project files exported from the original single-page prototype.
// Missing sections are filled with defaults; a document from a newer schema is
// refused rather than silently downgraded.

import { DEF_LIB } from "./constants";
import { DEFAULT_CABLE, DEFAULT_COOL, DEFAULT_ELEC, clone, defaultElectrical } from "./model";
import type { Electrical, RacklineProject, Scenario } from "./types";
import { RACKLINE_SCHEMA_VERSION } from "./types";

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export class RacklineDocError extends Error {}

export function migrateProject(doc: unknown): RacklineProject {
  if (!isObj(doc) || !Array.isArray(doc.scenarios) || doc.scenarios.length === 0)
    throw new RacklineDocError("That file is not a project export from this tool.");
  const ver = typeof doc.schemaVersion === "number" ? doc.schemaVersion : 0;
  if (ver > RACKLINE_SCHEMA_VERSION)
    throw new RacklineDocError(`This project was saved by a newer version of this tool (schema ${ver}). Reload the page to update.`);

  const scenarios: Scenario[] = (doc.scenarios as unknown[]).filter(isObj).map((raw) => {
    // v0 (prototype export) kept the single line under `sld`.
    const elecRaw = (isObj(raw.electrical) ? raw.electrical : isObj(raw.sld) ? raw.sld : null) as Electrical | null;
    const electrical: Electrical = elecRaw && Array.isArray(elecRaw.nodes)
      ? { nodes: arr(elecRaw.nodes), links: arr(elecRaw.links) }
      : defaultElectrical();
    return {
      id: String(raw.id ?? Math.random().toString(36).slice(2, 10)),
      name: String(raw.name ?? "Scenario"),
      notes: String(raw.notes ?? ""),
      loadFactor: typeof raw.loadFactor === "number" && raw.loadFactor > 0 ? raw.loadFactor : 1,
      racks: arr(raw.racks),
      hacs: arr(raw.hacs),
      trays: arr(raw.trays),
      coolers: arr(raw.coolers),
      electrical,
      cool: { ...DEFAULT_COOL, ...(isObj(raw.cool) ? raw.cool : {}) },
      cable: { ...DEFAULT_CABLE, ...(isObj(raw.cable) ? raw.cable : {}) },
      ...(Array.isArray(raw.nets) && raw.nets.length ? { nets: arr(raw.nets) } : {}),
      ...(isObj(raw.setup) && isObj(raw.setup.options) ? { setup: raw.setup } : {}),
    } as Scenario;
  });
  if (!scenarios.length) throw new RacklineDocError("That file is not a project export from this tool.");

  // A background whose file lived elsewhere (prototype asset ids) can't be fetched here.
  const bg = isObj(doc.bg) ? (clone(doc.bg) as unknown as RacklineProject["bg"]) : null;
  if (bg) delete (bg as unknown as Loose).asset;

  const active = scenarios.some((s) => s.id === doc.active) ? String(doc.active) : scenarios[0].id;
  return {
    schemaVersion: RACKLINE_SCHEMA_VERSION,
    name: String(doc.name ?? "Untitled project"),
    units: doc.units === "m" ? "m" : "ft",
    lib: Array.isArray(doc.lib) && doc.lib.length ? (doc.lib as RacklineProject["lib"]) : clone(DEF_LIB),
    elec: { ...DEFAULT_ELEC, ...(isObj(doc.elec) ? doc.elec : {}) },
    bg,
    scenarios,
    active,
  };
}
