Keep the AI Factory Single-line "Power Expert" tutorial accurate whenever the tool changes. Re-derive every factual claim the tutorial makes from the current code + data + generator output (never from memory), update the draft (and the published post if it exists), and verify.

## Input

$ARGUMENTS — optional hint about what changed (e.g. "added vr200 platform", "renamed Design button", "podMW now 2.0"). If empty, diff the source-of-truth files against the last commit and refresh every claim.

## Artifacts this skill maintains
- **Draft:** [drafts/single-line-power-expert-tutorial.html](drafts/single-line-power-expert-tutorial.html) — house article format (Fraunces/Newsreader/IBM Plex Mono; masthead → kicker → h1/deck/byline → numbered `§` sections → `.box` callouts → figure → table → `.refs` → `.disc`).
- **Published (if present):** `content/articles/<slug>.mdx` + `public/images/<slug>/*.svg` — only if the draft has already been published via `/publish-draft`. Find it by searching `content/articles` for the single-line tutorial; if none, the draft is the only target.

## Source of truth (read these; the tutorial is downstream of them)
| Claim in the tutorial | Where the truth lives |
|---|---|
| Parser grammar (what words it reads), defaults | `lib/factory/topology.ts` → `parseBrief`, `normalizeSpec`, the `K` constants, `SCHEMES`, `TIERS`, platform keywords (GB300/GB200/Rubin) |
| Equipment ratings / pod sizes / redundancy templates / tiers / densities | `data/power-equipment.json` |
| UI: route, steps, labels, buttons, example chips, brief panel, roll-up | `components/factory/single-line-editor.tsx` and `app/(app)/dashboard/tools/single-line/page.tsx` |
| Gating ("members", free-in-beta, sign-in) | `lib/entitlements.ts` (`TOOL_TIER`), `components/app/premium-gate.tsx` |
| Worked-example numbers (facility MW, IT, racks, GPUs, pods, full schedule) | the generator output — **recompute, never hand-edit** |
| Single-line shape in the SVG figure | `buildTopology` in `lib/factory/topology.ts` (block layout + which schemes draw what) |

## Process

1. **See what changed.** `git diff HEAD -- lib/factory/topology.ts data/power-equipment.json components/factory/single-line-editor.tsx app/(app)/dashboard/tools/single-line/page.tsx lib/entitlements.ts components/app/premium-gate.tsx` (plus anything $ARGUMENTS names). For each change, decide which tutorial claims it touches.

2. **Recompute the worked example from the running code** (the tutorial uses one canonical prompt — keep it). Don't trust the existing numbers; regenerate:
   ```bash
   npx tsx -e 'import {parseBrief,sizePowerChain} from "./lib/factory/topology";const s=parseBrief("48 MW GB300 campus, Tier III, N+1 generation, distributed 4-to-make-3 UPS, 2N to the rack");const z=sizePowerChain(s);console.log(JSON.stringify({facilityMW:z.facilityMW,itMW:z.itMW,racks:z.racks,gpus:z.gpus,pods:z.podsNeeded,tier:s.tier,pue:s.pue,schedule:z.schedule},null,1))'
   ```
   Update the headline (`§03`/`§06`), the caption, and **every row of the schedule table** to match this output exactly. If the example prompt itself is no longer representative (e.g. a default changed), pick a prompt that still showcases distributed-redundant UPS + 2N and say so.

3. **Re-derive the parser grammar box** (`§02`, "What the Power Expert reads") from `parseBrief`: capacity (IT vs facility keywords), PUE default, platform keywords + their kW, the UPS/generation/distribution scheme tokens, tier, cooling, and the name rule. If a platform/scheme/keyword was added or removed, edit the box and the example chips list to match. Cross-check defaults against `normalizeSpec` + `K`.

4. **Re-sync the UI walkthrough** (`§01`–`§05`) against `single-line-editor.tsx`: the route, the bar label ("Power Expert"), the input placeholder, the **Design** button text, the example-chip strings (`EXAMPLES`), the brief-panel title + Copy/× controls, undo/redo + validation behavior, and the left-rail roll-up fields. Any renamed control or changed copy must be corrected verbatim. Re-check gating wording against `entitlements`/`premium-gate` (currently members, free in beta).

5. **Update the SVG figure if the topology shape changed** (e.g. a new default UPS scheme, added/removed blocks). Keep it schematic and on-brand; it illustrates one representative power block with campus multipliers noted in the caption.

6. **Mirror to the published post** if one exists: apply the same edits to `content/articles/<slug>.mdx` (Callout/table/MDX equivalents) and regenerate any affected `public/images/<slug>/*.svg`. If only the draft exists, skip.

7. **Verify.**
   - Numbers: the schedule in the article must equal the step-2 generator output (diff them).
   - Optional live check (when UI copy/labels changed): drive the running dev server with Playwright to confirm the bar, Design button, brief panel, and toast still match — the tool is members-gated, so seed a client-only `@supabase/ssr` cookie (`sb-<ref>-auth-token` = `base64-` + base64url(JSON.stringify(session)) with a future `expires_at`) to pass the purely client-side gate; do not modify the gate or server.
   - If `/publish-draft` was used, run `npx velite build` and confirm no errors.

8. **Report** a tight changelog: which claims changed, old → new (especially any schedule numbers), and whether the published post was touched. Flag anything the code now does that the tutorial *can't* express cleanly (a candidate for a new section).

## Guardrails
- Numbers and grammar come from **running the code / reading the source**, never from the prior draft or memory — the draft is the thing being corrected.
- Preserve the house article format and voice; keep the methodology/caveats disclaimer and the standard Drybulb CTA.
- This skill edits documentation only (the draft, the MDX, its SVGs). Do not change app/runtime code, `lib/`, or `data/` to make the tutorial "true" — if code and tutorial disagree, the code wins and the tutorial is updated to match. Commit only if asked.
