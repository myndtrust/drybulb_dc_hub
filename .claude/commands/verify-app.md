Run the full definition-of-done check: the five quality gates plus a browser smoke of the three tools against the running app. This is the check every phase must pass before it is called done. Trigger: end of any build phase, before any commit Eric asks for, and before any deploy.

## Input

$ARGUMENTS — optional scope hint (e.g. "skip e2e", "only cost-model"). If empty, run everything.

## Gates (run in this order; record actual exit codes, never assume)

| # | Gate | Command | Green means |
|---|---|---|---|
| 1 | Lint | `npm run lint` | ESLint CLI exit 0 (warnings allowed; errors fail) |
| 2 | Types | `npm run type-check` | `tsc --noEmit` exit 0 |
| 3 | Build | `npm run build` | `velite && next build` exit 0, all routes emit |
| 4 | Unit | `npm run test` | node --test suites (lib/factory + drafts/sld) all pass |
| 5 | E2E | `npm run test:e2e` | Playwright: sld-mockup project + app project (e2e/app-smoke.spec.ts) all pass |

## Process

1. **Run gates 1–4** sequentially, capturing exit codes (`set -o pipefail` when piping). Do not stop at the first failure — collect the full truth table.
2. **Run gate 5.** The Playwright config starts `npm run dev` itself (or reuses a running server on :3000). The app project smokes: home page, marketing /tools, PUE calculator (free — full tool must render), Cost Model and Single-line (premium — tool or members sign-in card, no client exceptions).
3. **Deeper tool smoke** (when $ARGUMENTS asks, or when the phase touched tool logic): against `npm run dev`, drive each affected tool end-to-end — PUE: pick a station, confirm a PUE number renders; Cost Model: confirm portfolio totals update on an input change; Single-line: run a Power Expert brief, confirm the schedule renders. Note results per tool.
4. **Report** a pass/fail table (gate, exit code, one-line failure summary). If anything is red, the phase is NOT done: list the failures ordered by blast radius and stop — fixing is the next unit of work, not part of this skill.

## Acceptance

All five gates exit 0 and any scoped tool smoke passed. Output ends with the table and a single verdict line: `VERIFY: PASS` or `VERIFY: FAIL (<n> gates red)`.

## Guardrails
- Never mark a gate green from a cached/previous run — re-run it.
- Do not fix, commit, or deploy inside this skill; it only measures.
