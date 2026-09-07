# DSX Vera Rubin (DSX-VR) — electrical reference architecture, distilled

**Source document:** `docs/.reference_archs/Siemens-Schematics-for-DSX-VR.pdf` —
*Siemens UL Reference Design for DSX Vera Rubin NVL72, 100 MW Vera Rubin*,
S&L job DAT-SII-2026-054, dated 05/20/2026, 18 sheets. The PDF is licensed material
and is **deliberately gitignored** (`.reference_archs/` rule); this document and the
`dsx_vr` entries in `data/power-equipment.json` are the repo's durable, sourced
record of it. Every claim below carries its sheet reference. Read 2026-07-12.

**Machine-readable mirror:** `data/power-equipment.json` → `architecture_templates.dsx_vr`
(equipment classes under `equipment` with `source: "siemens_dsx"`). The Power Expert
generator consumes the JSON, not this prose — keep both in sync (M2 plan §3, Phase 0).

## Sheet map

| Sheet | Content |
|---|---|
| E5.0.1 (p1) | Campus one-line: utility primaries, MSG.A/B 38 kV lineups, tie + backup gen, BESS, on-site gen, DU1–DU4 rings, core-load row, numbered notes |
| E5.0.2 (p2) | DU5–DU8 rings (fed from A-52-10…15 / B-52-10…15) |
| E5.1 (p3) | One DU's LV detail: MSB-GPU1–4, MSB-SUPP ×2, MSB-CHILLERS ×2, MSB-MECH ×2 (views V1–V6 = RMU1–6) |
| Views 1–6 (p4–9, letter) | Per-RMU detail: V1 GPU1+SUPP · V2 GPU2 · V3 GPU3+SUPP · V4 GPU4 · V5/V6 chillers+mech |
| E5.2 (p10) | Core IT loads: MSB-SUPP1–4 + core mech boards, generators, UPS |
| MSB-SUPP1–4 (p11–14, letter) | Core IT board detail: dual interlocked incomers, 2×1.5 MVA Li-ion UPS, GS-1..4, RPPs, busways, load bank |
| MSB-CHILLERS 1&2 / 3&4 (p15, p17) | Core chiller boards: MVT-5, GS-5/GS-7, interlocked 600 A incomers |
| MSB-MECH1/2 (p16, p18) | Core mech boards: MVT-6, GS-6/GS-8, interlocked 2000 A incomers |

## Numbered notes (E5.0.1, verbatim)

> IT LOAD ≈ 103 MW. REFERENCE DESIGN SUPPORTS SITE PUE RANGE OF 1.2–1.5. SITE
> UTILITY DEMAND AND EQUIPMENT RATINGS TO BE DETERMINED PER PROJECT-SPECIFIC ANALYSIS.
>
> 1. BACKUP GENERATION ≈ 6% OF TOTAL IT LOAD + 40% × (6% LOAD) OF MECHANICAL LOAD.
> 2. BACKUP GENERATION MAY BE REPLACED BY EQUIVALENT ON-SITE BASE GENERATION.
> 3. ON-SITE GENERATION REPRESENTS A MIX OF RESOURCES INCLUDING THERMAL UNITS,
>    HRSG, FUEL CELLS, AND SOLAR.
> 4. OPTIONAL BACKUP GENERATION CONFIGURED AT LV LEVEL FOR CORE LOAD.
> 5. DU1–DU4 ELECTRICALLY IDENTICAL TO DU5–DU8 (EXCLUDING CORE IT).
> 6. BESS SIZING PER CUSTOMER REQUIREMENTS. UP TO 37.5 MW PER FEEDER SHOWN TO
>    ENABLE FULLY FLEXIBLE/CURTAILABLE LOAD OPERATION AND SUPPORT POTENTIAL GRID
>    INTERCONNECTION ACCELERATION.

Interpretation of note 1 (used by the generator): the backup-generation obligation is
the **core slice only** — ≈ 6% of site IT plus the mechanical load that supports that
slice (40% of it): `backup_mw ≈ 0.06 × IT_MW × 1.40` (103 MW ⇒ ≈ 8.7 MW). The drawn
MV backup block is 15 MVA (N+1) — consistent headroom above 8.7 MW. The per-board
core generators GS-1…GS-8 (4×2.8 MW + 2×2.8 MW + 2×1.5 MW = 19.8 MW) are the
*optional LV/MV alternative* (notes 2 & 4), not additive.

## 1 · Site level (E5.0.1)

- **Two utility primaries**, each through a main transformer **SUB1.T.A / SUB1.T.B,
  90/120/150 MVA** (sheet label reads "90/120/150 KVA" — an obvious unit typo for MVA
  at a 100 MW site; see §6), into two independent 38 kV switchgear lineups (Siemens
  **8DA10**): **SUB1.MSG.A** (MGC-A) and **SUB1.MSG.B** (MGC-B). Each lineup: 38 kV
  main bus, **2500 A, 40 kA**, one 2500 A main (A-52-1 / B-52-1), **16 feeder
  positions 1200 A** — x-52-2 station aux, x-52-3…15 ring feeders, x-52-16/17 BESS —
  plus the on-site generation block on a **2500 A** x-52-18, one 2500 A tie breaker,
  and 1× future space.
- **Tie switchgear SUB1.MSG.T** (38 kV, 2500 A, 40 kA) links the lineups through two
  **normally-open** 2500 A breakers (**A-52T-1, B-52T-1**). A **backup-generation
  block, 15 MVA (N+1)** — note 1 sizing, note 2 substitutable — connects to the tie
  bus through **XFO-BU-Gen (13.8–34.5 kV)** and 4×1200 A generator breakers (the
  fourth drawn dashed, a future position).
- **BESS (optional): 2 blocks per lineup, 37.5 MW @ 2 hrs each (7.5 MWh units)**,
  each through **XFO-BESS-Core = 5 × 8.3 MVA, 34.5 kV**, on dedicated 1200 A feeders
  (note 6: ≤ 37.5 MW per feeder; purpose = flexible/curtailable load + grid
  interconnection acceleration).
- **On-site generation block (optional): 75 MVA per lineup** (note 3: thermal units,
  HRSG, fuel cells, solar), on a dedicated connection at each lineup's outboard end.
- **MV distribution: dual-ended open-loop rings at 34.5 kV.** Each ring leaves an
  A-lineup 1200 A feeder, daisy-chains one RMU position across four DUs, and lands on
  a B-lineup 1200 A feeder. 6 rings serve DU1–DU4 (A-52-3…8 side, as drawn), 6 rings
  serve DU5–DU8 (A-52-10…15 / B-52-10…15, E5.0.2), plus the core-load ring. Normal
  operating state is radial (an open point per ring); the second end is the
  maintenance/failure path. Concurrent maintainability lives at MV — there is **no
  2N duplication of the LV plant**.

## 2 · Deployment Unit (×8; note 5) — the repeatable ~12.9 MW IT block

Six skid-mounted RMUs per DU, each RMU a 34.5 kV 4-way switch unit (600 A ways)
with skid-mounted VPI dry-type MVTs (E5.0.1 skid boxes; E5.1 + views for LV):

| Skid | MVT(s) | LV board(s) | Feeders (as drawn) |
|---|---|---|---|
| RMU1 | **4.2 MVA 34.5 kV→480 V Δ** + **2.0 MVA 34.5 kV→415/240 V** (#4/0 CU gnd) | **MSB-GPU1** 5000 A 480 V 3Ph-3W, main 5000AF/5000AT LSI, metered, ground bus + **MSB-SUPP** 3000 A 415/240 V 3Ph-4W, main 3000AF/2500AT LSIG | GPU: **8 × RPP 1000 A** on 1200AF/1000AT LSI · SUPP: **4 × RPP 800 A** on 1200AF/800AT LSIG |
| RMU2 | 4.2 MVA 34.5 kV→480 V (compute only) | MSB-GPU2 (as GPU1) | 8 × RPP 1000 A |
| RMU3 | as RMU1 | MSB-GPU3 + MSB-SUPP #2 | as RMU1 |
| RMU4 | as RMU2 | MSB-GPU4 | 8 × RPP 1000 A |
| RMU5 | **4.2 MVA 34.5 kV→2.4/4.16 kV** (Δ-Y, #4/0 CU) + **1.5 MVA 34.5 kV→480 V Δ** (campus sheets label it 415 V — see §6) | **MSB-CHILLERS** 1200 A 2.4/4.16 kV 3Ph-4W, 800 A main ('52') + **MSB-MECH** 2000 A 480 V 3Ph-3W, main 2000AF/2000AT LSI | Chillers 1–4 on **200 A '52'** · mech: 2×1200AF/800AT LSI + 4×400AF/225AT LSI |
| RMU6 | as RMU5 | MSB-CHILLERS #2 (chillers 5–8) + MSB-MECH #2 | as RMU5 |

Per-DU totals: 4×4.2 MVA compute (16.8 MVA), 2×2.0 MVA support, 2×4.2 MVA chiller,
2×1.5 MVA mech; 4 MSB-GPU + 2 MSB-SUPP + 2 MSB-CHILLERS + 2 MSB-MECH;
32 compute RPPs (1000 A) + 8 support RPPs (800 A); 8 MV chillers.

**Defining rule: no UPS, no generator, no ATS anywhere inside a DU.** GPU compute is
grid-direct — this is what makes the 1.2–1.5 PUE band and the BESS/curtailment
strategy possible. Chillers are 4.16 kV machines.

## 3 · Core load (×1 per site — "NETWORK/CONTROL/SHARE" per E5.0.1; E5.2 + letter sheets)

- **Core IT (4 skids, CORE IT RMU1–4):** per skid, 4-way 600 A RMU + **4.2 MVA
  34.5 kV→415 V** MVT (MVT-1…4; the letter sheets also carry a conflicting
  "3 MVA" callout — see §6) → **MSB-SUPP1…4, 5000 A, 415 V, 3Ph-4W**:
  - dual **interlocked** 5000AF/5000AT LSIG incomers (MVT / generator, dashed
    CONTROL link) + 5000AF/5000AT bus-section breakers;
  - **2 × 1.5 MVA double-conversion UPS with Li-ion strings per board** (AC-input
    bypass jumper) — **the only UPS in the entire reference design**;
  - optional **generator GS-1…GS-4: 2.8 MW / 3.5 MVA, 415/240 V** (note 4), through
    5000AF/5000AT LSIG-100% pair, with **load-bank camlock connectors** and generator
    enclosure panel; 150AF/125AT LSI gen-aux feeder;
  - feeders: **4 × RPP 400 A** (600AF/400AT LSI), **2 × busway 2000 A 415/240 V
    3Ph-4W** (2000AF/2000AT LSIG), **4 × 3000AF/2500AT LSIG** (a dedicated input
    and output breaker per UPS), **5000AF/5000AT load-bank breaker**.
- **Core mech (2 skids, CORE MECH RMU5–6):**
  - **MVT-5: 3 MVA, 34.5 kV→2.4/4.16 kV** → **MSB-CHILLER (core), 1200 A,
    2.4/4.16 kV, 3Ph-4W** — dual interlocked **600 A '52'** incomers; second incomer
    = **GS-5 / GS-7: 2.8 MW / 3.5 MVA, 2.4/4.16 kV (opt.)** via 600AF/600AT
    LSIG-100% + load-bank camlocks; core chillers on 200 A '52' feeders.
  - **MVT-6: 1.5 MVA, 34.5 kV→277/480 V** → **MSB-MECH1/2, 2000 A, 277/480 V,
    3Ph-4W** — dual interlocked 2000AF/2000AT LSIG incomers; second incomer =
    **GS-6 / GS-8: 1.5 MW / 1.875 MVA, 277/480 V (opt.)**; mech equipment on
    1200AF/800AT LSIG feeders.

## 4 · Voltage discipline

| Level | Where |
|---|---|
| 38 kV bus / 34.5 kV nominal | Site lineups, rings, RMU ways, MVT primaries |
| 13.8–34.5 kV | Backup-gen block step-up (XFO-BU-Gen) |
| 480 V 3Ph-3W | Compute (MSB-GPU), DU mech (MSB-MECH) |
| 415/240 V 3Ph-4W | DU support (MSB-SUPP), core IT (MSB-SUPP1–4), core busways |
| 2.4/4.16 kV 3Ph-4W | Chillers (DU + core) |
| 277/480 V 3Ph-4W | Core mech (MSB-MECH1/2) |

## 5 · Logical invariants (what the single-line tool must enforce — M2 plan §1.4)

1. Compute path = utility → 38 kV lineup → 34.5 kV ring → RMU → 4.2 MVA MVT →
   MSB-GPU → RPP 1000 A → rack. No UPS/genset/ATS on this path.
2. Every ring is dual-ended (A-feeder + B-feeder) with a normal open point.
3. UPS only downstream of core-IT 415 V boards; generators only as interlocked
   second incomers of core boards or as the 15 MVA MV backup block on the tie.
4. Voltage discipline per §4.
5. DU quantization: whole DUs only (fixed skid/board/RPP kit); one core block per
   site; lineup feeder count grows with ring count.
6. BESS on dedicated MV feeders, ≤ 37.5 MW each, never behind a DU transformer;
   on-site generation at MV lineup ends; backup block on the tie.
7. Schedule and graph derive from one spec (per-DU kit × DU count + core + site).

## 6 · Source discrepancies & sheet typos (flagged, not silently resolved)

Contradictions inside the schematic set itself. Where the encoding had to pick a
value, the pick and its rationale are recorded here — **Eric to confirm against the
governing NVIDIA RA / project basis of design.**

| # | Sheet says | Encoding uses | Rationale |
|---|---|---|---|
| 1 | E5.0.1: main transformers "90/120/150 **KVA**" | 90/120/150 **MVA** | Obvious unit typo — a 100 MW site cannot ride a 150 kVA transformer |
| 2 | MSB-SUPP1–4 letter sheets & E5.2 carry a "MVT-1 / 415V / **3 MVA**" callout beside a transformer symbol labeled "**4.2 MVA** / 415V"; E5.0.1 core row says 4.2 MVA | **4.2 MVA** for MVT-1…4 | 2-of-3 labels, **plus the sibling-board pattern**: this design routinely runs transformer FLA above the board main trip — DU MSB-SUPP is 2.0 MVA at 415 V = 2783 A on a **2500 AT** main (111%). 4.2 MVA at 415 V = 5842 A on a 5000 AT main (117%) fits that pattern; 3 MVA (4170 A, 83%) would be the outlier. *(An earlier version of this row argued 4.2 MVA "matches the 5000 A board" — it does not: 5.84 kA exceeds a 5000 AT main, so as written that argument favoured 3 MVA. The pattern argument is the sound one; same conclusion.)* If 3 MVA is the nameplate, core transformer capacity is overstated ~40% |
| 3 | E5.0.1/E5.0.2 label DU mech MVTs "1.5 MVA 34.5KV-**415V** MECH. LOAD"; E5.1/Views 5–6 say "34.5KV-**480V**" into MSB-MECH 2000A **480V** 3PH-3W | **480 V** | The LV board it feeds is rated 480 V on its own detail sheet — **and the ampacity settles it independently**: 1.5 MVA at 480 V = 1804 A, which fits the 2000 A board; at 415 V it is 2087 A, which does not |
| 4 | E5.1/View 1 MSB-GPU main reads "**5000AT / 5000AT**" | 5000AF/5000AT | Frame/trip typo — every sibling board follows the xxxxAF/xxxxAT convention |
| 5 | E5.0.1 core-IT generator boxes read "2.8 **MVA** (OPT.)"; letter sheets read "2.8**MW**/3.5MVA" | 2.8 MW / 3.5 MVA | Letter sheets are the detail authority; campus label loses the distinction |
| 6 | E5.0.1: both B-lineup BESS feeder breakers appear labeled "**B-52-16**" | 2 distinct feeders (x-52-16/17 per the A side) | Duplicate-tag typo on the B side |
| 7 | Tie block: 4th generator breaker drawn dashed | Encoded as 4 positions, 4th noted "future" | Dashed = future per drafting convention |
| 8 | Site IT ≈ 103 MW over 8 DUs ⇒ 12.875 MW IT per DU — but the **core block is IT load too** ("NETWORK/CONTROL/SHARE", §3), and the sheets never state a per-DU figure | **12.875 MW**, flagged as an **upper bound** | Dividing the site total by 8 allocates the core's share to the DUs. Netting the core out gives ≈ 11.5–11.7 MW, ~10% lower, which would mean ~10% MORE DUs per MW — so `duCount = ceil(itMW / 12.875)` errs toward **under**-buying skids, and the generator then adds a whole core block on top of it. Cannot be settled from this sheet set; needs the governing NVIDIA RA. Loading sanity: 4 × 4.2 MVA = 16.8 MVA compute MVT per DU ⇒ 12.875 MW is ≈ 81% of nameplate at 0.95 pf |
| 9 | Generation is rated in MVA at the block level (15 MVA backup) and in MW/MVA pairs at the unit level (GS-1: 2.8 MW / 3.5 MVA); note 1 states the obligation in **MW** | **pf = 0.80**, read off the GS ratings | Comparing a note-1 MW obligation against an MVA nameplate is a unit error. 2.8/3.5 = 0.80 across every GS unit, so 0.80 is applied to the 15 MVA block (⇒ ≈ 12 MW). Confirm against the specified genset. Note also that the 15 MVA block is a **103 MW datum**, not a scaling rule — above the nominal, note 1 governs |
