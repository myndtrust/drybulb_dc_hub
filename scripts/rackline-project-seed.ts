/**
 * Build a Rackline project and its Supabase seed SQL from a project spec.
 *
 *   npx tsx scripts/rackline-project-seed.ts <spec.json> [--out <dir>]
 *
 * Writes, next to the spec (or into --out):
 *   <name>.rackline.json   — the project document (importable via File ▸ Import)
 *   <name>.seed.sql        — idempotent insert into public.rackline_projects,
 *                            owned by the spec's owner email
 *
 * Customer specs and outputs are confidential: keep them in the customer's
 * folder, never in this repo. This script holds no customer data.
 * Used by the `rackline-project-seed` skill (.claude/skills/rackline-project-seed).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { analyze } from "../lib/rackline/analysis";
import { DEF_LIB, ELEC_T, FEEDABLE } from "../lib/rackline/constants";
import { buildScenario, type GenOptions } from "../lib/rackline/generate";
import { DEFAULT_ELEC, autoLayoutElectrical, clone, defaultElectrical, libIndex, uid } from "../lib/rackline/model";
import { migrateProject } from "../lib/rackline/migrate";
import type { CoolingBasis, ElecBasis, ElecNode, ElecType, Electrical, LibItem, RacklineProject, Units } from "../lib/rackline/types";

export interface ProjectSpec {
  /** Project name as it appears in Rackline (e.g. "acme_base"). */
  name: string;
  /** Account that owns the project. Default: Drybulb staff (eric@drybulb.com). */
  owner?: string;
  /** "admin" = staff-only reference (default); "customer" = meant to be shared via Share. */
  access?: "admin" | "customer";
  units?: Units;
  /** Free-text prefix added to every scenario's notes (site, client, sources). */
  notes?: string;
  library?: {
    /** Catalog ids to include (see DEF_LIB). Default: the whole catalog. */
    catalog?: string[];
    /** Extra devices, e.g. a client's specified server. Ids must not clash with the catalog. */
    custom?: LibItem[];
  };
  /** Room single line. Omit for the generic 2N default. Links are [from, to] node-id pairs. */
  electrical?: { nodes: (Omit<ElecNode, "x" | "y"> & { x?: number; y?: number })[]; links: [string, string][] };
  /** Node ids the racks' A and B PDUs feed from. Default: rppa / rppb. */
  feeds?: { a: string; b: string };
  elec?: Partial<ElecBasis>;
  cooling?: Partial<CoolingBasis>;
  /** One generated layout per entry (same options as Layout ▸ Generate layout). */
  scenarios: (Partial<Omit<GenOptions, "name">> & { name: string; nodes: number; model: string; perRack: number })[];
}

const DEFAULT_OWNER = "eric@drybulb.com";
const EMAIL_RE = /^[^\s@']+@[^\s@']+\.[^\s@']+$/;

function fail(msg: string): never {
  console.error("✖ " + msg);
  process.exit(1);
}

export function buildProject(spec: ProjectSpec): RacklineProject {
  if (!spec.name?.trim()) fail("spec.name is required");
  if (!Array.isArray(spec.scenarios) || !spec.scenarios.length) fail("spec.scenarios needs at least one scenario");

  // Library: catalog picks + custom devices.
  const pick = spec.library?.catalog;
  const unknown = (pick ?? []).filter((id) => !DEF_LIB.some((l) => l.id === id));
  if (unknown.length) fail(`unknown catalog ids: ${unknown.join(", ")}. Known: ${DEF_LIB.map((l) => l.id).join(", ")}`);
  const lib: LibItem[] = clone(pick ? DEF_LIB.filter((l) => pick.includes(l.id)) : DEF_LIB);
  // The generator's network rack uses these; keep them even if not picked.
  for (const id of ["leaf-800", "ns-400", "mgmt-sw", "patch", "head", "stor"])
    if (!lib.some((l) => l.id === id)) lib.push(clone(DEF_LIB.find((l) => l.id === id)!));
  for (const c of spec.library?.custom ?? []) {
    if (!c.id || lib.some((l) => l.id === c.id)) fail(`custom device id "${c.id}" is missing or clashes with the catalog`);
    if (!(c.u >= 1) || !(c.kw >= 0) || !(c.psu >= 0) || !(c.liq >= 0 && c.liq <= 1)) fail(`custom device "${c.id}" has invalid u / kw / psu / liq`);
    lib.push({ ...c, ports: c.ports ?? {} });
  }

  // Single line.
  let electrical: Electrical;
  if (spec.electrical) {
    const ids = new Set<string>();
    for (const n of spec.electrical.nodes) {
      if (!n.id || ids.has(n.id)) fail(`single-line node id "${n.id}" is missing or duplicated`);
      if (!(n.type in ELEC_T)) fail(`single-line node "${n.id}" has unknown type "${n.type}". Types: ${Object.keys(ELEC_T).join(", ")}`);
      ids.add(n.id);
    }
    for (const [a, b] of spec.electrical.links) if (!ids.has(a) || !ids.has(b)) fail(`link ${a} → ${b} refers to an unknown node`);
    electrical = {
      nodes: spec.electrical.nodes.map((n) => ({ x: 0, y: 0, ...n })),
      links: spec.electrical.links.map(([from, to]) => ({ id: uid(), from, to })),
    };
    autoLayoutElectrical(electrical);
  } else electrical = defaultElectrical();

  const feeds = spec.feeds ?? { a: "rppa", b: "rppb" };
  for (const f of [feeds.a, feeds.b]) {
    const n = electrical.nodes.find((x) => x.id === f);
    if (!n) fail(`feed "${f}" is not a single-line node (set spec.feeds)`);
    if (!FEEDABLE.includes(n.type as ElecType)) fail(`feed "${f}" is a ${n.type}; racks can feed from ${FEEDABLE.join(", ")}`);
  }

  const elec = { ...DEFAULT_ELEC, ...spec.elec };
  const scenarios = spec.scenarios.map((sc) => {
    if (!lib.some((l) => l.id === sc.model && l.cat === "compute")) fail(`scenario "${sc.name}": model "${sc.model}" is not a compute device in the library`);
    const s = buildScenario({
      pattern: "pod", cooling: "hac", rackW: 0.6, hot: 1.2, cold: 1.2, net: true, red: "N+1", ox: 3, oy: 4, ...sc,
    }, lib, elec);
    s.electrical = clone(electrical);
    s.cool = { ...s.cool, ...spec.cooling };
    for (const r of s.racks) { r.feedA = feeds.a; r.feedB = feeds.b; }
    if (spec.notes) s.notes = `${spec.notes.trim()} ${s.notes}`;
    return s;
  });

  return migrateProject({
    schemaVersion: 1, name: spec.name.trim(), units: spec.units ?? "ft", lib, elec, bg: null, scenarios, active: scenarios[0].id,
  });
}

export function seedSql(p: RacklineProject, owner: string, access: "admin" | "customer", specFile: string): string {
  if (!EMAIL_RE.test(owner)) fail(`owner "${owner}" is not a valid email`);
  const name = p.name.replace(/'/g, "''");
  const doc = JSON.stringify(p).replace(/'/g, "''");
  const accessNote = access === "admin"
    ? `-- ADMIN ACCESS ONLY: owned by ${owner} and shared with no one, so only the owner
-- and Drybulb staff can open it. Do not use Share on it; to give a customer a
-- version, open it, "Save as new", rename, and share the copy.`
    : `-- CUSTOMER PROJECT: owned by ${owner}. Share it from Rackline (Share ▸ invite);
-- Drybulb staff can invite the customer as Owner to hand it over.`;
  return `-- Seed the "${p.name}" Rackline project. Generated from ${basename(specFile)} by
-- scripts/rackline-project-seed.ts on ${new Date().toISOString().slice(0, 10)}.
-- Customer-confidential: keep this file in the customer's folder, not the website repo.
-- Run in the Supabase SQL editor AFTER docs/rackline/rackline-projects.sql, and after
-- ${owner} has signed in to drybulb.com at least once. Safe to run twice.
${accessNote}
insert into public.rackline_projects (user_id, name, doc, schema_version)
select u.id, '${name}', '${doc}'::jsonb, ${p.schemaVersion}
from auth.users u
where lower(u.email) = lower('${owner}')
  and not exists (select 1 from public.rackline_projects p where p.name = '${name}' and p.user_id = u.id);

-- Verify (0 rows ⇒ the owner hasn't signed in yet):
-- select p.id, p.name, m.email, m.role from public.rackline_projects p
--   join public.rackline_project_members m on m.project_id = p.id where p.name = '${name}';
`;
}

function main() {
  const args = process.argv.slice(2);
  const specPath = args.find((a) => !a.startsWith("--"));
  if (!specPath) fail("usage: npx tsx scripts/rackline-project-seed.ts <spec.json> [--out <dir>]");
  const oi = args.indexOf("--out");
  const file = resolve(specPath);
  const outDir = oi >= 0 && args[oi + 1] ? resolve(args[oi + 1]) : dirname(file);
  if (resolve(outDir).startsWith(resolve(join(__dirname, "..")))) fail("refusing to write customer outputs inside the website repo; use --out <customer folder>");

  let spec: ProjectSpec;
  try { spec = JSON.parse(readFileSync(file, "utf8")); } catch (e) { fail(`can't read spec: ${(e as Error).message}`); }
  const project = buildProject(spec);
  const owner = spec.owner ?? DEFAULT_OWNER;
  const access = spec.access ?? "admin";

  mkdirSync(outDir, { recursive: true });
  const safe = project.name.replace(/[^\w.-]+/g, "_");
  writeFileSync(join(outDir, `${safe}.rackline.json`), JSON.stringify(project, null, 1));
  writeFileSync(join(outDir, `${safe}.seed.sql`), seedSql(project, owner, access, file));

  // Summary for the reviewer.
  const lib = libIndex(project.lib);
  console.log(`✔ ${project.name} → ${outDir}`);
  console.log(`  owner ${owner} · access ${access} · ${project.lib.length} library items · ${project.scenarios.length} scenarios`);
  for (const s of project.scenarios) {
    const a = analyze(s, { lib, elec: project.elec });
    const fails = a.warns.filter((w) => w.sev === "bad");
    console.log(`  · ${s.name}: ${a.racks.length} racks, ${a.it.toFixed(1)} kW IT, max ${a.maxRack.toFixed(1)} kW/rack, PUE ${a.pue.toFixed(2)}, ${fails.length} fail / ${a.warns.length - fails.length} check`);
    for (const w of fails) console.log(`      FAIL ${w.msg}`);
  }
}

if (process.argv[1] && basename(process.argv[1]).startsWith("rackline-project-seed")) main();
