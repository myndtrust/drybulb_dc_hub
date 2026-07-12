# Dev-platform status

## Session zero — 2026-07-12

**Baseline:** commit `d3aa2e6` on `main`, tagged `baseline-pre-fable`. Working tree clean.
`test-results/` and `playwright-report/` added to `.gitignore`; no secrets, env files, or
large binaries found in the committed set.

### Gate truth table

| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| Lint | `npm run lint` | **FAIL** (exit 1) | `next lint` was removed in Next 16 (repo is on 16.2.6); it now parses `lint` as a project directory: "Invalid project directory provided … \lint". Needs migration to the ESLint CLI. |
| Type-check | `npm run type-check` | PASS | `tsc --noEmit` clean. |
| Build | `npm run build` | PASS | `velite && next build` green; all routes emit (incl. `/dashboard/tools/single-line`). |
| Unit tests | `npm run test` | PASS | 38/38 (`lib/factory` via node --test + tsx, and `drafts/sld` JS suites). |
| E2E | `npm run test:e2e` | PASS | 9/9 — but coverage is only the `drafts/sld` HTML prototype, not the real app pages. |

### Proposed M1 fixes (ordered by risk to M2)

1. **Lint gate is dead** — migrate `npm run lint` to the ESLint CLI (`eslint .` with
   `eslint-config-next`), since `next lint` no longer exists in Next 16. Until then one of
   the five gates can never go green and lint regressions land silently.
2. **E2E covers the prototype, not the product** — the Playwright suite drives
   `drafts/sld/*.html` only. Add app-level specs (single-line editor page, plus smoke of
   PUE calculator and Cost Model) so M2 "tested" means the shipped pages, not the draft.
3. **`/verify-app` skill** — encode the five gates + scripted three-tool smoke against
   `npm run dev` as the per-phase definition of done (kickoff prompt, platform assets).
4. **Remaining platform skills/agents** — `release`, `db-change`, `regen-data`,
   `new-tool`; agents `dc-engineering-reviewer`, `ux-reviewer`. Note: `regen-data` names
   `scripts/equipment_catalog.py`, which does not exist yet (only rack/network/RA
   generators do) — either write it or scope regen-data to the three real generators.
5. **Housekeeping** — CRLF/LF warnings on every git touch (consider `.gitattributes`
   with `* text=auto eol=lf`); CSP still report-only (flip to enforce is a listed
   pre-launch follow-up).
