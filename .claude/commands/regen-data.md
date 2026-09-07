Rebuild the generated typed modules from their JSON sources of truth. Trigger: any edit to a file in `data/*.json`, or a `.gen.ts` that disagrees with its JSON (the generated file is never edited by hand).

## Input

$ARGUMENTS — optional subset (e.g. "racks", "catalog"). If empty, regenerate all four.

## Source-of-truth map

| JSON source (edit this) | Generator | Generated module (never hand-edit) |
|---|---|---|
| data/rack-specs.json | `python scripts/rack_specs.py build` | lib/factory/rack-specs.gen.ts |
| data/network-specs.json | `python scripts/network_specs.py build` | lib/factory/network-specs.gen.ts |
| data/reference-architectures.json | `python scripts/reference_architectures.py build` | lib/factory/reference-architectures.gen.ts |
| data/equipment-catalog.json | `python scripts/equipment_catalog.py build` | lib/cost/catalog.gen.ts |

(`data/power-equipment.json` is read directly by lib/factory/topology.ts tooling and has no generator; it is not part of this skill.)

## Process

1. **Validate first.** Each generator has a `validate` subcommand — run it for every affected source and fix JSON problems before generating. Run from the repo root (Windows: `python scripts\rack_specs.py …`).
2. **Build.** Run the `build` subcommand for each affected generator; confirm each `.gen.ts` actually changed as expected (`git diff --stat lib/**/**.gen.ts`).
3. **Prove consumers still hold.** `npm run type-check` must be green — the .gen.ts outputs are typed, so schema drift surfaces here. If a tool's math consumes the changed data (sizing, BOM, RA seeds), also run `npm run test`.
4. **Engineering sanity.** New or changed equipment numbers must carry their confidence tag (`sourced`/`estimate`) and a source; anything that contradicts its cited source goes back to Eric, not into the JSON. For diffs touching sizing-relevant fields, request the dc-engineering-reviewer pass.
5. **Report** which sources changed, which .gen.ts files were rebuilt, and the type-check/test results.

## Acceptance

All affected generators ran validate + build cleanly; every regenerated .gen.ts is in sync with its JSON; `npm run type-check` (and `npm run test` when math-relevant) green.

## Guardrails
- Never edit a `.gen.ts` directly — fix the JSON and regenerate.
- Never invent equipment data to satisfy a validator; missing facts are flagged, not fabricated.
