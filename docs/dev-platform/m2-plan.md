# M2 plan — launch-ready AI Factory Single-line creator (DSX-VR faithful)

**Goal.** Ship the Single-line tool publicly with a Power Expert that seeds the canvas
with a design that is *logically faithful to the NVIDIA DSX Vera Rubin reference
architecture* — not the generic UPS-chain it draws today. A first-time AI-factory
builder types a brief and gets the DSX-VR wiring: MV loops, deployment-unit skids,
grid-direct compute, UPS/generators on core load only, with a sized schedule that
rolls into the Cost Model.

**Source of truth.** `docs/.reference_archs/Siemens-Schematics-for-DSX-VR.pdf` —
"Siemens UL Reference Design for DSX Vera Rubin NVL72, 100 MW Vera Rubin"
(S&L job DAT-SII-2026-054, 05/2026, 18 sheets: E5.0.1/E5.0.2 campus, E5.1 DU LV,
E5.2 core, per-board views). The PDF is deliberately gitignored (licensed material);
facts derived from it are encoded into `data/*.json` with a source tag, per the
project's IP stance. All numbers below were read from the sheets on 2026-07-12.

---

## 1 · DSX-VR electrical requirements (distilled from the schematic set)

### 1.1 Site (100 MW class, IT ≈ 103 MW, PUE 1.2–1.5)

- **Dual utility service:** two utility primaries, each through a main transformer
  (90/120/150 MVA ONAN/ONAF ratings) into its own 38 kV switchgear lineup
  (Siemens 8DA10): **SUB1.MSG.A** and **SUB1.MSG.B**, each 38 kV main bus, 2500 A,
  40 kA, main breaker 2500 A + ~16 feeder breakers 1200 A + station aux.
- **Tie switchgear SUB1.MSG.T** (38 kV, 2500 A) between A and B with two normally-open
  2500 A tie breakers (A-52T-TIE / B-52T-TIE). A **backup-generation block, 15 MVA
  (N+1), 13.8–34.5 kV via XFO-BU-Gen**, lands on the tie bus (4×1200 A gen breakers).
- **BESS (optional, per side ×2): 37.5 MW @ 2 hrs (7.5 MWh units)** each through
  XFO-BESS-Core = 5 × 8.3 MVA, 34.5 kV. Note 6: sized per customer, **up to 37.5 MW
  per feeder**, purpose = fully flexible/curtailable load + grid-interconnection
  acceleration.
- **On-site generation block (optional, per side): 75 MVA** — note 3: mix of thermal
  units, HRSG, fuel cells, solar. Note 2: backup generation may be replaced by
  equivalent on-site base generation.
- **MV distribution = open-loop rings, dual-ended:** each ring leaves an A-side
  1200 A feeder, daisy-chains the same RMU position across DU1→DU4 (or DU5→DU8),
  and terminates on a B-side feeder. 6 rings per 4-DU group (one per RMU row)
  + the core-load ring. Concurrent maintainability comes from the loop + interlocks,
  **not** from 2N duplication of the LV plant.

### 1.2 Deployment Unit (DU) — the repeatable block, 8 per site (~12.9 MW IT each)

Each DU = 6 skid-mounted RMUs (4-way, 600 A ways, 34.5 kV) with dedicated MVTs
(VPI dry-type) and LV boards. Note 5: DU1–DU4 electrically identical to DU5–DU8
(excluding core IT).

| Skid | Transformers | LV board | Feeders |
|---|---|---|---|
| RMU1 | 4.2 MVA 34.5 kV→480 V Δ (compute) **+ 2.0 MVA 34.5 kV→415/240 V (support)** | MSB-GPU1 5000 A 480 V 3Ph-3W (main 5000AF/AT LSI) + MSB-SUPP 3000 A 415/240 V 3Ph-4W (main 3000AF/2500AT LSIG, #4/0 CU ground) | GPU: 8 × RPP 1000 A (1200AF/1000AT LSI) · SUPP: 4 × RPP 800 A (1200AF/800AT LSIG) |
| RMU2 | 4.2 MVA 34.5 kV→480 V (compute only) | MSB-GPU2, same as GPU1 | 8 × RPP 1000 A |
| RMU3 | same as RMU1 (compute + support) | MSB-GPU3 + second MSB-SUPP | as RMU1 |
| RMU4 | same as RMU2 | MSB-GPU4 | 8 × RPP 1000 A |
| RMU5 | 4.2 MVA 34.5 kV→2.4/4.16 kV (chillers) **+ 1.5 MVA 34.5 kV→480 V (mech)** | MSB-CHILLERS 1200 A 4.16 kV 3Ph-4W (800 A main '52') + MSB-MECH 2000 A 480 V 3Ph-3W (2000AF/AT LSI) | Chillers 1–4 on 200 A '52' · mech: 2×1200AF/800AT + 4×400AF/225AT |
| RMU6 | same as RMU5 | chillers 5–8 + second MSB-MECH | as RMU5 |

**The defining rule: no UPS and no generators anywhere in a DU.** GPU compute is
grid-direct (this is what enables PUE 1.2–1.5 and the BESS/curtailment strategy).
Chillers are medium-voltage (4.16 kV) machines.

### 1.3 Core load (one per site — network / control / storage)

- **CORE IT (4 skids, RMU1–RMU4):** each 4.2 MVA 34.5 kV→415 V MVT (600 A 4-way RMU,
  "TO MSG-A") → **MSB-SUPP1..4, 5000 A, 415 V, 3Ph-4W** with:
  - dual **interlocked** 5000AF/5000AT LSIG incomers (MVT side / generator side,
    CONTROL dashed link) + bus-section breakers;
  - **2 × 1.5 MVA double-conversion UPS with Li-ion strings per board** (AC-input
    bypass jumper drawn) — *the only UPS in the entire design*;
  - optional **generator GS-1..4, 2.8 MW/3.5 MVA, 415/240 V** with 5000AF LSIG-100%
    pair, load-bank camlock connectors, generator enclosure panel;
  - feeders: 4 × RPP 400 A (600AF/400AT LSI), 2 × busway 2000 A 415/240 V,
    2 × 3000AF/2500AT LSIG (UPS in/out), 150AF/125AT aux, 5000 A load-bank breaker.
- **CORE MECH (2 skids, RMU5–RMU6):**
  - **MVT-5 3 MVA 34.5 kV→2.4/4.16 kV → MSB-CHILLER 1200 A 4.16 kV** — dual
    interlocked 600 A '52' incomers; other incomer = **GS-5/GS-7 2.8 MW/3.5 MVA,
    2.4/4.16 kV (opt.)** with 600AF/600AT LSIG-100% + load-bank camlocks; core
    chillers on 200 A '52' feeders.
  - **MVT-6 1.5 MVA 34.5 kV→277/480 V → MSB-MECH1/2 2000 A 277/480 V 3Ph-4W** — dual
    interlocked 2000AF/2000AT LSIG incomers; other incomer = **GS-6/GS-8
    1.5 MW/1.875 MVA 277/480 V (opt.)**; mech on 1200AF/800AT LSIG.
- **Backup-generation sizing rule (note 1):** ≈ **6% of total IT load + 40% × (6%
  load) of mechanical load** — i.e. generators exist for the core slice only.

### 1.4 Logical invariants the tool must enforce (validator-level truths)

1. Compute (GPU) power path = utility → 38 kV MSG → 34.5 kV ring → RMU 4-way →
   4.2 MVA MVT → 480 V MSB-GPU → 1000 A RPP → rack. **No UPS, no genset, no ATS on
   this path.**
2. Every 34.5 kV ring lands on both an A-bus feeder and a B-bus feeder (dual-ended;
   drawn with the normal open point so the operating state is radial).
3. UPS appears **only** downstream of a core-IT 415 V MSB; generators appear **only**
   as the second interlocked incomer of a core board (415 V, 480 V, or 4.16 kV) or
   as the 15 MVA MV backup block on the tie bus.
4. Voltage discipline: 38 kV bus / 34.5 kV distribution; 480 V 3Ph-3W compute;
   415/240 V 3Ph-4W support & core IT; 2.4/4.16 kV chillers; 277/480 V core mech.
5. Fixed quantization: a DU is indivisible (4 compute + 2 mech skids, boards and
   RPP counts per §1.2); site scales in whole DUs (100 MW class = 8) + exactly one
   core block; MSG A/B feeder count grows with ring count.
6. BESS connects at dedicated MV feeders (≤ 37.5 MW per feeder), never behind a DU
   transformer; on-site generation block connects at MV; 15 MVA backup block on the
   tie.
7. Schedule ↔ graph consistency: equipment counts in the sized schedule and nodes
   in the emitted single-line derive from one spec (per DU × DU count + core).

---

## 2 · Gap analysis (today → required)

| Area | Today | Required for DSX-VR |
|---|---|---|
| Topology philosophy | Everything behind distributed-redundant UPS; LV paralleling gensets; SWBD-A/B + 2N RPP to every rack (`lib/factory/topology.ts` buildTopology) | Grid-direct compute; UPS/gen on core only; MV rings + DU skids (§1) |
| Voltages | 230 kV / 13.8 kV / 480 V only (`K.voltages`) | 34.5/38 kV, 480 V, 415/240 V, 2.4/4.16 kV, 277/480 V |
| SLD vocabulary (`lib/factory/sld.ts` PAL) | utility, genset, bess, paralleling, transformer, ups, switchboard, rpp, rack, net/mech loads | + **RMU (4-way, 600 A)**, **busway**, **load bank**, interlocked dual-incomer boards; multi-voltage board labels. (Open-ring = path between two sources — the DAG + open-breaker model already supports it.) |
| Equipment KB (`data/power-equipment.json`) | SemiAnalysis generic classes (75 MVA HV xfmr, 2.5 MVA unit subs, 3 MW gensets, 400 kVA UPS modules) | + DSX-VR classes with ratings from §1 (8DA10 lineup, 1200 A feeders, RMU skid, 4.2/2.0/1.5/3.0 MVA VPI MVTs, MSB-GPU/SUPP/CHILLER/MECH, RPP 1000/800/400 A, 1.5 MVA Li-ion UPS, GS 2.8 MW MV+LV / 1.5 MW LV, BESS 37.5 MW blocks, 75 MVA on-site gen block, 15 MVA backup block), each `sourced` → Siemens DSX-VR set |
| RA data (`data/reference-architectures.json`) | gb300-nvl72 etc. (compute BOM only) | + `dsx-vr-100mw` power template: DU composition, core block, ring plan, site quantization |
| Power Expert grammar (`parseBrief`) | schemes: N/N+1/2N/distributed-4to3/catcher; no architecture concept | + `architecture: "dsx-vr"` trigger ("dsx", "vera rubin reference", "grid-direct", "no ups", "curtailable"); DU/MW quantization; keep legacy UPS-chain as the non-DSX fallback |
| Sizing (`sizePowerChain`) | pods × UPS blocks math | DU-quantized schedule (per-DU fixed BOM × DU count + core block + site gear + BESS + note-1 gen sizing) |
| Seeding | `design(parseBrief())` wired (single-line-editor.tsx:215) but emits the generic chain | same wiring, DSX-VR graph out; default seed + example chips become DSX-VR |
| /design-power-topology skill | drives `drafts/sld/topology.js` (prototype fork of the generator) | point at `lib/factory/topology.ts` via `npx tsx` (single source of truth; drafts copy frozen) |
| Cost rollup (`lib/factory/project.ts` → catalog) | catalogKeys for generic classes | catalog entries/keys for the new DSX classes so the BOM prices |
| Tests | goldens for the UPS-chain seed; engine op tests; app-smoke e2e | + DSX invariants (§1.4) as node tests; DSX golden; Playwright expert-prompt flow |

---

## 3 · Build plan (phases; each ends `/verify-app` green; engineering-math phases
get a `dc-engineering-reviewer` pass; commits only when Eric asks)

**Phase 0 — Distill the RA into the repo (docs + data, no behavior).**
Write `docs/ai-factory/dsx-vr-architecture.md` (§1 of this plan, expanded, with a
sheet-by-sheet source map). Extend `data/power-equipment.json` (+ schema note) with
the DSX-VR equipment classes and a `dsx_vr` topology template; add
`dsx-vr-100mw` to `data/reference-architectures.json`; `/regen-data`.
*Acceptance:* dc-engineering-reviewer confirms every number traces to the PDF sheet.

**Phase 1 — SLD vocabulary.** Add `rmu`, `busway`, `loadbank` to the palette +
breaker-bank configs (600 A 4-way; interlocked dual-incomer flag on switchboards);
extend `validate()` with the §1.4 invariants that are graph-checkable (no UPS/gen on
a compute path, ring dual-ended-ness, voltage tags). Regenerate goldens deliberately
(`scripts/gen-sld-golden.ts`) — a golden diff is the reviewed artifact, never a
silent update.

**Phase 2 — Generator: DSX-VR architecture mode.** `Spec.architecture:
"dsx-vr" | "ups-chain"` (legacy default preserved for existing briefs);
`sizePowerChain` gains DU quantization + core block + note-1 backup-gen sizing +
BESS-per-feeder rule; `buildTopology` emits the DSX-VR single-line — campus level
(MSG-A/B, tie + backup block, BESS, on-site gen, rings) with one DU expanded to
skid/board detail and the core block drawn explicitly; `brief()` rewritten for
DSX-VR (grid-direct story, curtailment/BESS rationale, schedule from §1.2/1.3).
`parseBrief` grammar per §2. Node tests: the §1.4 invariant suite + count formulas
(e.g. 100 MW ⇒ 8 DU, 32 MSB-GPU, 256 compute RPPs, 8 core UPS, note-1 gen MW).

**Phase 3 — Editor UX to launch quality.** Default seed = 1-DU DSX-VR (specced
vr200/NVL72 racks); example chips ("100 MW DSX Vera Rubin campus", "give me one
deployment unit", legacy prompts still work); DU/skid visual grouping on the canvas
(reuse the existing group mechanism); left-rail rollup shows the DU × N + core
structure; inspector shows board ratings verbatim (5000 A 480 V 3Ph-3W …).
ux-reviewer pass.

**Phase 4 — BOM & Cost Model join.** Add the DSX classes to
`data/equipment-catalog.json` (estimate-tagged pricing; sourced where we have it),
map catalogKeys, verify `rollupGraph` → Cost Model itemized BOM prices a 1-DU and a
100 MW design end-to-end. dc-engineering-reviewer pass on the join.

**Phase 5 — Ship.** Playwright: expert-prompt → DSX graph renders → rollup numbers
sane (app project, real page). `/sync-single-line-tutorial` re-derives the tutorial
from the new generator (worked example = the 100 MW DSX-VR design). Entitlements
stay `members` (free in beta). `/verify-app` full pass → Eric's go → `/release`
(Heroku CLI path) → launch blog post via `/publish-draft`.

**Explicitly out of scope for M2** (parked for M3/object model): multi-tool entity
propagation, editable per-breaker protective settings (LSI/LSIG kept as labels),
short-circuit/arc-flash calcs, DU5–DU8 vs DU1–DU4 core asymmetry beyond the one
core block, cooling-plant hydronics.

## 4 · Verification (definition of done for M2)

1. `npm run test` — DSX invariant suite green (every §1.4 rule has a test).
2. Golden: `buildTopology({architecture:"dsx-vr", itMW:103})` snapshot reviewed
   against §1 by dc-engineering-reviewer, then frozen.
3. `/verify-app` PASS (five gates + tool smoke).
4. Manual: type "100 MW DSX Vera Rubin campus" in the running app → canvas shows
   MSG-A/B + tie/backup + rings + DU detail + core block; no UPS under any MSB-GPU;
   schedule table matches §1.2/1.3 counts; Cost Model receives the BOM.
5. Tutorial regenerated and factually consistent (numbers recomputed, not hand-set).

## 5 · Rollback

Each phase is a normal commit on the M2 branch; `baseline-pre-fable` and the
phase-N tags are the diff floors. The legacy `ups-chain` architecture stays
selectable throughout, so reverting the default is a one-line change, not a revert
of the engine.
