// Layout sweep: generate and analyse every combination of nodes-per-rack,
// arrangement and cooling scheme, and rank them. Runs on the rackline-api
// Cloud Run service (POST /v1/sweep); pure, so it is also unit-tested here.

import { analyze } from "./analysis";
import { COOLING_LABEL, buildScenario, type CoolingScheme, type GenOptions } from "./generate";
import { libIndex } from "./model";
import type { ElecBasis, LibItem, Scenario } from "./types";

export interface SweepGrid {
  perRack: number[];
  pattern: GenOptions["pattern"][];
  cooling: CoolingScheme[];
}

export interface SweepRequest {
  base: Omit<GenOptions, "name" | "perRack" | "pattern" | "cooling">;
  grid: SweepGrid;
  lib: LibItem[];
  elec: ElecBasis;
}

export interface SweepRow {
  name: string;
  perRack: number;
  pattern: GenOptions["pattern"];
  cooling: CoolingScheme;
  racks: number;
  maxRackKW: number;
  areaM2: number;
  pue: number;
  mechKW: number;
  pduWorst: number;
  cables: number;
  cableM: number;
  fails: number;
  checks: number;
  /** The generated scenario, so a chosen row can be added to the project as-is. */
  scenario: Scenario;
}

export const SWEEP_MAX_CASES = 120;

export function sweep(req: SweepRequest): SweepRow[] {
  const { grid } = req;
  const cases = grid.perRack.length * grid.pattern.length * grid.cooling.length;
  if (!cases) return [];
  if (cases > SWEEP_MAX_CASES) throw new Error(`Sweep too large: ${cases} cases (max ${SWEEP_MAX_CASES}).`);
  const lib = libIndex(req.lib);
  const rows: SweepRow[] = [];
  for (const perRack of grid.perRack)
    for (const pattern of grid.pattern)
      for (const cooling of grid.cooling) {
        const name = `${req.base.nodes}× · ${perRack}/rack · ${pattern === "pod" ? "pod" : "row"} · ${COOLING_LABEL[cooling]}`;
        const s = buildScenario({ ...req.base, name, perRack, pattern, cooling }, req.lib, req.elec);
        const a = analyze(s, { lib, elec: req.elec });
        rows.push({
          name, perRack, pattern, cooling,
          racks: a.racks.length, maxRackKW: a.maxRack, areaM2: a.area, pue: a.pue, mechKW: a.mechKW,
          pduWorst: a.pduWorst, cables: a.cab.count, cableM: a.cab.total,
          fails: a.warns.filter((w) => w.sev === "bad").length,
          checks: a.warns.filter((w) => w.sev !== "bad").length,
          scenario: s,
        });
      }
  // Passing designs first, then smallest footprint, then best PUE.
  return rows.sort((x, y) => Number(x.fails > 0) - Number(y.fails > 0) || x.areaM2 - y.areaM2 || x.pue - y.pue);
}
