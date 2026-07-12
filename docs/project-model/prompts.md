# Project Object Model — implementation prompt playbook

A phased set of prompts for building the **shared Project object model**: one common data
structure for all objects in a project, shared across every Drybulb tool (PUE calculator,
Cost Model, Single-line editor, and future discipline tools). **The reason this exists is
to have a single source of truth for the bill of materials** — one authoritative list of
the physical objects in the project (what, how many, which product, which interfaces),
which every tool reads and which each discipline tool populates for its own domain. End
state: the same objects exist across all tools, any CRUD propagates between them, and the
app manages the dependencies and interface specs across data-center facility systems —
making change management and system-level optimization easy.

## How to use this playbook

- Run **one phase per Claude session**, in order. Each phase is independently shippable.
- For each phase, paste the **Architecture brief** section below, then the phase prompt.
- Every phase must end with `npx tsc --noEmit` and `npx next build` green before it is
  considered done. Do not commit or deploy unless you (the user) explicitly ask.
- Phases 1–2 are invisible (pure libraries + tests). Phase 3 is the first visible change.

---

## Architecture brief (paste this with every phase prompt)

> **Context for Claude.** This repo is drybulb.com, a Next.js app (NOTE: `AGENTS.md` warns
> this Next.js version has breaking changes — read the relevant guide in
> `node_modules/next/dist/docs/` before writing framework-specific code). It has three
> tools that today keep private copies of the same facts:
>
> - **PUE calculator** — `app/(app)/dashboard/tools/pue-calculator/page.tsx`, logic in
>   `lib/pue/` (`PUEInputs`, `CoolingType`, `HourlyWeather` 8,760-hr vectors, hourly engine
>   `calculateHourlyPUE`). Saves to Supabase table `pue_models` via `lib/pue/saved-models.ts`.
> - **Cost Model** — `app/(app)/dashboard/tools/cost-model/page.tsx`, logic in `lib/cost/`
>   (`LocationConfig` per-site record, `CostInputs = { locations }`, pure `computePortfolio`,
>   equipment catalog `lib/cost/catalog.ts` keyed by `catalogKey`). Saves to Supabase table
>   `cost_models` via `lib/cost/saved-models.ts` (browser client + RLS owner-only).
> - **Single-line editor** — `app/(app)/dashboard/tools/single-line/page.tsx`,
>   `components/factory/single-line-editor.tsx`, logic in `lib/factory/` (`SldGraph` diagram
>   graph in `sld.ts`; rollup/AutoBuild adapters in `project.ts`; sizing engine in
>   `topology.ts`; generated spec data `rack-specs.gen.ts` / `network-specs.gen.ts` /
>   `reference-architectures.gen.ts`). Saves whole topologies to localStorage key
>   `"sld.app.topologies"` and reusable groups to Supabase `single_line_groups` via
>   `lib/factory/groups.ts`.
> - **Shared already:** `lib/energy/types.ts` (`CoolingConfig`, `ServiceChannel` with 8,760-hr
>   demand vectors, `PricingParams`) is imported by both PUE and Cost; `catalogKey` strings
>   join SLD nodes, sizing schedules, and RA BOMs to the cost equipment catalog.
>
> **The feature being built: a three-tier `ProjectDoc`**, one jsonb document per project in
> a new Supabase `projects` table (same browser-client + RLS pattern as `cost_models` and
> `docs/ai-factory/single-line-groups.sql`):
>
> 1. **`SiteRecord.shared`** — the ONE authoritative copy of cross-tool scalars per site:
>    `stationId` (TMY3), `itCapacityKW`, `kwPerRack`, `rackCount`, `raKey`,
>    `cooling: CoolingConfig` (reuse `lib/energy/types.ts` verbatim), `upsType`, redundancy,
>    and `domainSource: Partial<Record<EntityDomain, string>>` (per-domain authority flags,
>    e.g. `{ power: "sld" }`; absent = manual).
> 2. **Canonical entity graph** (`ProjectGraph`) — **this is the project's single source
>    of truth for the bill of materials.** Every physical object as a typed,
>    qty-aggregated `Entity` (one "rack" entity with `attrs.qty = 512`, not 512 nodes) with
>    `kind` (source|distribution|payload|workload|space), `domain`
>    (power|cooling|network|compute|workload|space), `catalogKey`, optional interface specs
>    (`RackPower`/`RackCooling` from `lib/factory/rack-specs.gen.ts`), and typed `Relation`
>    edges (`powers|cools|connects|contains|runs-on`). This is a promotion of the existing
>    `lib/factory/schema.ts` (`FactoryGraph`/`FNode`/`FEdge` + `validateGraph`) — which no
>    code imports today, so the move is free. Pricing is NOT stored on entities — it joins
>    in via `catalogKey` from the equipment catalog (`lib/cost/catalog.ts`), so
>    BOM = entities (qty) × catalog (unit data). The Cost Model's own itemized BOM state
>    (`componentCosts`/`categoryMode` in `LocationConfig`) is a parallel BOM today; the end
>    state is that it *derives from* the canonical entities for domains that have a
>    discipline model (Phase 4), rather than being independently editable truth.
> 3. **Per-tool facets** — each tool's full existing input document stored **verbatim**
>    (`SavedCostInputs`, PUE `SavedModelInputs` per site, `SldGraph` per site), keyed by
>    tool id. This is what keeps every tool working unchanged; adapters must pass unknown
>    facet keys through untouched (spread, don't reconstruct).
>
> **Per-domain authority (the core rule).** Each discipline model is authoritative for the
> entities in its own domain: power single-line → `power`; a future cooling-plant model →
> `cooling`; network plant → `network`; IT hardware BOM → `compute`. On save, a discipline
> tool rewrites only its own domain's entities and the shared scalars it owns; other
> domains are never touched. Cross-domain mismatches (cooling capacity < IT load, rack
> count vs BOM count) surface as **validation warnings for the user to resolve** — tools
> never silently overwrite each other. Computed results (PUE curves, cost outputs,
> validation output) are never persisted.
>
> **Propagation v1** = one shared persisted doc + pure adapter derivation on load/save.
> Active project travels as a `?project=<id>` search param plus a
> `localStorage["drybulb.active-project"]` fallback. Saves use optimistic concurrency
> (`updated_at` match); a stale save shows a Reload/Overwrite conflict dialog. A
> `ProjectStore` interface isolates the UI from persistence so live sync (Supabase
> Realtime / BroadcastChannel) can swap in later without touching adapters or pages.
>
> **Decisions already made — do not relitigate:**
> - Projects require **sign-in but not premium**; a user gets **2 projects free**, more is
>   a premium up-sell (extend `lib/entitlements.ts`, which today has tiers
>   `free|members|pro`, `userTier(signedIn)`, `hasAccess(slug, signedIn)` — it has no quota
>   concept yet; add one).
> - **No derivable hourly data in the project doc.** The project is a BOM + specs document,
>   not a time-series store. Hourly weather is never persisted (only `stationId`); computed
>   hourly results are never persisted; service-channel 8,760-hr `demand` vectors are
>   persisted **only when `demandSource === "custom"`** (user-uploaded CSV — irreducible
>   source data). Preset/model channels store their `ProfileParams`/`SynthModel` params
>   only and are regenerated on read (synthesis is seeded, hence deterministic). Note this
>   differs from how `cost_models` saves today (verbatim vectors) — the cost adapter and
>   importer own the regeneration.
> - Existing `pue_models` / `cost_models` tables and their saved-models drawers stay fully
>   functional throughout; projects import from them non-destructively.
> - Follow the repo's pure-function style (`lib/cost/model.ts`, `lib/factory/sld.ts` ops
>   returning new objects); tool pages keep plain React `useState` — no state-management
>   framework.

---

## Phase 1 — Core schema + persistence (invisible)

````
[Paste the Architecture brief first.]

Build the core of the shared Project object model: schema, canonical entity graph,
registry, persistence, and entitlements quota. No UI changes in this phase.

Read first: lib/factory/schema.ts, lib/factory/sld.ts (the PAL palette), lib/factory/project.ts,
lib/cost/saved-models.ts, lib/factory/groups.ts, docs/ai-factory/single-line-groups.sql,
lib/entitlements.ts, lib/energy/types.ts.

Tasks:
1. `lib/project/graph.ts` — move `lib/factory/schema.ts` here wholesale and delete the
   original (verify first that nothing imports it). Rename: `FactoryGraph → ProjectGraph`,
   `FNode → Entity`, `FEdge → Relation`, `FKind → EntityKind`, `FDomain → EntityDomain`,
   `FEdgeKind → RelationKind`. Keep `validateGraph`, the RowLibrary/RowTemplate/rollupRow
   types, `bind` (locPath), and the open `attrs` bag. Add `Entity.siteId?: string` and
   optional interface specs on attrs: `powerIf?: RackPower`, `coolingIf?: RackCooling`
   (types from lib/factory/rack-specs.gen.ts).
2. `lib/project/types.ts` — `PROJECT_SCHEMA_VERSION = 1`; `ProjectDoc { schemaVersion,
   meta, sites: SiteRecord[], graph: ProjectGraph, facets: ProjectFacets }`;
   `SiteRecord { id, name, stationId, shared: SiteShared }`; `SiteShared { itCapacityKW,
   kwPerRack, rackCount, raKey?, cooling: CoolingConfig, upsType?, redundancy?,
   domainSource }`; `ProjectFacets { cost?, pue?, sld?, [toolId: string]: unknown }` with
   facet payload types imported from the tools' saved-models files. Include
   `makeEmptyProject(name)`.
3. `lib/project/id.ts` — `newId(prefix?)` using `crypto.randomUUID()`. Site ids double as
   `LocationConfig.id` in the cost facet; existing `loc-*` ids are grandfathered on import.
4. `lib/project/registry.ts` — data-driven entity-type registry:
   `EntityTypeDef { type, label, kind, domain, defaultCatalogKey?, accepts?, emits? }` and
   `ENTITY_TYPES: Record<string, EntityTypeDef>`, seeded by merging the SLD palette (`PAL`
   in lib/factory/sld.ts), the old FactoryGraph type strings, and reference-architecture
   BOM catalogKeys. Export `catalogKeyIssues(g: ProjectGraph): string[]` that flags
   catalogKeys missing from lib/cost/catalog.ts.
5. `lib/project/migrate.ts` — `migrateProject(doc: unknown): ProjectDoc` applying a
   stepwise `MIGRATIONS: Record<number, (d: unknown) => unknown>` ladder; a doc with a
   schemaVersion above PROJECT_SCHEMA_VERSION must throw a clear error, never corrupt.
6. `docs/projects.sql` — mirror docs/ai-factory/single-line-groups.sql exactly (idempotent,
   drop-then-create policies): table `public.projects` (id uuid pk default
   gen_random_uuid(), user_id uuid default auth.uid() references auth.users on delete
   cascade, name text, doc jsonb, schema_version int default 1, created_at/updated_at
   timestamptz), index (user_id, updated_at desc), RLS enabled, four owner-only policies.
7. `lib/project/saved-projects.ts` — mirror lib/cost/saved-models.ts (browser Supabase
   client, isSupabaseConfigured guard): `listProjects()` selecting id, name,
   schema_version, created_at, updated_at ONLY (never `doc` — docs embed 8,760-hr vectors);
   `getProject(id)` fetching `doc` and running migrateProject; `createProject(name, doc)`;
   `updateProject(id, name, doc, expectedUpdatedAt)` adding
   `.eq("updated_at", expectedUpdatedAt)` — zero rows updated = return "conflict";
   `deleteProject(id)`.
8. Entitlements quota — extend lib/entitlements.ts with `projectQuota(tier: Tier): number`
   (free: 0 — sign-in required; members: 2; pro: Infinity) without changing existing
   exports. `createProject` must check `listProjects().length` against the quota for the
   current tier and return a typed "quota" refusal the UI can upsell on.
9. `lib/project/store.ts` — the seam for future live sync:
   `interface ProjectStore { getSnapshot(); subscribe(cb); apply(fn); save(name?);
   isDirty(); }` (useSyncExternalStore-compatible) and
   `createSupabaseProjectStore(id): ProjectStore` implemented over saved-projects.ts.
10. Tests (follow the repo's existing test setup if one exists; otherwise a minimal
    vitest/node:test setup consistent with package.json): validateGraph passes on a small
    valid graph and fails on a power cycle / unpowered payload; migrate ladder round-trips
    a v1 doc and throws on schemaVersion 999; catalogKeyIssues returns [] for the seeded
    registry.

Acceptance criteria:
- `npx tsc --noEmit` and `npx next build` green; all tests pass.
- Nothing imports lib/factory/schema.ts anymore and the file is gone.
- docs/projects.sql runs idempotently in Supabase (verify with the pg_policies query
  pattern shown in docs/ai-factory/single-line-groups.sql).
- No visible change to any page.
````

## Phase 2 — Adapters + importers (invisible)

````
[Paste the Architecture brief first.]

Phase 1 delivered lib/project/ (types, graph, registry, migrate, saved-projects, store)
and the projects table. Now build the pure per-tool adapters and non-destructive
importers. Still no UI changes.

Read first: lib/project/types.ts, lib/project/graph.ts, lib/factory/project.ts (reuse
rollupGraph / locationToGraph / buildGraphForRacks as-is — do not duplicate),
lib/cost/types.ts (LocationConfig, makeLocation), lib/cost/saved-models.ts,
lib/pue/types.ts + lib/pue/equipment-defaults.ts + lib/pue/saved-models.ts,
lib/factory/sld.ts.

Tasks:
1. `lib/project/adapters/types.ts` —
   `interface ToolAdapter<T> { toolId: string; read(p: ProjectDoc, siteId: string): T;
   write(p: ProjectDoc, siteId: string, inputs: T): ProjectDoc; }` — both directions pure,
   returning new objects.
2. `lib/project/adapters/cost.ts` — read: assemble CostInputs from facets.cost, then per
   location overwrite capacityMW (= shared.itCapacityKW/1000), stationId, cooling from the
   matching SiteRecord (matched by id; missing locations for new sites come from
   makeLocation defaults), and REGENERATE each service channel's 8,760-hr demand vector
   from its stored ProfileParams/SynthModel (reuse lib/energy/profile generateProfile and
   lib/energy/stochastic synthDemand — seeded, deterministic) unless
   demandSource === "custom", in which case the stored vector is used verbatim.
   write: split — capacityMW/stationId/cooling → SiteRecord + shared; everything else into
   the facet, but STRIP demand vectors from non-custom channels before persisting (the
   project doc stores no derivable hourly data). Adding/removing locations adds/removes
   SiteRecords (the cost tool is the only multi-site UI). Respect domainSource: if shared
   capacity is owned by another domain's tool (e.g. power: "sld"), the cost write must NOT
   change itCapacityKW/rackCount.
3. `lib/project/adapters/pue.ts` — read: facets.pue[siteId] ?? DEFAULT_INPUTS, overlaid
   with stationId, itLoadKW = shared.itCapacityKW, kwPerRack, rackCount, cooling fields
   (coolingType, supplyAirTemp, liquidCoolingPct → airCoolingPct = 100 − liquid), upsType.
   write: reverse split; PUE-only fields (lightingPct, pduLossPct, temperatureRise, water
   temps, tempUnit) go to the facet only; same domainSource guard as cost.
4. `lib/project/adapters/sld.ts` — read: facets.sld[siteId]?.graph ??
   locationToGraph-equivalent AutoBuild from shared values. write: store SldGraph verbatim
   in the facet; run rollupGraph → patch shared.itCapacityKW + rackCount; set
   domainSource.power = "sld"; regenerate ONLY the power-domain entities of the canonical
   graph via a new `graphToEntities(sld, siteId)` that groups SldNodes by (type,
   catalogKey) into qty-aggregated Entities and maps SLD edges to `powers` Relations
   (chiller/cdu/crah nodes → `cools` relations). Entities in other domains are untouched.
5. `lib/project/import.ts` — non-destructive importers (old rows never modified):
   `fromCostModel(m: SavedCostModel): ProjectDoc` (one SiteRecord per location, reusing
   location.id as site id; shared extracted per location; cost facet with demand vectors
   stripped from non-custom channels, same rule as the cost adapter's write);
   `fromPueModel(m): ProjectDoc` (single site from PUEInputs);
   `fromSldTopology(name, g: SldGraph): ProjectDoc` (single site; shared from rollupGraph;
   sld facet). Also export a helper that enumerates localStorage "sld.app.topologies"
   entries client-side.
6. Tests — the golden round-trip is the point of this phase:
   a) cost: `adapters/cost.read(fromCostModel(m), …)` deep-equals the original m.inputs
      for a model containing a custom-CSV channel, a preset channel, and a seeded synth
      channel — i.e. regenerated vectors are element-identical to the originals (hence
      computePortfolio output is bit-identical) and the custom vector round-trips
      verbatim; also assert the persisted doc contains NO demand array on the non-custom
      channels;
   b) pue and sld: write(read(p)) is a no-op for shared fields;
   c) graphToEntities output passes validateGraph;
   d) adapters preserve unknown facet keys (insert a fake `facets.futureTool` and confirm
      it survives a cost write).

Acceptance criteria: tsc + next build green; all round-trip tests pass; no page changes;
lib/factory/project.ts reused, not duplicated.
````

## Phase 3 — Project bar on Cost Model + PUE (first visible propagation)

````
[Paste the Architecture brief first.]

Phases 1–2 delivered lib/project/ (schema, graph, saved-projects, store) and pure adapters
with golden round-trip tests. Now make projects visible: a shared project bar on the Cost
Model and PUE pages, with cross-tool propagation via the shared doc.

Per AGENTS.md, read node_modules/next/dist/docs/ for the current searchParams /
useSearchParams and client-component semantics BEFORE writing page code — they may differ
from your training data.

Read first: app/(app)/dashboard/tools/cost-model/page.tsx (state helpers patchLoc/upd…,
handleLoadModel, SavedModelsDrawer usage), app/(app)/dashboard/tools/pue-calculator/page.tsx,
components/cost/saved-models-drawer.tsx, components/pue/saved-models-drawer.tsx,
lib/project/store.ts, lib/project/adapters/{cost,pue}.ts, lib/project/import.ts,
lib/entitlements.ts.

Tasks:
1. `components/project/use-project.ts` — client hook over ProjectStore:
   { project, siteId, setSiteId, dirty, conflict, load, save, applyToolWrite }. Resolves
   the active project from ?project=<id> then localStorage["drybulb.active-project"];
   renders nothing/no-ops when signed out or Supabase is not configured.
2. `components/project/project-bar.tsx` — one compact strip matching the existing tool-page
   styling: project picker (listProjects), "New project" (quota-aware: on quota refusal
   show the premium up-sell consistent with components/app/premium-gate.tsx), site picker (PUE is a
   single-site view of multi-site projects), inline rename, Save button + dirty dot,
   conflict dialog (Reload / Overwrite — overwrite only on explicit user choice), Import
   menu, and cross-tool "Open in Cost Model / PUE →" links carrying ?project=.
3. `components/project/import-dialog.tsx` — lists the user's pue_models and cost_models
   rows (existing listModels functions) and localStorage "sld.app.topologies" entries;
   selecting one calls the Phase-2 importer then createProject. Source rows are never
   modified or deleted.
4. Wire the Cost Model page: render the project bar (inside PremiumGate content, above the
   tool); when a project is active, seed `inputs` from adapters/cost.read on load, and
   route Save through adapters/cost.write + store.save. With NO project selected the page
   must behave byte-for-byte as today (existing SavedModelsDrawer untouched).
5. Wire the PUE page the same way with adapters/pue.read/write. The PUE page has no
   PremiumGate — show the project bar only when signed in (projects need sign-in, not
   premium).
6. Respect per-domain authority in the UI: if domainSource marks capacity/rackCount as
   owned by another tool, render those inputs read-only with a "from <tool>" chip (the
   Unlink/Rebuild actions land in Phase 4).

Acceptance criteria:
- tsc + next build green.
- Flow test (manually or via playwright.config.ts if tests exist): create a project in
  Cost Model → "Open in PUE" shows the same station/capacity/cooling → change cooling
  type + supply temp in PUE and Save → reload Cost Model → propagated.
- Import an existing cost_model and a pue_model into projects; originals still load in
  their old drawers.
- Two tabs, save in both → second save gets the conflict dialog, no silent clobber.
- Both pages identical to today when no project is selected.
- Free-tier user creating a 3rd project sees the premium up-sell, not an error.
````

## Phase 4 — Single-line joins (power-domain authority)

````
[Paste the Architecture brief first.]

Phases 1–3 delivered lib/project/, adapters, importers, and the project bar on Cost Model
+ PUE. Now the single-line editor joins the project as the authoritative source for the
POWER domain.

Read first: components/factory/single-line-editor.tsx (localStorage library LIBKEY
"sld.app.topologies", save()/load(), undo stack), app/(app)/dashboard/tools/single-line/page.tsx,
lib/project/adapters/sld.ts, lib/factory/project.ts (rollupGraph, locationToGraph,
buildGraphForRacks, arrangeNetworkRacks), lib/project/graph.ts (validateGraph).

Tasks:
1. Wire the single-line page/editor to the project bar + store: load the active site's
   SldGraph via adapters/sld.read; Save runs adapters/sld.write (facet verbatim + rollup →
   shared.itCapacityKW/rackCount + domainSource.power = "sld" + power-domain entity
   regeneration via graphToEntities). The localStorage topology library keeps working
   alongside as the no-project path.
2. Cost Model + PUE: finish the authority UX started in Phase 3 — capacity/rack inputs
   bound to domainSource.power = "sld" show the "from single-line" chip with two explicit
   actions: "Unlink" (clears domainSource.power; values become editable) and "Rebuild
   single-line from capacity" (regenerates the sld facet via the
   locationToGraph/buildGraphForRacks path — explicit user action only, layout never
   echoes automatically, per the design principle in lib/factory/project.ts).
3. Cross-domain validation: extend validateGraph (or add a sibling
   `crossDomainChecks(doc)`) with project-level interface checks — e.g. total cooling
   capacity entities < IT load ⇒ warning; rackCount in shared vs rack entities mismatch ⇒
   warning. Surface errors/warnings count as a status chip in the project bar on all three
   pages, expandable to a list.
4. BOM single-source payoff: derive the Cost Model's itemized BOM from the canonical
   entities for the power domain. When domainSource.power = "sld", the cost adapter's read
   sets the electrical category to itemized (categoryMode) and computes its componentCosts
   from power-domain entities: qty × unit price from lib/cost/catalog.ts (via catalogKey)
   ÷ site watts → perW entries, shown read-only with the "from single-line" chip like
   capacity. (lib/factory/project.ts's graphToLocation comment already anticipates this
   refinement.) Categories without a discipline model keep today's editable behavior.
5. Import: add the localStorage "sld.app.topologies" entries to the import dialog
   (fromSldTopology), non-destructively.

Acceptance criteria:
- tsc + next build green.
- Add racks in the SLD, Save → Cost Model capacityMW and PUE rackCount/itLoadKW update on
  next load, shown read-only with the "from single-line" chip.
- Unlink makes them editable; Rebuild regenerates a valid single-line (passes
  SLD validate()) sized to the entered capacity.
- Deleting cooling equipment in a project that has IT load produces a visible cross-domain
  warning in the project bar on all three tools.
- Undo/redo and the localStorage library still work with no project selected.
````

## Phase 5 — Hardening + extensibility proof

````
[Paste the Architecture brief first.]

Phases 1–4 delivered the full loop: shared ProjectDoc, adapters, project bar on all three
tools, power-domain authority, cross-domain validation. This phase hardens propagation and
proves extensibility.

Tasks:
1. Freshness: on window focus, refetch the active project's updated_at (cheap select); if
   newer than the loaded snapshot, show a "project updated elsewhere — reload" badge in
   the project bar.
2. Bulk migration: an "Import all my saved models" action in the import dialog that
   converts every pue_model/cost_model into projects (respecting the quota; batch and
   report). Originals untouched; mark the legacy drawers with a subtle "legacy" label.
3. BOM browser: a read-only panel (project bar → "Bill of Materials") listing the
   canonical entities and relations of the active project grouped by domain, with qty,
   catalogKey, product, catalog price join (lib/cost/catalog.ts), extended price
   (qty × unit), per-domain subtotals, CSV export, and validation flags inline. This is
   the single-source-of-truth BOM view — the reason the project model exists — and the
   first step toward the graph/BIM UI and the DSX digital-twin direction.
4. Extensibility recipe: write docs/project-model/adding-a-discipline-tool.md — the exact
   steps to add the next discipline tool (cooling plant, network plant, or IT hardware
   BOM): register entity types in lib/project/registry.ts, add a facet key, write a
   ToolAdapter, claim a domain in domainSource, add cross-domain checks, mount the project
   bar. Validate the recipe by stubbing one adapter test for a fictional "cooling-plant"
   tool that claims domainSource.cooling and confirm no schema change was needed.

Acceptance criteria: tsc + next build green; focus-refresh badge demonstrable with two
tabs; bulk import of N models yields N projects (or a quota up-sell); entity browser shows
the GB300 seed topology's aggregated entities with prices; the fictional-tool test passes
with zero edits to lib/project/types.ts.
````

---

## Risks / open items

- **`lib/factory` is currently uncommitted.** Phase 1 moves `lib/factory/schema.ts` into
  `lib/project/graph.ts` — commit or stabilize the single-line work first so the move
  doesn't collide with in-flight edits.
- **Demand-vector regeneration.** Non-custom service channels store params only and are
  regenerated on read; this diverges from `cost_models` (verbatim vectors), so any change
  to `generateProfile`/`synthDemand` that alters output for the same params/seed silently
  changes saved projects' results. Mitigate with the Phase 2 element-identical golden test
  and treat those functions as frozen contracts (version them if they must change).
  Custom-CSV channels still embed 8,760 values (~70 KB each) — acceptable; `listProjects`
  never fetches `doc`.
- **Quota enforcement is client-side in v1.** The 2-free-projects limit is checked in
  `createProject`; a determined user could bypass it with direct API calls. Acceptable for
  beta (members tier is free anyway); revisit with a Postgres policy or trigger when
  premium billing goes live.
- **Legacy tables.** `pue_models` / `cost_models` stay writable indefinitely for now;
  freezing them to import-only is a separate, later decision.
- **Concurrency model is last-write-wins on explicit user choice.** Fine for a
  single-user-per-project beta; the `ProjectStore` seam is where Realtime/CRDT sync would
  land if projects become collaborative.
