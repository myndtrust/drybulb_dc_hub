---
name: rackline-project-seed
description: Create a Rackline DCIM project for a customer or site — a spec, the project JSON and an idempotent Supabase seed SQL — from that customer's equipment, single line and layout options. Use when Eric asks to "create a Rackline project / base / seed SQL for <customer or site>", to turn a data room into a Rackline starting design, or to regenerate an existing base (e.g. enid_base) after changes.
---

# Rackline project seed

Turns one customer's design inputs into a Rackline project that only the right people can open:

```
<customer folder>/rackline/<name>.spec.json   ← you write this (inputs)
        │  npx tsx scripts/rackline-project-seed.ts <spec> [--out <dir>]
        ▼
<customer folder>/rackline/<name>.rackline.json   project doc (importable via File ▸ Import)
<customer folder>/rackline/<name>.seed.sql        insert into public.rackline_projects, owned by spec.owner
```

Reference implementation: the Enid data room's `rackline/enid_base.spec.json`. The template is `template.spec.json` next to this file.

## Hard rules

- **Customer data never enters this repo.** Spec, JSON and SQL go in the customer's folder (usually its data room, under `rackline/`). The script refuses to write inside the repo. Don't add customer names, sites, utilities or equipment to `lib/rackline/` defaults, tests or docs.
- **Default access is admin-only** (`"access": "admin"`, owner `eric@drybulb.com`): only the owner and Drybulb staff can open it (RLS in `docs/rackline/rackline-projects.sql`). Use `"customer"` only when Eric says the project is meant to be shared; sharing itself happens in the app (Share ▸ invite), never in SQL.
- **Every number traces to a source.** Single-line ratings come from the customer's documents (one-lines, utility letters, nameplates). Equipment comes from the catalog or a vendor datasheet; put the source and any estimate basis in the device's `note`. Mark unknowns as estimates in the name or note. Don't invent ratings.
- **Don't apply SQL to Supabase** unless Eric asks in this conversation (house rule, `/db-change`). Hand him the file and the apply steps.

## Inputs to collect

Ask only for what you can't find in the customer's folder:

| Spec field | What | Where it usually comes from |
|---|---|---|
| `name` | Project name, e.g. `acme_base` | Eric |
| `owner`, `access` | Owner email (default `eric@drybulb.com`), `admin` or `customer` | Eric |
| `notes` | Site and sources, prefixed to every scenario's notes | Data room README |
| `library.catalog` | Catalog ids to include (default: all). See `DEF_LIB` in `lib/rackline/constants.ts` | Eric's equipment choice |
| `library.custom` | Devices not in the catalog: `id, name, cat, u, kw, psu, psuW, liq (0–1), ports, note` | Vendor datasheet (search the web if needed; cite in `note`) |
| `electrical` | Single-line nodes (`id, type, name` + ratings) and `[from, to]` links. Omit for the generic 2N default | Customer one-line / utility docs |
| `feeds` | Node ids rack PDUs feed from (must be `rpp`, `busway`, `swbd`, `ups` or `ats`) | The single line |
| `elec`, `cooling` | Overrides: e.g. `vLL`, `vLN`, `pf`, `derate`; `ambF` (ASHRAE 0.4 % design dry-bulb for the site), `red`, `rdhxKW`, `cduKW`, `dlcRej` | Site climate data, Eric |
| `scenarios[]` | `name, nodes, model, perRack` + optional `pattern` (`pod`/`single`), `cooling` (`hac`/`rdhx`/`hac+rdhx`), `rackW`, `hot`, `cold`, `net`, `red` | The layouts Eric wants to compare |

Single-line node types and their rating fields (`ELEC_T` in `lib/rackline/constants.ts`):
`utility` (v, scc MVA; 0 = infinite) · `switch` (v, amps) · `xfmr` (kva, vp, v, z %) · `gen` (kva, v) · `ats` / `swbd` / `rpp` / `busway` (amps, v) · `ups` (kva, v, eff) · `mech` (amps, v, auto, kw) · `load` (kw, v).

## Steps

1. **Read the customer's folder** (README, one-lines, equipment lists) and fill the spec from `template.spec.json`. Save it as `<customer folder>/rackline/<name>.spec.json`.
2. **Generate** from the repo root:
   `npx tsx scripts/rackline-project-seed.ts "<customer folder>/rackline/<name>.spec.json"`
   The script validates catalog ids, node types, links, feeds and models, then prints a per-scenario summary (racks, IT kW, kW/rack, PUE, FAIL checks).
3. **Review the summary.** FAIL lines are design findings (e.g. "RDHx short by 8 kW"); report them, don't silently "fix" the spec to hide them. Fix only genuine input mistakes.
4. **Optional check of the SQL:** it must contain the owner's email, the name, and `not exists` (idempotent). It's plain SQL with the doc as a single-quoted jsonb literal.
5. **Report to Eric:** the three file paths, the scenario summary, every estimate you made and its basis, and the apply steps:
   1. Owner signs in to drybulb.com once.
   2. `docs/rackline/rackline-projects.sql` has been applied (once per Supabase project).
   3. Run `<name>.seed.sql` in the Supabase SQL editor. Or open Rackline ▸ File ▸ Import project JSON and save it, as the owner.
   4. Admin projects: don't share; use "Save as new" for a customer copy. Customer projects: Share ▸ invite (staff can invite the customer as Owner).

## Regenerating

Edit the spec and re-run step 2. The seed SQL skips inserting if a project with the same name already exists for that owner. To replace a saved project, Eric opens it in Rackline and imports the new JSON, or deletes it first. Never write an UPDATE that overwrites a customer's saved edits.
