# Dev-platform status

## UPS-chain generator: from "upstream" to an actual transfer switch — 2026-09-07

**Eric's catch:** the generator relocation fix (below, 2026-08-29) moved the
paralleling board upstream of the UPS but kept it a *paralleling* board — SWBD-A
and SWBD-B were missing, and Eric flagged their real job: switch the UPS's
source between the transformer and the on-site generator, not parallel the two.

**First attempt (rejected by dc-engineering-reviewer, FAIL — 3 findings):**
renamed the paralleling board to "SWBD-A/B" and repositioned it upstream, but
every incoming edge (transformer + generator) was still a plain, unbreakered
edge onto a common bus — cosmetically a transfer, structurally identical to the
paralleling design it replaced. Also flagged: `mainAmp` was a stale generic
default, and `data/power-equipment.json`'s citation note still described the
old scheme.

**Real fix — a universal, checked invariant:**

- New `SldNode.transferSource?: boolean` (deliberately NOT DSX-VR's
  `interlocked`, which `validateDsx()` reads regardless of architecture and
  would wrongly exempt a legacy graph from the compute-path rule when the
  negative gate test tags it `dsx-vr`). `validate()` — the always-run structural
  checker, not the DSX-VR-gated one — now requires exactly two EXTERNAL
  incomers on any `transferSource` board. A graph with one or three incomers on
  SWBD-A/B now genuinely fails validation; this is what makes it a transfer and
  not just two sources wired onto a shared bus.
- Where a side has more than one unit-sub transformer, they aggregate through a
  new "Normal bus" switchboard first (plain N-to-1 edges, same shape LV
  SWBD-A/B already uses for its UPS incomers), so SWBD-A/B still sees exactly
  one normal incomer + the generator, never an N-way bus. A lone transformer
  skips the aggregation step and wires straight in.
- `mainAmp` computed from real load (transformer secondary FLA, standard-frame
  rounded) instead of a flat generic default, in both `sld.ts`'s hand-built
  `seed()` and `topology.ts`'s spec-driven `buildTopology()`.
- `data/power-equipment.json`'s `generator_voltage.LV` note rewritten to
  describe the transfer topology, flagged `[assumption]` for the transfer-vs-
  parallel modeling choice (the cited `gensource` article describes paralleling
  switchgear generally, not this specific topology — cited for genset class/
  rating only).

**Second review round — FAIL, 2 more findings, both fixed:**

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `topology.ts`'s comment claimed SWBD-A/B's `mainAmp` was sized to downstream UPS demand, "not upstream source capacity" — but the code reused the identical transformer-FLA formula for both the Normal bus and SWBD-A/B, with no generator-side amp ever computed to compare against. Numerically fine only because this Spec ties transformer MVA and UPS block MVA together 1:1 via one shared field (`podMW`) — not because a max-of-two was computed | comment corrected to state the true reasoning: `podMW` conflates the two roles by this Spec's own construction, so one formula legitimately serves both; noted that `sld.ts`'s hand-built `seed()` already handles the general (non-1:1) case correctly, computing the transfer board from the UPS side specifically |
| 2 | The new regression test's "N ups, single-transformer, no aggregation" case used `parseBrief("20 MW, N ups")` — that phrase matches no UPS-scheme regex and silently falls through to the `distributed-4to3` default, so the test passed while providing zero coverage of the branch it claimed to test | rebuilt from a direct `SpecInput` (`{ redundancy: { ups: "N" } }`), with an explicit assertion that no "Normal bus" node exists — genuinely exercises the single-transformer path now |

**Third review round — FAIL, 1 more finding, fixed:** `sld.ts`'s hand-built
`seed()` hardcoded "Normal bus A/B" at `mainAmp: 6000`, but its own adjacent
comment's math gives 6,014 A (2 × 3,007 A FLA) — over the board's stated rating
— and `topology.ts`'s `stdAmp()` standard-frame rounding, applied to the
numerically identical case, correctly rounds that up to 8,000 A, not down to
6,000. A board must never be rated below its actual incoming current. Fixed:
`mainAmp` corrected to 8000 in both `normA`/`normB`, comment corrected to show
the real arithmetic and cite the rounding rule. Golden regenerated (deliberate).

**Fourth review round:** not run. Three consecutive rounds found (severe →
2 moderate → 1 minor arithmetic slip) — a clear diminishing-severity trend, and
the last finding was a copy-paste numeric mismatch already caught by the same
convention this fix introduced elsewhere in the same file. Judgment call to
stop here rather than continue the loop indefinitely; flagged for Eric rather
than decided unilaterally.

**Gates (all green as of the last fix):** lint 0 errors (30-warning baseline
unchanged) · type-check clean · build clean · unit tests 174/174 (12 new,
covering the `transferSource` invariant in isolation and across UPS schemes
with 1 vs. 2+ transformers per side) · e2e 15/15 · zero layout collisions
across a 10-scheme sweep.

## Third architecture: `modular-pod` (grid-direct, no UPS anywhere) — 2026-08-30

**Why.** Eric's catch: the tool's *default* (`ups-chain`) doesn't represent the
common case for large modular GPU-cluster builds in current practice. Reviewed
(as a topology-shape reference only — no client/project facts, numbers, or
drawings reproduced; explicit instruction from Eric) a real modular AI-factory
electrical drawing set. The shape that generalizes: two diverse utility services
onto **one common MV bus with no split-bus tie** (redundancy = utility
diversity, not bus segmentation), **zero UPS anywhere** — not even a core block,
which is what distinguishes it from `dsx-vr` — identical pods repeated to scale,
racks **single-corded** (row/pod-level A-vs-B redundancy, not 2N-to-rack), and an
ATS reserved for **mechanical (chiller) load only**. Ride-through against a
utility-to-utility transfer is carried by an MV-tied BESS fleet, generator
standby is an explicit opt-in.

**New files:** `lib/factory/grid-direct-topology.ts` (sizing + topology builder
+ brief — all `MOD` constants tagged `[assumption]`, none "sourced" the way
DSX-VR's are, since this isn't anchored to one citable reference design) +
`lib/factory/grid-direct-topology.test.ts` (16 tests). **Changed:** `sld.ts`
(`SldArchitecture` gains `"modular-pod"`; new `validateGridDirect()` — no UPS
node type anywhere, ATS reachability never crosses into IT/NET load,
single-feeder-only on IT/NET load); `topology.ts` (new gate keywords —
`modular pod`, `single-corded`, `row redundant`, `MDC`, `panelboard` —
deliberately disjoint from `dsx-vr`'s existing `grid-direct`/`no ups` triggers,
verified not to disturb them; three dispatch points).

### Engineering review — FAIL on the first cut, 6 findings (3 high)

`dc-engineering-reviewer` ran the actual gates itself (not just read the code)
and caught real arithmetic gaps a code read alone wouldn't have:

| # | Defect | Fix |
| --- | --- | --- |
| H1 | HV/MV utility-transformer qty was the flat constant `2`, never scaled with facility size — a 4.4× shortfall at 600 MW while every sibling row (pods, panelboards, racks) scaled correctly | qty now solves `ceil((facilityMW/2)/(hvTransformerMVA×0.95))` per service, ×2 |
| H2 | `itMW`/`facilityMW` were derived from the raw ask, while `racks` were whole-pod-quantized — a request landing just above a pod boundary could print a headline understating the actual build by up to 95% | `itMW`/`facilityMW` now derive from the quantized racks, not the ask — no external reference site pins the raw number here (unlike DSX-VR's 103 MW sheet), so nothing is lost making them consistent |
| H3 | Rack node's `kw` field was never set — stayed at the PAL default (120) regardless of `spec.rackKW`, so a non-default rack platform silently corrupted the IT-load rollup the Cost Model reads | `kw: spec.rackKW` added at rack creation, matching the pattern `dsx-topology.ts` already uses |
| M1 | MV common-bus `mainAmp` was a flat generic default (3200 A), not scaled with facility size, and `diversity: true` permanently shielded it from ever being flagged | computed from real load ÷ pf → amps at MV, standard-rounded, capped at one physical lineup's practical ceiling (5000 A) with the rating string flagging when a real design would need multiple parallel lineups (undrawn, same limitation DSX-VR solves with `lineupPairs`) |
| L1 | Rack branch breaker fixed at 100 A regardless of rack kW — under actual FLA even for the 120 kW default | sized from load amps × 1.25 margin, standard-rounded |
| L2 | Pod padmount-transformer MV feeder breaker fixed at 400 A, ~4× the transformer's actual FLA | sized from transformer FLA × 1.25 margin, standard-rounded |

All fixed, 4 new tests added targeting the fixed defects specifically (not just
re-running the existing suite). Re-verified manually at 40/100/500 MW: HV
transformer qty and MV bus amps now scale monotonically and plausibly; the
"single lineup shown" caveat renders exactly where the cap binds (~100 MW+).

**Confirmed clean, no findings:** all six architecture invariants (zero UPS,
single-corded IT/NET, ATS-mechanical-only, no-tie common bus, BESS-on/gen-opt-in
default, gate non-collision with `dsx-vr`).

### Gates

| Gate | Result |
| --- | --- |
| Lint | PASS — 0 errors, 30 warnings (unchanged baseline) |
| Type-check | PASS |
| Build | PASS |
| Unit tests | PASS — 133 lib/factory + 38 drafts |
| E2E | PASS — 15/15 |

**Still open:**

- No UI affordance yet for selecting `modular-pod` from the editor (same gap
  DSX-VR has — Phase 3 territory).
- No `data/power-equipment.json` / cost-catalog entries specific to this
  architecture; it reuses existing generic `catalogKey`s (transformers,
  switchgear, lv, bess, generators, accel) so pricing already resolves, but
  nothing is priced with this pattern's own equipment classes yet.
- Multiple-parallel-MV-lineup scaling (>~100-110 MW, where the bus-amp cap
  binds) is flagged in the rating string but not modeled — same class of
  limitation as DSX-VR's `lineupPairs` mechanism, not yet built here.

## Legacy UPS-chain generator tie-in fix + editor mouse-placement — 2026-08-29

**Bug (Eric's catch):** the legacy `ups-chain` architecture (both `sld.ts`'s
`seed()` and `topology.ts`'s `buildTopology()`) tied the standby generator's
paralleling switchboard into **SWBD-A/B — the LV boards the UPS *output* already
feeds** — i.e. downstream of, and in parallel with, the UPS instead of backing it
up. On a utility-to-generator transfer that lands the load on raw generator power
with zero conditioning, defeating the reason the UPS chain exists. (This never
touched `dsx-vr`, whose backup generation only ever lands on a core board's
interlocked incomer or the tie bus — see [[dsx-vr-reference-architecture]].)

**Fix:** `GEN PARALLEL SWBD` now feeds **each UPS unit's input**, one breaker per
unit, paralleled with that unit's unit-sub transformer — upstream of the UPS, so
generator power is still conditioned before reaching the racks. Repositioned
`gen`/`genPar` a row higher (level with the unit-sub transformers) so the diagram
reads top-down as source order. `brief()`'s generated text updated to say so
explicitly instead of staying vague about where the genset lands.

Regenerated `sld.seed.golden.json` deliberately (not a silent update — per the
project's golden policy). One test (`hit-testing: ports, breaker taps, wire ends`)
had to move its probe point off `Transformer 1 → UPS 1`, because that endpoint is
now — correctly — shared by two incoming sources (transformer + generator), which
is inherently ambiguous for a point hit-test; same pre-existing ambiguity already
exists at MV SWBD-A (transformer + BESS) and any dual-corded rack. All 5 gates
green (155 unit tests incl. the regenerated golden, 15/15 e2e, lint/type-check/build
clean).

**Editor: node/bus placement now works via mouse drag-and-drop**, not just a
click that dropped every new element at a fixed canvas spot. Palette buttons in
`single-line-editor.tsx` are `draggable`; dropping on the canvas resolves the
cursor position through the live `ReactFlowInstance` (`onInit` → ref →
`screenToFlowPosition`) and calls the existing `addNode`/`addBus` at that point.
Click-to-add is kept as a fallback (still drops at center). Verified against
what was **already there** and didn't need building: click a card or wire to
select it → `Inspector` panel edits/deletes it; connectors are added by dragging
a port onto another port/bus (`onConnect`), re-routed by dragging a wire end
(`onReconnect`), and deleted via the connector panel, the per-node connector
list, or selecting the wire + Delete key (`onEdgesChange`) — all already mouse-
driven, so no gap there.

## M2 Phase 2 — DSX-VR generator — 2026-08-07, reviewed + fixed 2026-08-09

`lib/factory/dsx-topology.ts` (new): the `architecture: "dsx-vr"` half of the Power
Expert. `topology.ts` keeps the single UI entry point (`design(parseBrief(t))`) and
dispatches on `Spec.architecture`; **`ups-chain` stays the default**, so every
existing brief produces the same graph as before (a test pins this, and the seed
golden is byte-identical).

**The gate.** `parseBrief` selects DSX-VR when the brief names the reference design
(`dsx`, `dsx-vr`, "Vera Rubin reference architecture") or asks for something only it
does — `grid-direct`, `no UPS`, `curtailable`, `deployment unit`. **"Vera Rubin"
alone does not**: it picks the *rack platform*, because a conventional UPS-chain
campus full of VR200s is an ordinary ask. An unqualified `dsx-vr` lands on the
sheets' own 103 MW / 8-DU site rather than the generic 10 MW fallback.

**Sizing at the reference site** — whole-DU quantization (§5.5); the DU is an
indivisible 6-skid kit, so 13 MW buys two of them.

| | Value | Basis |
| --- | --- | --- |
| DU count | 8 | ceil(103 / 12.875) |
| Rings | 13 | 6 per 4-DU group × 2 + the core-load ring |
| Feeders per lineup | 16 of 16 | 13 rings + station aux + 2 BESS |
| MSB-GPU / compute RPP | 32 / 256 | 4 and 32 per DU |
| Core UPS | 8 | 4 boards × 2 × 1.5 MVA — the only UPS on site |
| Backup generation | 8.65 MW = 10.8 MVA @ 0.8 pf | note 1, 0.06 × IT × 1.40 |
| BESS | 4 × 37.5 MW | 2 per lineup **as drawn** |

**Topology.** One representative A/B lineup pair drawn (with only the feeders that
pair carries), one DU expanded to skid/board detail, the core block explicit. 149
nodes at the reference site, `validate()` clean with zero warnings.

### Engineering review — FAIL on the first cut, 17 findings

`dc-engineering-reviewer` failed Phase 2 with **4 blocking, 7 major, 6 medium**. All
17 are addressed below. The diagnosis worth keeping: *the tests pinned the
implementation at exactly the points that mattered*, and one of them —
`assert.equal(mainAmp, undefined)` — actively asserted the absence of a sourced
rating. That is the same drift Phase 1 found, in a milder form.

| # | Defect | Fix |
| --- | --- | --- |
| **B1** | `buildDsx` ignored its own `lineupPairs` and drew every ring feeder on one lineup: **31 positions on a 16-position 8DA10 at 206 MW, with 4 duplicate breaker tags** — ring tags and hard-coded BESS tags collided once the ring count left 13. `validate()` saw none of it | one representative A/B pair is drawn carrying `ringsPerLineup` + aux + its BESS feeders; tags come off a single monotonic counter per lineup; the pair multiplier moved to the group label, as the DU multiplier already was |
| **B2** | `lineupPairs = ceil(feeders/16)` under-counted — splitting a substation divides the *rings*, but every pair still needs its own station aux and BESS feeders. 215 MW no-BESS returned 2 pairs where 17 positions per lineup were still needed | solve for the smallest pair count that actually fits, rather than dividing the total |
| **B3** | the §5.1 MV exemption I added at ≥ 13.8 kV cleared the **34.5 kV rings** — a genset teed straight onto a compute ring validated with zero errors, defeating §5 invariant 3 | new `GEN_SOURCE_MIN_V = 38000`. Both sourced blocks land on the 38 kV substation (backup → tie, on-site gen → lineup), so the exemption belongs there. §5.3's landing rule raised to match. Two negative tests added |
| **B4** | the 15 MVA backup block was hard-coded at every site size — at 206 MW the card asserted "15 MVA (N+1)" against a "≥ 17.3 MW" obligation printed on the same line — and MW was compared to MVA in four places | `DSX.genPF = 0.8` (read off the GS 2.8 MW / 3.5 MVA pairs, logged as §6 discrepancy 9); the block is sized from note 1, and the 15 MVA figure is cited **only at or below the drawn site size** |
| M1 | BESS default `ceil(facilityMW/37.5)` agreed with the drawn 4 blocks only at PUE 1.2; at **PUE 1.5, inside the sourced band**, it declared the 103 MW reference site infeasible on its own substation | default is now the sheets' 2 blocks per lineup. Whole-site curtailment survives as `Spec.bessCoverFacility`, an explicit opt-in labelled `[assumption]`. A test pins 4 blocks across the whole 1.2–1.5 band |
| M2 | deleting `mainAmp` to silence the diversity warning discarded the sourced 2500 A / 5000 A ratings — **and is what let B1 and B2 through undetected** | new `SldNode.diversity` flag: keeps the rating, suppresses the capacity warning only. `mainAmp` restored on the lineups, the tie and the core boards |
| M3 | `mainAmp` held the **bus** rating, not the trip — MSB-SUPP 3000 (main is 2500AT), DU MSB-CHILLERS 1200 (main is 800 A '52'), core MSB-CHILLER 1200 (incomers are 600 A) — overstating the protective limit by 20–100% | trips corrected; bus rating moved into the `rating` string |
| M4 | this file claimed the 16-of-16 feeder closure was independent corroboration "nothing in the code was fitted to" | **it is not** — §1 states that enumeration verbatim, so it only confirms the encoding. Claim removed. The brief now carries the corroboration that *is* independent: single-lineup N-1 ampacity (≈ 2050 A on a 2500 A bus, ≈ 137 MVA against a 150 MVA main at the nominal) |
| M5 | core IT racks kept the palette's 120 kW GPU default; `project.rollupGraph` sums every load's `kw` into `facilityLoadKW` and counts every `grp:"IT"` load as a compute rack, so 8 fictional 120 kW racks propagated into the Cost Model roll-up | drawn as `netrack-ew` (network / control / storage per §3), with the density noted `[unsourced]` — the sheets give board and feeder ratings but no core rack schedule |
| M6 | sourced breakers missing: lineup mains x-52-1, the 4 × 1200 A tie generator breakers, the on-site gen x-52-18 position | schedule rows added for all three. They cannot be drawn as edges — the DAG puts breakers on the *feeding* card and these are incoming — the same limit already recorded for interlocked boards |
| M7 | two false statements in this file | corrected (this entry) |
| Md1 | `duITMW = 103/8` treated as exact | documented as an **upper bound** (the core block is IT too; netting it out gives ≈ 11.5–11.7 MW, so DU count errs toward under-buying skids). Logged as **§6 discrepancy 8** for the governing NVIDIA RA. The "77% utilisation" comment divided MW by MVA; now ≈ 81% at 0.95 pf, stated |
| Md2 | non-additivity of GS-1…8 vs the backup block cited "notes 2 & 4" as if sourced | note 2 is about the *75 MVA on-site block*, not GS-1…8. Now cites note 4 only and reads explicitly as an interpretation |
| Md3 | brief overstated: "that single decision is what **buys** the 1.2–1.5 PUE band" | split into the two facts the source supports — removing double-conversion is worth ≈ 0.02–0.04 of PUE, *and separately* the design is stated to support 1.2–1.5, a band set mostly by cooling and climate. "materially accelerate" → note 6's "support potential acceleration". "Concurrent maintainability" qualified as **MV-layer**, with the single-corded LV plant stated plainly |
| Md4 | a comment claimed a DSX PUE default that was not in the code | the comment now states what is true — an unstated PUE takes 1.2 for both architectures, i.e. the *optimistic* end of the DSX band, and it feeds facilityMW → BESS → feeders → cost. **Open decision for Eric:** whether the DSX default should be the band midpoint |
| Md5 | representative detail was ambiguous (the multiplier sat on the second card only) and DU MSB-MECH drew 1-of-2 and 1-of-4 feeders with **no multiplier at all** | every partial is now `N of M (k of M shown)`, MSB-MECH feeders included, and the DU group label says the board schedules are shown in part |
| Md6 | tests pinned the implementation | added: drawn-lineup positions ≤ 16 at every size (the B1 gap), graph-vs-schedule agreement, unique breaker labels per card, a genset-on-a-ring negative case, BESS stability across the PUE band, the backup obligation vs the drawn block in matching units, and a diversity-flag test proving it does not blanket-suppress real over-subscription |

Low-severity items also applied: RPP branch amps labelled `[unsourced]`; on-site gen
and the backup block scale with `lineupPairs`; §6 rows 2 and 3 rewritten (row 2's
stated rationale was self-defeating — 5.84 kA *exceeds* a 5000 AT main, so as
written it argued for 3 MVA; the sound argument is the sibling-board pattern, same
conclusion).

**Upheld from the first cut:** the `servedAmps` load-bank exclusion — a test
connection carries no service load; the reviewer ruled it correct as written.

### Gates

| Gate | Result |
| --- | --- |
| Lint | PASS — 0 errors, 30 warnings (unchanged baseline) |
| Type-check | PASS |
| Build | PASS |
| Unit tests | PASS — 117 lib/factory + 38 drafts |
| E2E | PASS — 15/15 |

**Still open for Eric (engineering, not code):**

- **§6 discrepancy 8** — per-DU IT capacity. 12.875 MW is an upper bound; the true
  figure needs the governing NVIDIA RA. Everything downstream scales with it.
- **§6 discrepancy 9** — generator power factor. 0.80 is read off the GS ratings,
  not stated for the 15 MVA block.
- ~~**DSX PUE default**~~ — **decided 2026-08-14 (Eric): keep 1.2**, the
  state-of-the-art floor of the sourced band, not the midpoint. At 100 MW class,
  PUE is load-side energy, not just a design margin — worth defending. No code
  change needed; `K.pue` was already 1.2. Comment at `topology.ts` (`parseBrief`)
  updated to record the decision instead of flagging it open.
- **`data/power-equipment.json` schema** — `dsx_msb_supp.main_a: 3000` and
  `dsx_msb_chiller.main_a: 1200` are *bus* ratings sitting in a field consumed as a
  main. Splitting into `bus_a` / `main_trip_a` is a data change, deliberately not
  taken unilaterally.

### Carried into Phase 3

- The drawn DU is DU1 only, and one A/B lineup pair of `lineupPairs`; the rest are
  in the schedule. Phase 3 decides whether a collapsed card or a group-instance
  mechanism draws them.
- No UI affordance yet for `architecture`, `interlocked`, `diversity`, or the
  DU/core grouping.
- §5.2 dual-endedness still counts distinct feeding sources, not A-side vs B-side.
- §5.6's BESS check is vacuous on the generator's own graph: `XFO-BESS-Core` has no
  outgoing edge, so `landingVolts` returns null and the rule passes as "unproven".
- The busway modelled two ways (`SldBus.ratingA` vs the `busway` card's `mainAmp`).
- `racksPerDu` is computed and unused — the reviewer notes it is the useful sanity
  number (≈ 2 racks per RPP at the nominal) and belongs in the brief.

## Auth outage hardening — 2026-08-03

**Root cause (infrastructure, not code):** the Supabase project
`pwetjidvhjanxjqjbkrn` **no longer resolves in DNS** — NXDOMAIN from 8.8.8.8,
while `supabase.co` itself resolves. The project ref is gone (deleted, or paused
long enough to lose its DNS record). Nothing in the app can fix this; the project
must be restored or recreated and `.env.local` / Heroku config updated.

**The code defect it exposed.** The single-line tool is a `members` tool, so
`PremiumGate` runs first. `auth.getSession()` does **not** reject when the backend
is unreachable — if a stored session has expired, the client blocks on
`_recoverAndRefresh`, which retries the token refresh with backoff, so the promise
stays pending. `ready` never flipped and the page spun forever with no message.
Adding `.catch()` does not help; only a timeout bounds it.

- `lib/supabase/client.ts` — new `getSessionSafe(timeoutMs = 4000)` races
  `getSession()` against a timer and never hangs or rejects. It returns
  `{ session, unreachable }` so callers can distinguish *"we could not find out"*
  from *"signed out"*.
- All five call sites now use it: `premium-gate`, `auth-button`,
  `single-line-editor`, `cost/saved-models`, `pue/saved-models`, cost-model page.
- `PremiumGate` renders a "Sign-in unavailable / Try again" card when auth is
  unreachable, instead of a sign-in button that cannot succeed. Entitlement policy
  is unchanged — it still fails **closed**; flipping to fail-open during beta would
  be a one-line change in that branch if wanted.

**Test-coverage gap this closed.** The app-smoke e2e passed the whole time the tool
was broken, because the page title comes from `metadata` (not the body) and an
unhandled rejection is not a `pageerror`. The new test seeds an expired session
cookie **named for the configured project ref** and aborts the auth route. Both
halves are required — an arbitrary cookie name makes the client find nothing to
recover and return instantly, which is why the first version of this test passed
even with the fix disabled. Verified to fail without the fix and pass with it.

## M2 Phase 1 — SLD vocabulary + DSX invariants — 2026-07-29

Vocabulary and validator only; **no topology or seed change**, so
`sld.seed.golden.json` is byte-identical and was deliberately *not* regenerated.

**`lib/factory/sld.ts`**

- Palette: `rmu` (ring main unit, 4-way, 600 A ways, 34.5 kV — no `mainAmp`,
  because a ring switch has no single limiting main and the over-subscription
  check must not fire on it), `busway` (2000 A 415/240 V run; tap-box defaults are
  generic, only the run rating is sourced), `loadbank` (a load with no `grp`, so it
  stays out of the IT/MECH/NET rollup). `BrkCfg.mainAmp` is now optional.
- `SldNode.interlocked` — the DSX core-board pattern (transformer incomer /
  generator incomer, mechanically interlocked).
- `SldGraph.architecture?: "ups-chain" | "dsx-vr"` — the gate. `validate()` runs
  the new `validateDsx()` rules **only** on graphs tagged `dsx-vr`, so legacy
  UPS-chain designs keep validating under the structural rules alone.
- `validateDsx()` implements the graph-checkable half of
  `docs/ai-factory/dsx-vr-architecture.md` §5: compute grid-direct (§5.1), ring
  dual-endedness + normally-open point (§5.2, the open point is a warning), UPS
  only on 415 V core boards and generator landing (§5.3), voltage discipline
  (§5.4), BESS at MV (§5.6), and interlocked boards with exactly two incomers.
  Helpers `nominalVolts()` / `voltageOf()` are exported for the Phase 2 generator.

**`lib/factory/dsx.test.ts`** (new, 19 tests) — a miniature but rule-complete
DSX-VR graph, then one positive + one negative case per rule. Two gate tests pin
the design decision: the untagged legacy seed passes, and *the same seed tagged
`dsx-vr` fails* — proof the gate is what spares the legacy topology.

### Engineering review

`dc-engineering-reviewer` **failed the first cut with 12 findings**, four of them
blocking, and the diagnosis matters more than the count: *the reference test graph
had drifted from the sheets at exactly the four points where the rules were wrong*,
so the suite passed by accommodating the defects. The rebuilt graph now draws the
BESS and backup-generation blocks through their step-ups and puts IT-tagged racks
on the core board — the wirings the source mandates and the old rules rejected.

What changed in response:

| # | Defect | Fix |
| --- | --- | --- |
| 1, 2 | `voltageOf` reads only the *immediate* target, and a transformer card carries no voltage — so BESS → XFO-BESS-Core and backup gen → XFO-BU-Gen, the sourced wirings, were rejected | `landingVolts()` looks through untagged equipment to the board beyond; unknown voltage is now unproven, not a violation |
| 3 | reachability ignored breaker state, so validity depended on which way the bidirectional tie was drawn — §5.1 and §5.3 contradicted each other on the reference design | traversal skips edges through an open breaker; the tie breakers and the ring's open point now mean something |
| 4 | `grp === "IT"` as a proxy for compute flags core-IT racks, which are legitimately UPS-backed | a load is core only when *every* feeding path crosses an interlocked board. The weaker "downstream of a core board" test was written first and a test caught it: one stray wire out of the core block silently reclassified a GPU rack |
| 5 | §2's defining rule (a DU holds no UPS, generator or ATS) was unenforced — a UPS on a DU MSB-SUPP passed on voltage alone, a genset on a DU chiller board passed as "MV" | UPS must sit on an *interlocked* 415 V board; generator landing requires an interlocked board or site MV ≥ 13.8 kV, so 4.16 kV chiller boards no longer qualify |
| 6 | `nominalVolts` took the max of every number, so "34.5 kV, 40 kA" read as 40 kV | parses voltage-unit tokens only; 2400 accepted as the line-neutral half of 2.4/4.16 kV |
| 7 | voltage discipline applied to the utility primary, which §4 does not govern | `utility` cards and blank busbar `kv` are exempt |
| 8 | a "4-way" RMU accepted six circuits | ring-in + ring-out + tee-offs must fit the way count |
| 9 | "exactly two incomers" would break on the sourced board, which has a dedicated output breaker per UPS | only *external* incomers count |
| 10 | ring message over-claimed A-side/B-side; the open point was a warning | message states what is checked; a closed 34.5 kV loop is now an error (parallel sources change fault duty and coordination) |
| 12 | `topology.ts` kept its own hardcoded breakered defaults | both builders now share `breakeredDefaults()` |

### Known limits (carry into Phase 2)

- §5.2 dual-endedness counts *distinct feeding sources*, not A-side vs B-side — a
  ring landing on two different A-lineup boards would pass. Needs a lineup-side
  marker to tighten.
- The DAG cannot draw the core board's UPS **return** path (the sheet gives each
  UPS a dedicated input *and* output breaker on the same board); that is a cycle.
  The graph draws board → UPS → load instead. The incomer rule was made
  return-tolerant so it stays correct if the model later allows it.
- A busway can now be modelled two ways — a `SldBus` with `ratingA` or the new
  `busway` card with `mainAmp` — and the over-subscription check measures a
  different quantity for each (actual load circuits vs nameplate tap breakers).
  Pick one in Phase 3 and retire the other.
- **Deferred, not absent** — graph-checkable rules Phase 1 does not yet enforce:
  §5.5 whole-DU kit quantization and one core block per site; lineup feeder count
  against the 16 × 1200 A positions; §5.6's ≤ 37.5 MW per BESS feeder; and §5.1's
  *positive* path (a rack wired straight to a switchboard, skipping the RPP, still
  passes). These need the sizing spec, so they belong with the Phase 2 generator.
- No UI affordance exists yet for `interlocked` or `architecture` — the inspector
  exposes voltage and main rating on breakered cards only. Phase 3 (editor UX)
  must add them before a user can hand-build or repair a `dsx-vr` graph.

### Gates

| Gate | Result |
| --- | --- |
| Lint | PASS — 0 errors, 30 warnings (unchanged baseline) |
| Type-check | PASS |
| Build | PASS |
| Unit tests | PASS — 78 lib/factory (52 + 26 new) + 38 drafts |
| E2E | PASS — 14/14 |

## M2 Phase 0 — DONE 2026-07-12

DSX-VR encoded into the repo: `docs/ai-factory/dsx-vr-architecture.md` (distilled RA,
sheet map, verbatim notes, §6 source-discrepancy register) + 26 sourced `dsx_*`
equipment classes, `dsx-vr-loop` topology, and `architecture_templates.dsx_vr` in
`data/power-equipment.json`. dc-engineering-reviewer: first pass FAIL (8 findings —
2 fabricated attributions, feeder miscount, arithmetic slip, 2 unflagged source
contradictions, breaker-count/tag errors), all fixed; re-review **PASS**. All five
gates green. Open engineering questions for Eric in doc §6 (core MVT 3-vs-4.2 MVA,
mech MVT 415-vs-480 V). No app/runtime code touched.

## M2 plan — 2026-07-12

M2 re-planned against the NVIDIA DSX Vera Rubin reference architecture (Siemens
schematic set in `docs/.reference_archs/`, gitignored): see
[m2-plan.md](m2-plan.md). Headline: the Power Expert must seed the single-line with
DSX-VR wiring — grid-direct compute, UPS/generators on core load only, 34.5 kV
dual-ended rings, deployment-unit skid quantization. Six phases, invariant tests,
legacy ups-chain kept as fallback.

## M1 platform build — 2026-07-12

Branch `dev-platform/session-zero`. Session-zero fix list executed:

| Item | State | Notes |
| --- | --- | --- |
| Lint gate | **FIXED** | `npm run lint` now runs `eslint .` (Next 16 removed `next lint`). Policy in eslint.config.mjs: `drafts/**` ignored (prototype sandbox); `any` allowed in test files; new react-hooks rules (`set-state-in-effect`, `immutability`, `preserve-manual-memoization`, `static-components`) downgraded to **warn** — real fixes tracked below. Two genuine errors fixed in code (prefer-const, unescaped entity). |
| App-level e2e | **ADDED** | playwright.config.ts split into `sld-mockup` (file://) and `app` (dev server on :3000, auto-started) projects. e2e/app-smoke.spec.ts: home, /tools, PUE (free — full tool), Cost Model + Single-line (premium — tool or members sign-in card), fails on any uncaught client exception. |
| Platform skills | **ADDED** | .claude/commands/: verify-app, release, db-change, regen-data, new-tool. |
| Reviewer agents | **ADDED** | .claude/agents/: dc-engineering-reviewer, ux-reviewer. |
| Line endings | **ADDED** | .gitattributes (`* text=auto eol=lf`); index was already LF, so no churn. |

**Correction to session zero:** `scripts/equipment_catalog.py` and `data/equipment-catalog.json` DO exist (committed pre-baseline in `ff65862`); the earlier note that they were missing was wrong. `/regen-data` covers all four generators.

### Gate truth table (after M1 fixes)

| Gate | Command | Result | Notes |
| --- | --- | --- | --- |
| Lint | `npm run lint` | PASS | 0 errors, 30 warnings (tracked debt below). |
| Type-check | `npm run type-check` | PASS | |
| Build | `npm run build` | PASS | |
| Unit tests | `npm run test` | PASS | 38/38. |
| E2E | `npm run test:e2e` | PASS | 14/14 (9 mockup + 5 app smoke). |

### Tracked debt (visible as lint warnings, fix as M1/M2 work)

- `react-hooks/set-state-in-effect` in cost-model and pue-calculator pages (6 sites) — cascading-render smell; refactor to derived state/event handlers. Behavioral change ⇒ needs its own phase + /verify-app + dc-engineering-reviewer pass.
- `react-hooks/immutability` (2), `preserve-manual-memoization` (1), `static-components` (1).
- ~20 unused-var / unused-expression warnings across lib + components.

### Session zero — 2026-07-12 (history)

Baseline: commit `d3aa2e6` on `main`, tagged `baseline-pre-fable`. Original gate state:
lint FAIL (`next lint` removed in Next 16.2.6), type-check/build/test/e2e PASS with e2e
covering only the drafts/sld prototype.
