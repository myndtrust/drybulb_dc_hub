Scaffold a new discipline tool (a configurator like PUE / Cost Model / Single-line) with all the wiring the suite expects: entitlements, dashboard page, marketing card, premium gating, and the shared state pattern. Trigger: Eric asks for a new tool or a new discipline model gets its own page.

## Input

$ARGUMENTS — tool name, slug (kebab-case), one-line summary, and tier (`free` | `members`). Ask for whichever is missing before scaffolding.

## Wiring map (every tool touches exactly these seams)

| Seam | File | What to add |
|---|---|---|
| Entitlements | lib/entitlements.ts | `"<slug>": "<tier>"` in `TOOL_TIER` |
| Engine | lib/<domain>/ | Pure, UI-free functions + types; this is where all math lives |
| Page | app/(app)/dashboard/tools/<slug>/page.tsx | Server component: `metadata` + `<PremiumGate slug toolTitle>` wrapping the client component |
| Client UI | components/<domain>/ | `"use client"`; plain React `useState` + calls into the pure engine (house pattern — no state libraries) |
| Marketing card | content/tools/<slug>.mdx | Frontmatter: `title`, `slug`, `summary`, `status` (`beta` at launch), `appPath: "/dashboard/tools/<slug>"` — velite picks it up for /tools |
| Unit tests | lib/<domain>/*.test.ts | node --test via tsx (extend the `npm run test` glob if outside lib/factory) |
| E2E smoke | e2e/app-smoke.spec.ts | Add a mount test: full tool if free; tool-or-sign-in-card if members |
| Persistence (optional) | lib/<domain>/saved-models.ts + docs SQL | Only if the tool saves documents — author the table via /db-change |

After M3 (unified object model) additionally: registry entry, domain facet, and a ToolAdapter per the recipe produced by docs/project-model/prompts.md Phase 5 — follow that recipe, do not invent a parallel pattern.

## Process

1. **Confirm inputs** (name, slug, summary, tier) and that the slug is unused (`TOOL_TIER`, content/tools/, app routes).
2. **Scaffold in dependency order**: engine stub → entitlements entry → client component → page → marketing mdx → tests → smoke spec. Match the conventions of the nearest existing tool (Cost Model is the richest reference); read `node_modules/next/dist/docs/` before any framework-specific code — this Next.js version has breaking changes.
3. **Follow the house state pattern**: page stays a thin server component; all interactivity in the client component; all math in the pure lib engine so it is unit-testable without a browser.
4. **Verify**: `/verify-app` — the new page must mount in the app smoke, gated correctly for its tier, with type-check/lint/build green.
5. **Report** the file list created, the tier wiring, and what remains deliberately stubbed (engine math to be built next).

## Acceptance

New tool reachable at /dashboard/tools/<slug>, listed on /tools, correctly gated (free renders; members shows sign-in card when signed out), all five gates green, smoke spec covers it.

## Guardrails
- Never bypass PremiumGate or hard-code tier checks in the page — lib/entitlements.ts is the single seam.
- No new state-management libraries; plain useState + pure engines is the suite-wide pattern.
- Scaffold only — engine math and real UI are their own phases with their own /verify-app.
