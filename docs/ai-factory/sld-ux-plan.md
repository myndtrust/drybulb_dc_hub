# AI Factory single-line — UX & quality plan

Companion to the `drafts/ai-factory-sld.html` mockup and the shared connector engine
(`drafts/sld/engine.js`). This round delivered **editable input/output connectors** with a robust,
tested data model; this document records the UX rationale, what shipped, and the prioritised follow-ups.

## Principles
- **Direct manipulation.** Topology is edited on the canvas, the way an engineer reads a single-line —
  not buried in forms. Ports and wires are the primary objects.
- **Single source of truth.** Every edit goes through `drafts/sld/engine.js` (pure, validated ops). The UI
  holds no graph logic of its own, so what you test is what you click.
- **Safe by construction.** Illegal topologies can't be created: the engine rejects self-loops, duplicates,
  reversed feeds, cycles, and port-role violations, returning a reason the UI surfaces. Every edit is
  undoable.
- **Power perspective.** This view is the electrical single-line: sources at the top, everything that draws
  power hangs as a load at the bottom; the passive manifold is excluded (it belongs to the cooling view).

## What shipped this round (connector editing)
- **Ports on every card.** Input dot (top), output dot (bottom); sources are output-only, loads input-only,
  equipment/buses both. Domain-coloured, crosshair cursor, hover ring.
- **Create** — drag a port onto another port or busbar. A rubber-band preview follows the cursor and turns
  **green (valid)** / **red (invalid)**; the target highlights. Invalid drops no-op with a reason toast.
- **Re-route** — grab a connector's **end-handle** on a card and pull it to another card; the endpoint moves
  (validated). Dropping on empty space cancels with no change.
- **Delete** — **click the wire** (it turns red on hover) to remove the connector; or select it and press
  `Delete`. Also removable from the inspector's connector list.
- **Undo/redo** for every connector edit (`Ctrl+Z` / `Ctrl+Shift+Z`), plus card move/add/delete.
- **Dev tripwire** — `SLD.validate()` runs after each mutation and logs any invariant break to the console.

## Risk → mitigation (carried from the plan)
| Risk | Mitigation (shipped) |
|------|----------------------|
| file:// CORS would break a module engine | engine is a classic UMD `<script src>` — loads locally, no CORS |
| Port-drag vs card-move conflict | header moves the card; ports/handles `stopPropagation` and own wiring |
| Accidental disconnect | drop-on-empty cancels; every edit undoable; rejects show a reason toast |
| Corrupt graph data (dangling/dup/cycle/role) | pure validated ops + `validate()` gate in tests and as a dev assert |
| Engine ↔ UI drift | one shared `engine.js`; the mockup has zero graph logic |
| A handle dying mid-drag (found + fixed) | reroute redraws lines only, never rebuilds the captured handle element |

## Test coverage (regression gate)
- **`drafts/sld/engine.test.js`** (`npm test`, node:test) — 19 cases: ports per card, every add/move guard,
  delete, hit-testing, seed **golden snapshot**, serialization **round-trip**, and a deterministic **fuzz**
  that asserts invariants hold over 600 random ops.
- **`drafts/sld/e2e/connectors.spec.ts`** (`npm run test:e2e`, Playwright/Chromium) — real pointer drags:
  ports render by role, create, re-route, click-to-delete, and undo.

## Follow-ups (prioritised)
1. **Validation surface** — a "Problems" chip listing unpowered/uncooled/orphan loads from `validate()`
   (and `lib/factory/schema.ts validateGraph`), each with jump-to-element. *(High value, low risk.)*
2. **Edge polish** — selectable wire with a subtle hover affordance, A/B colour for 2N pairs, cleaner
   orthogonal routing with a breaker glyph at the junction.
3. **Productivity** — multi-select + marquee, box-delete, snap-to-grid alignment guides, duplicate.
4. **Persistence & a11y** — localStorage autosave + explicit reset; keyboard focus order, ARIA labels on
   ports/handles, an on-canvas legend.
5. **Bridge to the cost model** — "Edit in cost model" on a selected card; per-port rating datablocks; first
   step of the bidirectional `LocationConfig ↔ FactoryGraph` sync (`lib/factory/project.ts`).
6. **Additional views** — cooling/water and network leaf-spine single-lines, then a consolidated overlay
   dashboard with per-domain layer toggles (reusing the same engine + port model).

## Promotion path
When this graduates from mockup to app, promote `drafts/sld/engine.js` to a typed `lib/factory/sld.ts`
(the model already mirrors `lib/factory/schema.ts`), keep the node:test suite, and mount the canvas as a
React island on the cost-model page so the single-line and the cost cards stay interlocked.
