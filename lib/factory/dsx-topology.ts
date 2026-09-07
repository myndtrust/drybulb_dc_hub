// ─────────────────────────────────────────────────────────────────────────────
// DSX Vera Rubin generator — the `architecture: "dsx-vr"` half of the Power Expert.
//
// Turns a Spec into the sized schedule + single-line of the *NVIDIA DSX Vera Rubin*
// reference design, rather than the generic UPS-chain of ./topology. The two share
// one Spec and one Sizing shape; ./topology dispatches on `spec.architecture` so the
// UI keeps a single entry point (`design(parseBrief(text))`).
//
// SOURCE OF TRUTH. Every number here mirrors `data/power-equipment.json`
// → `architecture_templates.dsx_vr`, distilled in `docs/ai-factory/dsx-vr-architecture.md`
// from the Siemens UL Reference Design for DSX Vera Rubin NVL72 (S&L DAT-SII-2026-054,
// 05/2026, 18 sheets — licensed, gitignored). Citations below are to that doc's
// sections; `[derived]` marks a value computed from sourced numbers rather than read
// off a sheet, and `[unsourced]` a drafting choice the sheets do not fix.
//
// The design in one sentence: compute is GRID-DIRECT (utility → 38 kV lineup →
// 34.5 kV dual-ended ring → RMU skid → MVT → MSB-GPU → RPP → rack, with no UPS,
// generator or ATS anywhere on it); only the one core block per site — network,
// control and storage — is UPS- and generator-backed. That is what buys the
// 1.2–1.5 PUE band and makes the whole compute load curtailable against the BESS.
// ─────────────────────────────────────────────────────────────────────────────

import {
  PAL,
  breakeredDefaults,
  defaultBreakers,
  type Breaker,
  type SldGraph,
  type SldNode,
} from "./sld";
import type { ScheduleRow, Sizing, Spec } from "./topology";

const ceil = (x: number) => Math.ceil(x - 1e-9);
const round1 = (x: number) => Math.round(x * 10) / 10;

// ── Knowledge constants (mirror data/power-equipment.json → architecture_templates.dsx_vr) ──
export const DSX = {
  /** Site nominal as drawn: "IT LOAD ≈ 103 MW", 8 deployment units (§1, §2). */
  itMWNominal: 103,
  duCountNominal: 8,
  /** IT MW carried by one DU. [derived] 103 / 8 = 12.875 — the sheets state the
   *  site IT total and the DU count, never the per-DU load.
   *
   *  This is an UPPER BOUND, and the code should be read as such. The core block
   *  ("NETWORK/CONTROL/SHARE", §3) is IT load too, so dividing the site total by 8
   *  silently allocates the core's share to the DUs; netting it out gives roughly
   *  11.5–11.7 MW. `duCount = ceil(itMW / duITMW)` therefore errs on the side of
   *  UNDER-buying skids, and the generator then adds a whole core block on top, so
   *  the modelled site IT exceeds `spec.itMW` by the core share off-nominal. Only
   *  the governing NVIDIA RA can settle it — logged as §6 discrepancy 8.
   *
   *  Loading check: 4 × 4.2 MVA = 16.8 MVA of compute MVT per DU, so 12.875 MW is
   *  ≈ 81% of nameplate at 0.95 pf (≈ 85% at 0.90). A sane transformer loading. */
  duITMW: 103 / 8,
  pueRange: [1.2, 1.5] as const,

  // Site level — §1
  utilityPrimaries: 2,
  mainTransformer: "90/120/150 MVA", // ONAN/ONAF; §6 note 1 = the "KVA" sheet typo
  lineupKV: "38 kV", //                Siemens 8DA10, SUB1.MSG.A / SUB1.MSG.B
  lineupBusA: 2500,
  lineupFaultKA: 40,
  lineupFeederA: 1200,
  /** 16 × 1200 A feeder positions per lineup: x-52-2 station aux, x-52-3…15 ring
   *  feeders, x-52-16/17 BESS. The tie (x-52T-1) and the on-site generation block
   *  (x-52-18) are separate 2500 A positions. §1 */
  lineupFeederPositions: 16,
  tieA: 2500,
  ringKV: "34.5 kV",
  /** 6 rings per 4-DU group (one per RMU row), plus the core-load ring. §1 */
  ringsPerDuGroup: 6,
  dusPerGroup: 4,

  /** MV backup-generation block on the tie bus, through XFO-BU-Gen (13.8–34.5 kV).
   *  15 MVA (N+1) as drawn at the 103 MW nominal; note 1 gives the obligation. §1 */
  backupBlockMVA: 15,
  backupXfoKV: "13.8–34.5 kV",
  /** Generator power factor. [unsourced] — the sheets rate generation in MVA (the
   *  15 MVA block) and in MW/MVA pairs (GS-1: 2.8 MW / 3.5 MVA = 0.80), so 0.80 is
   *  read off the GS ratings and applied to the block. Needed because note 1 states
   *  the obligation in MW: comparing it to an MVA nameplate is a unit error. */
  genPF: 0.8,
  /** Note 1 verbatim: "BACKUP GENERATION ≈ 6% OF TOTAL IT LOAD + 40% × (6% LOAD) OF
   *  MECHANICAL LOAD" → 0.06 × IT × 1.40. At 103 MW IT ⇒ 8.7 MW. §"Numbered notes" */
  backupMW: (itMW: number) => 0.06 * itMW * 1.4,

  /** BESS: 7.5 MWh units in 37.5 MW / 2 h blocks, each through XFO-BESS-Core
   *  (5 × 8.3 MVA, 34.5 kV) on a dedicated 1200 A feeder. Note 6 caps a feeder at
   *  37.5 MW and leaves total sizing to the customer. §1 */
  bessBlockMW: 37.5,
  bessDurationH: 2,
  bessBlocksPerLineup: 2, // as drawn: x-52-16 / x-52-17 on each lineup
  bessXfo: "5 × 8.3 MVA · 34.5 kV",

  /** Optional on-site base generation, 75 MVA per lineup (note 3: thermal, HRSG,
   *  fuel cells, solar; note 2: may replace the backup block). §1 */
  onsiteGenMVA: 75,

  // Deployment unit — §2. Six skid-mounted 4-way 600 A RMUs; the kit is indivisible.
  du: {
    skids: 6,
    msbGpu: 4, //      MSB-GPU1…4, 5000 A 480 V 3Ph-3W, main 5000AF/5000AT LSI
    msbSupp: 2, //     MSB-SUPP ×2, 3000 A 415/240 V 3Ph-4W, main 3000AF/2500AT LSIG
    msbChiller: 2, //  MSB-CHILLERS ×2, 1200 A 2.4/4.16 kV 3Ph-4W, 800 A '52' main
    msbMech: 2, //     MSB-MECH ×2, 2000 A 480 V 3Ph-3W (§6 note 3), main 2000AF/2000AT
    rppGpu: 32, //     8 × RPP 1000 A per MSB-GPU (1200AF/1000AT LSI)
    rppGpuA: 1000,
    rppSupp: 8, //     4 × RPP 800 A per MSB-SUPP (1200AF/800AT LSIG)
    rppSuppA: 800,
    mvChillers: 8, //  4 per MSB-CHILLERS, on 200 A '52'
    mvtComputeMVA: 4.2, // 34.5 kV → 480 V Δ
    mvtSupportMVA: 2.0, // 34.5 kV → 415/240 V
    mvtChillerMVA: 4.2, // 34.5 kV → 2.4/4.16 kV Δ-Y
    mvtMechMVA: 1.5, //    34.5 kV → 480 V Δ (§6 note 3)
  },

  // Core block — §3. One per site: "NETWORK/CONTROL/SHARE", the only UPS- and
  // generator-backed load in the design.
  core: {
    itSkids: 4, //   CORE IT RMU1…4 → MSB-SUPP1…4, 5000 A 415 V 3Ph-4W, interlocked
    mechSkids: 2, // CORE MECH RMU5…6, each carrying one chiller + one mech board
    mvtCoreITMVA: 4.2, //    34.5 kV → 415 V (§6 note 2 records the 3 MVA conflict)
    mvtCoreChillMVA: 3.0, // MVT-5, 34.5 kV → 2.4/4.16 kV
    mvtCoreMechMVA: 1.5, //  MVT-6, 34.5 kV → 277/480 V
    upsPerBoard: 2, //       2 × 1.5 MVA double-conversion, Li-ion — the ONLY UPS
    upsMVA: 1.5,
    rpp400PerBoard: 4, //    600AF/400AT LSI
    busway2000PerBoard: 2, // 2000 A 415/240 V 3Ph-4W, 2000AF/2000AT LSIG
    /** GS-1…GS-8, the optional LV/MV alternative to the MV backup block (notes 2
     *  and 4) — NOT additive with it. 4 × 2.8 MW (415/240 V, core IT) + 2 × 2.8 MW
     *  (2.4/4.16 kV, core chillers) + 2 × 1.5 MW (277/480 V, core mech) = 19.8 MW. */
    genITMW: 2.8,
    genITMVA: 3.5,
    genChillMW: 2.8,
    genChillMVA: 3.5,
    genMechMW: 1.5,
    genMechMVA: 1.875,
  },

  /** VR200 NVL144 — the platform the reference design is drawn for. */
  rackKW: 200,
  gpusPerRack: 144,
} as const;

/** Voltage labels, kept in one place so they match §4's discipline exactly. */
const V = {
  lineup: "38 kV",
  ring: "34.5 kV",
  gpu: "480 V", //      MSB-GPU, DU MSB-MECH
  supp: "415/240 V", // DU MSB-SUPP, core busways
  coreIT: "415 V", //   MSB-SUPP1…4
  chiller: "2.4/4.16 kV",
  coreMech: "277/480 V",
} as const;

// ── Sizing ───────────────────────────────────────────────────────────────────

/** DSX-specific counts, carried alongside the shared Sizing fields. */
export interface DsxCounts {
  duCount: number;
  /** 6 rings per 4-DU group + 1 core-load ring. */
  rings: number;
  /** 1200 A feeder positions used on ONE lineup, after the ring plan is split
   *  across `lineupPairs`: its share of rings + station aux + its BESS feeders.
   *  Always ≤ DSX.lineupFeederPositions. */
  feedersPerLineup: number;
  /** Rings landing on one lineup of one pair. */
  ringsPerLineup: number;
  /** BESS feeders on one lineup. */
  bessPerLineup: number;
  /** How many A/B lineup PAIRS the feeder demand needs. The reference design draws
   *  one pair with 16 × 1200 A positions, which covers the 103 MW site exactly; a
   *  larger site outgrows the substation and needs another pair. */
  lineupPairs: number;
  bessBlocks: number;
  bessMW: number;
  /** Note-1 backup-generation obligation, MW. */
  backupMW: number;
  coreUps: number;
  coreGenMW: number;
  msbGpu: number;
  rppCompute: number;
  racksPerDu: number;
}

export function sizeDsx(spec: Spec): Sizing & { dsx: DsxCounts } {
  const facilityMW = round1(spec.itMW * spec.pue);
  const racks = ceil((spec.itMW * 1000) / spec.rackKW);
  const gpus = racks * spec.gpusPerRack;

  // §5.5 — the site scales in WHOLE deployment units. A DU is an indivisible kit
  // of 6 skids / 10 boards / 40 RPPs, so a 20 MW ask buys 2 DUs, not 1.55.
  const duCount = Math.max(1, ceil(spec.itMW / DSX.duITMW));
  const rings = DSX.ringsPerDuGroup * ceil(duCount / DSX.dusPerGroup) + 1; // + core ring

  // Note 6 caps a FEEDER at 37.5 MW and leaves the total to the customer ("BESS
  // SIZING PER CUSTOMER REQUIREMENTS"). The default is therefore the count the
  // sheets actually draw — 2 blocks per lineup, scaling with the lineup pairs the
  // ring plan needs — not a derivation.
  //
  // The tempting alternative, sizing the fleet to cover facility load so the WHOLE
  // site is curtailable, is a defensible engineering reading of note 6's stated
  // purpose but it is an [assumption], not a derivation: it agrees with the drawn
  // 4 blocks only at PUE 1.2, and at PUE 1.5 — inside the source's own 1.2–1.5
  // band — it declares the 103 MW reference site infeasible on its own substation.
  // `bessCoverFacility` exposes it as an explicit opt-in instead of a default.
  const bessPerLineupBase = spec.bessCoverFacility
    ? ceil(ceil(facilityMW / DSX.bessBlockMW) / 2)
    : DSX.bessBlocksPerLineup;
  // §5.5 — the lineup feeder count grows with the ring count against 16 × 1200 A
  // positions. Splitting the substation into more A/B pairs divides the RINGS, but
  // every pair still needs its own x-52-2 station aux and its own BESS feeders, so
  // `ceil(total / 16)` under-counts. Solve for the smallest pair count that
  // actually fits, rather than dividing the total.
  const perLineup = (pairs: number) =>
    ceil(rings / pairs) + 1 + (spec.bess ? ceil(bessPerLineupBase / pairs) : 0);
  let lineupPairs = 1;
  while (perLineup(lineupPairs) > DSX.lineupFeederPositions) lineupPairs++;
  const feedersPerLineup = perLineup(lineupPairs);
  const bessPerLineup = spec.bess ? ceil(bessPerLineupBase / lineupPairs) : 0;
  const bessBlocks = bessPerLineup * 2 * lineupPairs;
  const bessMW = bessBlocks * DSX.bessBlockMW;
  const ringsPerLineup = ceil(rings / lineupPairs);

  const backupMW = DSX.backupMW(spec.itMW);
  const coreBoards = DSX.core.itSkids;
  const coreUps = coreBoards * DSX.core.upsPerBoard;
  const coreGenMW =
    DSX.core.itSkids * DSX.core.genITMW +
    DSX.core.mechSkids * DSX.core.genChillMW +
    DSX.core.mechSkids * DSX.core.genMechMW;

  const msbGpu = duCount * DSX.du.msbGpu;
  const rppCompute = duCount * DSX.du.rppGpu;
  const racksPerDu = ceil(racks / duCount);

  const dsx: DsxCounts = {
    duCount, rings, feedersPerLineup, ringsPerLineup, bessPerLineup, lineupPairs, bessBlocks, bessMW, backupMW,
    coreUps, coreGenMW, msbGpu, rppCompute, racksPerDu,
  };

  // At or below the drawn site the sheets' own absolute figures apply; above it
  // they are a datum from a smaller design and must not be restated as if general.
  const nominal = duCount <= DSX.duCountNominal;

  const S = (
    item: string, qty: number, rating: string, scheme: string,
    catalogKey: string, lead: string, risk: string,
  ): ScheduleRow => ({ item, qty, rating, scheme, catalogKey, lead, risk });

  const schedule: ScheduleRow[] = [
    // ── site (§1) ──
    S("Main transformer (SUB1.T.A/B)", DSX.utilityPrimaries * lineupPairs, DSX.mainTransformer + " ONAN/ONAF", "one per utility primary", "transformers", "18-24 mo", "high"),
    S("MV switchgear lineup (8DA10)", 2 * lineupPairs, `${DSX.lineupKV} · ${DSX.lineupBusA} A · ${DSX.lineupFaultKA} kA · ${DSX.lineupFeederPositions} × ${DSX.lineupFeederA} A positions`, lineupPairs > 1 ? `${lineupPairs} A/B pairs — ${feedersPerLineup} feeders exceed one lineup` : "A / B independent", "switchgear", "~50 wk", "high"),
    S("Tie switchgear (SUB1.MSG.T)", lineupPairs, `${DSX.lineupKV} · ${DSX.tieA} A · 2 normally-open ties`, "normally open", "switchgear", "~50 wk", "high"),
    S("34.5 kV ring feeder position", rings * 2, `${DSX.lineupFeederA} A · dual-ended (A + B lineup)`, "open loop", "switchgear", "—", "med"),
    S("MV backup-generation block", lineupPairs, `≥ ${round1(backupMW)} MW required (note 1) = ${round1(backupMW / DSX.genPF)} MVA at ${DSX.genPF} pf · N+1 · via XFO-BU-Gen ${DSX.backupXfoKV}`, nominal ? `${DSX.backupBlockMVA} MVA (N+1) as drawn at ${DSX.itMWNominal} MW` : `sized from note 1 — the drawn ${DSX.backupBlockMVA} MVA block is a ${DSX.itMWNominal} MW datum, not a scaling rule`, "generators", "18 mo", "high"),
    S("MV lineup main breaker (x-52-1)", 2 * lineupPairs, `${DSX.lineupKV} · ${DSX.lineupBusA} A`, "one per lineup", "switchgear", "~50 wk", "high"),
    S("Tie generator breaker", 4 * lineupPairs, `${DSX.lineupFeederA} A · backup block onto the tie bus`, "4th drawn dashed = future position", "switchgear", "—", "med"),
    ...(spec.bess ? [
      S("BESS block", bessBlocks, `${DSX.bessBlockMW} MW @ ${DSX.bessDurationH} h · dedicated ${DSX.lineupFeederA} A MV feeder`, "≤ 37.5 MW per feeder (note 6)", "bess", "12-18 mo", "med"),
      S("BESS step-up (XFO-BESS-Core)", bessBlocks, DSX.bessXfo, "one per block", "transformers", "—", "med"),
    ] : []),
    ...(spec.onsiteGen ? [
      S("On-site generation block", 2 * lineupPairs, `${DSX.onsiteGenMVA} MVA per lineup · thermal / HRSG / fuel cell / solar (note 3)`, "may replace backup (note 2)", "generators", "—", "high"),
      S("On-site generation feeder position (x-52-18)", 2 * lineupPairs, `${DSX.lineupKV} · ${DSX.tieA} A`, "one per lineup", "switchgear", "—", "med"),
    ] : []),

    // ── deployment units (§2) — the kit is fixed; only the DU count varies ──
    S("Deployment unit (complete skid kit)", duCount, `≈ ${round1(DSX.duITMW)} MW IT each · 6 RMU skids`, "whole DUs only", "—", "—", "—"),
    S("RMU skid (4-way, 600 A)", duCount * DSX.du.skids, `${DSX.ringKV} · 600 A ways`, "ring-in / ring-out + tee-offs", "switchgear", "—", "med"),
    S("MVT — compute", duCount * DSX.du.msbGpu, `${DSX.du.mvtComputeMVA} MVA · ${DSX.ringKV} → ${V.gpu} Δ · VPI dry-type`, "one per MSB-GPU", "transformers", "—", "med"),
    S("MVT — support", duCount * DSX.du.msbSupp, `${DSX.du.mvtSupportMVA} MVA · ${DSX.ringKV} → ${V.supp}`, "one per MSB-SUPP", "transformers", "—", "low"),
    S("MVT — chiller", duCount * DSX.du.msbChiller, `${DSX.du.mvtChillerMVA} MVA · ${DSX.ringKV} → ${V.chiller} Δ-Y`, "one per MSB-CHILLERS", "transformers", "—", "low"),
    S("MVT — mech", duCount * DSX.du.msbMech, `${DSX.du.mvtMechMVA} MVA · ${DSX.ringKV} → ${V.gpu} Δ`, "one per MSB-MECH", "transformers", "—", "low"),
    S("MSB-GPU (compute switchboard)", msbGpu, `5000 A · ${V.gpu} 3Ph-3W · main 5000AF/5000AT LSI`, "grid-direct — no UPS", "lv", "—", "med"),
    S("MSB-SUPP (DU support switchboard)", duCount * DSX.du.msbSupp, `3000 A · ${V.supp} 3Ph-4W · main 3000AF/2500AT LSIG`, "grid-direct — no UPS", "lv", "—", "low"),
    S("MSB-CHILLERS (DU)", duCount * DSX.du.msbChiller, `1200 A · ${V.chiller} 3Ph-4W · 800 A '52' main`, "MV chillers", "lv", "—", "low"),
    S("MSB-MECH (DU)", duCount * DSX.du.msbMech, `2000 A · ${V.gpu} 3Ph-3W · main 2000AF/2000AT LSI`, "—", "lv", "—", "low"),
    S("RPP — compute", rppCompute, `${DSX.du.rppGpuA} A on 1200AF/1000AT LSI · ${V.gpu}`, "8 per MSB-GPU", "lv", "—", "low"),
    S("RPP — DU support", duCount * DSX.du.rppSupp, `${DSX.du.rppSuppA} A on 1200AF/800AT LSIG · ${V.supp}`, "4 per MSB-SUPP", "lv", "—", "low"),
    S("MV chiller (DU)", duCount * DSX.du.mvChillers, `${V.chiller} · 200 A '52' feeder`, "4 per MSB-CHILLERS", "—", "—", "low"),

    // ── core block (§3) — exactly one per site, whatever the DU count ──
    S("Core-IT board (MSB-SUPP1…4)", coreBoards, `5000 A · ${V.coreIT} 3Ph-4W · dual interlocked 5000AF/5000AT LSIG incomers`, "one core block per site", "lv", "—", "med"),
    S("MVT — core IT", coreBoards, `${DSX.core.mvtCoreITMVA} MVA · ${DSX.ringKV} → ${V.coreIT}`, "one per core board", "transformers", "—", "med"),
    S("Core UPS (double-conversion, Li-ion)", coreUps, `${DSX.core.upsMVA} MVA · ${V.coreIT} · AC-input bypass`, `${DSX.core.upsPerBoard} per core board — the only UPS in the design`, "ups", "—", "med"),
    S("Core busway", coreBoards * DSX.core.busway2000PerBoard, `2000 A · ${V.supp} 3Ph-4W · 2000AF/2000AT LSIG`, "2 per core board", "lv", "—", "low"),
    S("RPP — core IT", coreBoards * DSX.core.rpp400PerBoard, `400 A on 600AF/400AT LSI · ${V.supp}`, "4 per core board", "lv", "—", "low"),
    S("Core mech skid (RMU5…6)", DSX.core.mechSkids, `MVT-5 ${DSX.core.mvtCoreChillMVA} MVA → ${V.chiller} + MVT-6 ${DSX.core.mvtCoreMechMVA} MVA → ${V.coreMech}`, "one core block per site", "transformers", "—", "low"),
    S("Core chiller board (MSB-CHILLER)", DSX.core.mechSkids, `1200 A · ${V.chiller} 3Ph-4W · dual interlocked 600 A '52' incomers`, "—", "lv", "—", "low"),
    S("Core mech board (MSB-MECH1/2)", DSX.core.mechSkids, `2000 A · ${V.coreMech} 3Ph-4W · dual interlocked 2000AF/2000AT LSIG incomers`, "—", "lv", "—", "low"),
    S("Core generator GS-1…8 (optional)", DSX.core.itSkids + DSX.core.mechSkids * 2, `${DSX.core.genITMW} MW/${DSX.core.genITMVA} MVA ${V.supp} ×4 · ${DSX.core.genChillMW} MW ${V.chiller} ×2 · ${DSX.core.genMechMW} MW ${V.coreMech} ×2 = ${round1(coreGenMW)} MW`, "LV/MV alternative to the MV backup block (note 4) — read as not additive; see doc §6", "generators", "18 mo", "high"),

    // ── load ──
    S("Compute rack", racks, `${spec.rackKW} kW · ${spec.gpusPerRack} GPU`, "grid-direct, no UPS", "accel", "—", "—"),
  ];

  return { spec, facilityMW, itMW: round1(spec.itMW), racks, gpus, podsNeeded: duCount, schedule, dsx };
}

// ── Topology ─────────────────────────────────────────────────────────────────

/** Builder scoped to one graph: node/edge helpers with running ids. */
function builder(g: SldGraph) {
  /** Make a card. Breakered cards start with NO feeder positions — every board here
   *  is drawn with the sheet's own schedule via `BRK` rather than the generic
   *  palette bank. Passing `mainAmp: undefined` clears the palette default, for
   *  gear whose feeders are sized by diversity rather than against a limiting main. */
  const N = (type: string, name: string, x: number, y: number, extra?: Partial<SldNode>) => {
    g.uid++;
    const p = PAL[type];
    const n: SldNode = { id: "n" + g.uid, type, name: name || p.label, x, y, kw: p.kw || 0, kind: p.kind, red: "N", catalogKey: "", product: "", rating: "" };
    if (p.grp) n.grp = p.grp;
    if (p.breakered) {
      const d = breakeredDefaults(type);
      n.voltage = d.voltage;
      if (d.mainAmp != null) n.mainAmp = d.mainAmp;
      n.breakers = [];
    }
    Object.assign(n, extra || {});
    if (n.mainAmp === undefined) delete n.mainAmp; // survive a JSON round-trip cleanly
    g.nodes.push(n);
    return n;
  };
  /** Plain connection (transformer secondary, source lead-in). */
  const E = (from: SldNode, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id }); };
  /** Connection out of a named feeder breaker. */
  const EB = (from: SldNode, br: string, to: SldNode) => { g.uid++; g.edges.push({ id: "e" + g.uid, from: from.id, to: to.id, fromBreaker: br }); };
  /** Append a feeder position and return its id. */
  const BRK = (n: SldNode, label: string, amp: number, status: Breaker["status"] = "closed") => {
    const list = n.breakers || (n.breakers = []);
    const id = "b" + (list.length + 1);
    list.push({ id, label, amp, poles: 3, status });
    return id;
  };
  /** Claim one of a fixed-position card's existing positions (an RMU way), relabel
   *  it, and return its id. Unlike BRK this never grows the card: an RMU is a 4-way
   *  switch whether or not all four ways are used, and the way-capacity check in
   *  sld.validateDsx measures circuits against exactly that count. */
  const WAY = (n: SldNode, index: number, label: string) => {
    const b = (n.breakers || [])[index];
    b.label = label;
    return b.id;
  };
  return { N, E, EB, BRK, WAY };
}

/**
 * The DSX-VR single-line. The site is drawn in full (both 38 kV lineups, the tie
 * with its backup-generation block, the BESS fleet and every ring feeder position),
 * ONE deployment unit is expanded to skid and board detail, and the core block is
 * drawn explicitly — the two structures the design turns on. Remaining DUs are
 * carried by the schedule, and the drawn DU is labelled with the multiplier, the
 * same convention ./topology uses for racks.
 */
export function buildDsx(spec: Spec): SldGraph {
  const sz = sizeDsx(spec);
  const d = sz.dsx;
  const g: SldGraph = { nodes: [], edges: [], busbars: [], uid: 0, groups: [], architecture: "dsx-vr" };
  const { N, E, EB, BRK, WAY } = builder(g);
  /** A 4-way 600 A ring main unit skid — the fixed position count is the point. */
  const RMU = (name: string, x: number, y: number) =>
    N("rmu", name, x, y, {
      voltage: V.ring,
      rating: `${DSX.ringKV} · 4-way · 600 A ways`,
      breakers: defaultBreakers("rmu"),
    });
  const siteIds: string[] = [], duIds: string[] = [], coreIds: string[] = [];

  // ── §1 site: two utility primaries → two independent 38 kV lineups ──────────
  // The lineups keep their sourced 2500 A main and carry `diversity: true`. Σ(used
  // feeder trips) on 16 × 1200 A positions behind a 2500 A bus is ~8.7× the main —
  // which is exactly what §1's feeder schedule specifies, and normal switchgear
  // practice. Suppress the capacity WARNING; never delete the rating, or nothing is
  // left to check a drawn lineup against.
  const utilA = N("utility", "Utility primary A", 240, 20, { rating: "per project-specific analysis" });
  const utilB = N("utility", "Utility primary B", 1560, 20, { rating: "per project-specific analysis" });
  const txA = N("transformer", "SUB1.T.A", 240, 100, { rating: DSX.mainTransformer + " ONAN/ONAF" });
  const txB = N("transformer", "SUB1.T.B", 1560, 100, { rating: DSX.mainTransformer + " ONAN/ONAF" });
  const lineupRating = `${DSX.lineupKV} · ${DSX.lineupBusA} A · ${DSX.lineupFaultKA} kA`;
  const msgA = N("switchboard", "SUB1.MSG.A", 120, 190, { voltage: V.lineup, mainAmp: DSX.lineupBusA, diversity: true, rating: lineupRating });
  const msgB = N("switchboard", "SUB1.MSG.B", 1440, 190, { voltage: V.lineup, mainAmp: DSX.lineupBusA, diversity: true, rating: lineupRating });
  const tie = N("switchboard", "SUB1.MSG.T", 820, 190, { voltage: V.lineup, mainAmp: DSX.tieA, diversity: true, rating: `${DSX.lineupKV} · ${DSX.tieA} A · normally open` });
  E(utilA, txA); E(utilB, txB); E(txA, msgA); E(txB, msgB);
  siteIds.push(utilA.id, utilB.id, txA.id, txB.id, msgA.id, msgB.id, tie.id);

  // Feeder positions, in the sheet's own order: x-52-2 station auxiliary, then the
  // ring feeders, then BESS. ONE A/B pair is drawn — the pair that carries the DU
  // and core rings below — and it is populated with only the feeders that pair
  // actually has (`d.ringsPerLineup` + aux + `d.bessPerLineup`), never the whole
  // site's ring count. Drawing every ring of a multi-pair site onto one lineup
  // produced a 31-position 8DA10 with duplicate tags; the pair multiplier belongs
  // on the group label and in the schedule, exactly as the DU multiplier does.
  //
  // Tags come off one monotonic counter per lineup so ring and BESS positions can
  // never collide, and x-52-18 stays reserved for the on-site generation block (§1).
  let posA = 2, posB = 2;
  const tagA = () => `A-52-${posA++}`, tagB = () => `B-52-${posB++}`;
  BRK(msgA, `${tagA()} AUX`, DSX.lineupFeederA);
  BRK(msgB, `${tagB()} AUX`, DSX.lineupFeederA);
  const ringBrkA: string[] = [], ringBrkB: string[] = [];
  for (let i = 0; i < d.ringsPerLineup; i++) {
    ringBrkA.push(BRK(msgA, tagA(), DSX.lineupFeederA));
    // The B end of every ring is the ring's normally-open point: the design is
    // dual-ended for maintenance but operates radially. §5.2
    ringBrkB.push(BRK(msgB, tagB(), DSX.lineupFeederA, "open"));
  }

  // The two normally-open tie breakers. Drawn A → tie ← B: the model is a DAG, so
  // it cannot express the tie's bidirectionality; both breakers being open is what
  // keeps the backup block off the compute path either way.
  const tieA = BRK(msgA, "A-52T-1", DSX.tieA, "open");
  const tieB = BRK(msgB, "B-52T-1", DSX.tieA, "open");
  EB(msgA, tieA, tie); EB(msgB, tieB, tie);

  // Backup generation lands on the tie bus through its step-up, never directly.
  // Sized from note 1, in MW, with the sheets' 15 MVA block cited only where it
  // applies. At 206 MW the old fixed label asserted a 15 MVA (≈ 12 MW at 0.8 pf)
  // block against a 17.3 MW obligation printed on the same line.
  const atNominal = d.duCount <= DSX.duCountNominal;
  const backup = N("genset", "MV backup generation", 820, 20, {
    rating: `≥ ${round1(d.backupMW)} MW / ${round1(d.backupMW / DSX.genPF)} MVA (N+1) per note 1`
      + (atNominal ? ` · ${DSX.backupBlockMVA} MVA as drawn` : ""),
  });
  const xfoBu = N("transformer", "XFO-BU-Gen", 820, 100, { rating: DSX.backupXfoKV });
  E(backup, xfoBu); E(xfoBu, tie);
  siteIds.push(backup.id, xfoBu.id);

  // BESS blocks, each on its own 1200 A feeder through XFO-BESS-Core (≤ 37.5 MW
  // per feeder, note 6) — never behind a DU transformer. §5.6
  for (let i = 0; i < d.bessPerLineup * 2; i++) {
    const onA = i % 2 === 0;
    const home = onA ? msgA : msgB;
    const col = Math.floor(i / 2);
    const x = onA ? 480 + col * 170 : 1060 + col * 170;
    const bess = N("bess", `BESS ${onA ? "A" : "B"}${col + 1}`, x, 20, { rating: `${DSX.bessBlockMW} MW @ ${DSX.bessDurationH} h` });
    const xfo = N("transformer", `XFO-BESS-Core ${onA ? "A" : "B"}${col + 1}`, x, 100, { rating: DSX.bessXfo });
    E(bess, xfo);
    EB(home, BRK(home, onA ? tagA() : tagB(), DSX.lineupFeederA), xfo);
    siteIds.push(bess.id, xfo.id);
  }

  // Optional on-site base generation at each lineup's outboard end (notes 2 & 3).
  if (spec.onsiteGen) {
    for (const [i, home] of [msgA, msgB].entries()) {
      const gen = N("genset", `On-site generation ${i === 0 ? "A" : "B"}`, i === 0 ? 20 : 1740, 100, {
        rating: `${DSX.onsiteGenMVA} MVA · thermal / HRSG / fuel cell / solar`,
      });
      E(gen, home);
      siteIds.push(gen.id);
    }
  }

  // ── §2 deployment unit: 6 skids on 6 dual-ended rings ───────────────────────
  const duLabel = d.duCount > 1 ? ` (× ${d.duCount} DUs)` : "";
  const skidX = [60, 340, 620, 900, 1180, 1460];
  const rmus: SldNode[] = [];
  for (let i = 0; i < DSX.du.skids; i++) {
    const rmu = RMU(`DU1 RMU${i + 1} skid`, skidX[i], 300);
    // Ring i leaves an A-lineup feeder and lands on a B-lineup feeder. With one DU
    // drawn the ring is a single hop; the daisy-chain across DU2…DU4 is identical
    // wiring and is carried by the schedule's feeder count.
    EB(msgA, ringBrkA[i], rmu);
    EB(msgB, ringBrkB[i], rmu);
    rmus.push(rmu);
    duIds.push(rmu.id);
  }

  /** An RPP with `ways` equally-sized branch positions, filed into `bucket` — the
   *  group it belongs to. Filing is explicit because the DU and the core block both
   *  make RPPs and an element must live in exactly one group. */
  // Branch positions are divided evenly from the panel main — the sheets give RPP
  // MAIN ratings but no branch schedule, so the per-way amps are [unsourced].
  const mkRpp = (bucket: string[], name: string, x: number, y: number, amp: number, voltage: string, ways: number) => {
    const r = N("rpp", name, x, y, { voltage, mainAmp: amp, rating: `${amp} A · ${voltage}`, breakers: [] });
    for (let i = 0; i < ways; i++) BRK(r, "C" + (i + 1), Math.round(amp / ways));
    bucket.push(r.id);
    return r;
  };

  // RMU1 / RMU3 carry compute + support; RMU2 / RMU4 compute only. §2
  const gpuBoards: SldNode[] = [];
  const computeSkids = [0, 1, 2, 3];
  for (const i of computeSkids) {
    const rmu = rmus[i];
    const x = skidX[i];
    const mvt = N("transformer", `MVT-C${i + 1}`, x - 20, 380, { rating: `${DSX.du.mvtComputeMVA} MVA · ${DSX.ringKV} → ${V.gpu}` });
    const msb = N("switchboard", `MSB-GPU${i + 1}`, x - 20, 460, {
      voltage: V.gpu, mainAmp: 5000, rating: `5000 A · ${V.gpu} 3Ph-3W · 5000AF/5000AT LSI`, breakers: [],
    });
    EB(rmu, WAY(rmu, 0, "W1"), mvt); E(mvt, msb);
    gpuBoards.push(msb);
    duIds.push(mvt.id, msb.id);

    // 8 × RPP 1000 A per board (§2). Two are drawn and labelled with the
    // multiplier — the same representative-detail convention ./topology uses for
    // racks; the schedule carries all 8 × 4 × duCount.
    for (let k = 0; k < 2; k++) {
      const last = k === 1;
      const per = DSX.du.rppGpu / DSX.du.msbGpu;
      const rpp = mkRpp(
        duIds,
        `RPP-GPU${i + 1}-${k + 1} of ${per}` + (last ? ` (2 of ${per} shown)` : ""),
        x - 40 + k * 150, 545, DSX.du.rppGpuA, V.gpu, 4,
      );
      EB(msb, BRK(msb, `F${k + 1}`, DSX.du.rppGpuA), rpp);
      // Two racks per drawn RPP keep the compute path visible end to end.
      for (let r = 0; r < 2; r++) {
        const rack = N("rack", `VR200 rack ${i * 4 + k * 2 + r + 1}`, x - 50 + k * 150 + r * 78, 630, {
          kw: spec.rackKW, rating: `${spec.rackKW} kW · ${spec.gpusPerRack} GPU`,
        });
        EB(rpp, "b" + (r + 1), rack);
        duIds.push(rack.id);
      }
    }

    // support board on the odd skids (RMU1, RMU3)
    if (i === 0 || i === 2) {
      const nth = i === 0 ? 1 : 2;
      const mvtS = N("transformer", `MVT-S${nth}`, x + 130, 380, { rating: `${DSX.du.mvtSupportMVA} MVA · ${DSX.ringKV} → ${V.supp}` });
      const msbS = N("switchboard", `MSB-SUPP${nth} (DU)`, x + 130, 460, {
        voltage: V.supp, mainAmp: 2500, rating: `3000 A bus · ${V.supp} 3Ph-4W · main 3000AF/2500AT LSIG`, breakers: [],
      });
      EB(rmu, WAY(rmu, 1, "W2"), mvtS); E(mvtS, msbS);
      const rppS = mkRpp(duIds, `RPP-SUPP${nth}-1 of ${DSX.du.rppSupp / DSX.du.msbSupp} (1 of ${DSX.du.rppSupp / DSX.du.msbSupp} shown)`, x + 130, 545, DSX.du.rppSuppA, V.supp, 4);
      EB(msbS, BRK(msbS, "F1", DSX.du.rppSuppA), rppS);
      const netRack = N("netrack-ns", `DU support rack ${nth}`, x + 140, 630);
      EB(rppS, "b1", netRack);
      duIds.push(mvtS.id, msbS.id, netRack.id);
    }
  }

  // RMU5 / RMU6: chillers at 2.4/4.16 kV + mech at 480 V (§6 note 3). §2
  for (const [k, i] of [4, 5].entries()) {
    const rmu = rmus[i];
    const x = skidX[i];
    const mvtCh = N("transformer", `MVT-CH${k + 1}`, x - 20, 380, { rating: `${DSX.du.mvtChillerMVA} MVA · ${DSX.ringKV} → ${V.chiller}` });
    const msbCh = N("switchboard", `MSB-CHILLERS${k + 1} (DU)`, x - 20, 460, {
      voltage: V.chiller, mainAmp: 800, rating: `1200 A bus · ${V.chiller} 3Ph-4W · 800 A '52' main`, breakers: [],
    });
    EB(rmu, WAY(rmu, 0, "W1"), mvtCh); E(mvtCh, msbCh);
    for (let c = 0; c < 2; c++) {
      const last = c === 1;
      const nCh = DSX.du.mvChillers / DSX.du.msbChiller;
      const ch = N("chiller", `DU chiller ${k * nCh + c + 1} of ${nCh}` + (last ? ` (2 of ${nCh} shown)` : ""), x - 30 + c * 100, 545);
      EB(msbCh, BRK(msbCh, `'52'-${c + 1}`, 200), ch);
      duIds.push(ch.id);
    }
    const mvtM = N("transformer", `MVT-M${k + 1}`, x + 180, 380, { rating: `${DSX.du.mvtMechMVA} MVA · ${DSX.ringKV} → ${V.gpu}` });
    const msbM = N("switchboard", `MSB-MECH${k + 1} (DU)`, x + 180, 460, {
      voltage: V.gpu, mainAmp: 2000, rating: `2000 A · ${V.gpu} 3Ph-3W · 2000AF/2000AT LSI`, breakers: [],
    });
    EB(rmu, WAY(rmu, 1, "W2"), mvtM); E(mvtM, msbM);
    // §2 gives MSB-MECH 2 × 1200AF/800AT + 4 × 400AF/225AT. One of each is drawn;
    // the label has to say so, or the board silently under-represents its schedule.
    const cdu = N("cdu", `DU CDU ${k + 1} of 2 (1 of 2 shown)`, x + 170, 545);
    const crah = N("crah", `DU CRAH ${k + 1} of 4 (1 of 4 shown)`, x + 260, 545);
    EB(msbM, BRK(msbM, "F1 of 2 · 1200AF/800AT", 800), cdu);
    EB(msbM, BRK(msbM, "F3 of 4 · 400AF/225AT", 225), crah);
    duIds.push(mvtCh.id, msbCh.id, mvtM.id, msbM.id, cdu.id, crah.id);
  }

  // ── §3 core block: the only UPS- and generator-backed load on the site ──────
  // One core-load ring daisy-chains all six core skids, dual-ended A → B. §5.2
  const coreY = 780;
  const coreX = [60, 340, 620, 900, 1240, 1560];
  const coreRmus: SldNode[] = [];
  const coreRingA = ringBrkA[d.ringsPerLineup - 1], coreRingB = ringBrkB[d.ringsPerLineup - 1];
  for (let i = 0; i < DSX.core.itSkids + DSX.core.mechSkids; i++) {
    const isMech = i >= DSX.core.itSkids;
    const rmu = RMU(isMech ? `CORE MECH RMU${i + 1} skid` : `CORE IT RMU${i + 1} skid`, coreX[i], coreY);
    coreRmus.push(rmu);
    coreIds.push(rmu.id);
  }
  EB(msgA, coreRingA, coreRmus[0]);
  for (let i = 0; i < coreRmus.length - 1; i++) EB(coreRmus[i], WAY(coreRmus[i], 0, "W-RING"), coreRmus[i + 1]);
  EB(msgB, coreRingB, coreRmus[coreRmus.length - 1]);

  // Core IT: MVT-1…4 → MSB-SUPP1…4, dual INTERLOCKED incomers (transformer /
  // generator), 2 × 1.5 MVA UPS, busway, RPP 400 A and the 5000 A load bank. §3
  for (let i = 0; i < DSX.core.itSkids; i++) {
    const rmu = coreRmus[i];
    const x = coreX[i];
    const mvt = N("transformer", `MVT-${i + 1}`, x - 20, coreY + 80, { rating: `${DSX.core.mvtCoreITMVA} MVA · ${DSX.ringKV} → ${V.coreIT}` });
    const gs = N("genset", `GS-${i + 1}`, x + 140, coreY + 80, { rating: `${DSX.core.genITMW} MW / ${DSX.core.genITMVA} MVA · ${V.supp} (opt.)` });
    // Keeps its sourced 5000 AT main and carries `diversity: true`: the sheet loads
    // this board with a dedicated input AND output breaker per UPS (2500 A each),
    // two 2000 A busways, four 400 A RPPs and a 5000 A load-bank breaker. Σ(trips)
    // exceeding the main is sourced diversity here, not an over-subscribed board.
    const msb = N("switchboard", `MSB-SUPP${i + 1}`, x - 20, coreY + 160, {
      voltage: V.coreIT, mainAmp: 5000, diversity: true, interlocked: true,
      rating: `5000 A · ${V.coreIT} 3Ph-4W · dual interlocked 5000AF/5000AT LSIG incomers`, breakers: [],
    });
    EB(rmu, WAY(rmu, 1, "W-MVT1"), mvt);
    E(mvt, msb); E(gs, msb); // the interlocked pair: MVT incomer / generator incomer
    coreIds.push(mvt.id, gs.id, msb.id);

    // 2 × 1.5 MVA double-conversion UPS — the only UPS in the design.
    for (let u = 0; u < DSX.core.upsPerBoard; u++) {
      const ups = N("ups", `UPS ${i + 1}${u === 0 ? "A" : "B"}`, x - 40 + u * 120, coreY + 245, {
        rating: `${DSX.core.upsMVA} MVA · Li-ion · AC-input bypass`,
      });
      EB(msb, BRK(msb, `UPS-${u + 1} IN`, 2500), ups);
      // §3 calls this load "NETWORK/CONTROL/SHARE" and gives board and feeder
      // ratings but NO rack schedule, so the palette's network-rack density stands
      // in [unsourced]. It must not be a `rack`: that carries the 120 kW GPU
      // default, and project.rollupGraph sums every load's kw into facilityLoadKW
      // and counts every grp:"IT" load as a compute rack — eight fictional 120 kW
      // racks would propagate straight into the Cost Model roll-up.
      const rack = N("netrack-ew", `Core network/control rack ${i * 2 + u + 1}`, x - 45 + u * 120, coreY + 325, { rating: "network / control / storage" });
      E(ups, rack);
      coreIds.push(ups.id, rack.id);
    }
    const busway = N("busway", `Core busway ${i + 1} of ${DSX.core.busway2000PerBoard} (1 of ${DSX.core.busway2000PerBoard} shown)`, x + 210, coreY + 245, {
      voltage: V.supp, mainAmp: 2000, rating: `2000 A · ${V.supp} 3Ph-4W · 2000AF/2000AT LSIG`, breakers: [],
    });
    BRK(busway, "T1", 400);
    EB(msb, BRK(msb, "BUSWAY-1", 2000), busway);
    const bwRack = N("netrack-ew", `Core network rack ${i + 1}`, x + 215, coreY + 325);
    EB(busway, "b1", bwRack);
    const rpp = mkRpp(coreIds, `RPP-CORE${i + 1} of ${DSX.core.rpp400PerBoard} (1 of ${DSX.core.rpp400PerBoard} shown)`, x + 360, coreY + 245, 400, V.supp, 4);
    EB(msb, BRK(msb, "RPP-1", 400), rpp);
    const rppRack = N("netrack-ns", `Core storage rack ${i + 1}`, x + 365, coreY + 325);
    EB(rpp, "b1", rppRack);
    const lb = N("loadbank", `Load bank ${i + 1}`, x + 490, coreY + 245, { rating: "5000AF/5000AT camlock" });
    EB(msb, BRK(msb, "LOAD BANK", 5000), lb);
    coreIds.push(busway.id, bwRack.id, rppRack.id, lb.id);
  }

  // Core mech: MVT-5 → MSB-CHILLER (2.4/4.16 kV) and MVT-6 → MSB-MECH (277/480 V),
  // both dual-interlocked against GS-5/GS-7 and GS-6/GS-8. §3
  for (let k = 0; k < DSX.core.mechSkids; k++) {
    const rmu = coreRmus[DSX.core.itSkids + k];
    const x = coreX[DSX.core.itSkids + k];
    const mvt5 = N("transformer", `MVT-5${k === 0 ? "" : "'"}`, x - 20, coreY + 80, { rating: `${DSX.core.mvtCoreChillMVA} MVA · ${DSX.ringKV} → ${V.chiller}` });
    const gsC = N("genset", `GS-${k === 0 ? 5 : 7}`, x + 130, coreY + 80, { rating: `${DSX.core.genChillMW} MW / ${DSX.core.genChillMVA} MVA · ${V.chiller} (opt.)` });
    const msbC = N("switchboard", `MSB-CHILLER${k + 1} (core)`, x - 20, coreY + 160, {
      voltage: V.chiller, mainAmp: 600, interlocked: true,
      rating: `1200 A bus · ${V.chiller} 3Ph-4W · dual interlocked 600 A '52' incomers`, breakers: [],
    });
    EB(rmu, WAY(rmu, 1, "W-MVT1"), mvt5);
    E(mvt5, msbC); E(gsC, msbC);
    const coreChiller = N("chiller", `Core chiller ${k + 1}`, x - 20, coreY + 245);
    EB(msbC, BRK(msbC, "'52'-1", 200), coreChiller);

    const mvt6 = N("transformer", `MVT-6${k === 0 ? "" : "'"}`, x + 130, coreY + 160, { rating: `${DSX.core.mvtCoreMechMVA} MVA · ${DSX.ringKV} → ${V.coreMech}` });
    const gsM = N("genset", `GS-${k === 0 ? 6 : 8}`, x + 290, coreY + 160, { rating: `${DSX.core.genMechMW} MW / ${DSX.core.genMechMVA} MVA · ${V.coreMech} (opt.)` });
    const msbM = N("switchboard", `MSB-MECH${k + 1} (core)`, x + 130, coreY + 245, {
      voltage: V.coreMech, mainAmp: 2000, interlocked: true,
      rating: `2000 A · ${V.coreMech} 3Ph-4W · dual interlocked 2000AF/2000AT LSIG incomers`, breakers: [],
    });
    EB(rmu, WAY(rmu, 2, "W-MVT2"), mvt6);
    E(mvt6, msbM); E(gsM, msbM);
    const coreCdu = N("cdu", `Core CDU ${k + 1}`, x + 130, coreY + 325);
    EB(msbM, BRK(msbM, "F1", 800), coreCdu);
    coreIds.push(mvt5.id, gsC.id, msbC.id, coreChiller.id, mvt6.id, gsM.id, msbM.id, coreCdu.id);
  }

  const pairLabel = d.lineupPairs > 1 ? ` (1 of ${d.lineupPairs} A/B pairs shown)` : "";
  g.groups = [
    { id: "g1", name: `Site substation · 2 × ${DSX.lineupKV} lineups + tie${pairLabel} — ${d.feedersPerLineup} of ${DSX.lineupFeederPositions} feeder positions`, members: siteIds },
    { id: "g2", name: `Deployment unit DU1${duLabel} — grid-direct compute, no UPS · board feeder schedules shown in part, see the equipment schedule for full counts`, members: duIds },
    { id: "g3", name: "Core block × 1 — the only UPS/generator-backed load", members: coreIds },
  ];
  g.uid += 3;
  return g;
}

// ── 1-page brief ─────────────────────────────────────────────────────────────

export function briefDsx(spec: Spec): string {
  const sz = sizeDsx(spec);
  const d = sz.dsx;
  const L: string[] = [];
  const nominal = d.duCount === DSX.duCountNominal;

  L.push("# " + spec.name);
  L.push("");
  L.push(`**${sz.facilityMW} MW facility** · ${sz.itMW} MW critical IT · ${d.duCount} deployment unit${d.duCount === 1 ? "" : "s"} · ${sz.racks.toLocaleString()} × ${spec.rackKW} kW racks · ${sz.gpus.toLocaleString()} GPUs · PUE ${spec.pue} · ${spec.cooling}-cooled`);
  L.push("");
  L.push("Drawn to the **NVIDIA DSX Vera Rubin** reference architecture (Siemens UL reference design)" + (nominal ? " at its 103 MW nominal site size." : `, scaled to ${d.duCount} of the reference site's ${DSX.duCountNominal} deployment units.`));
  L.push("");

  L.push("## Topology — compute is grid-direct");
  L.push(`Two utility primaries → main transformers (${DSX.mainTransformer}) → **two independent ${DSX.lineupKV} lineups** (SUB1.MSG.A / SUB1.MSG.B, ${DSX.lineupBusA} A, ${DSX.lineupFaultKA} kA) joined by a normally-open tie → **${d.rings} dual-ended ${DSX.ringKV} open-loop rings** → 4-way 600 A RMU skids → MVTs → LV boards → RPPs → racks.`);
  L.push("");
  L.push(`**There is no UPS and no generator anywhere on the compute path.** GPU compute runs straight off the grid through a ${DSX.du.mvtComputeMVA} MVA MVT into a 5000 A ${V.gpu} MSB-GPU and a ${DSX.du.rppGpuA} A RPP. That removes the double-conversion loss and the whole battery estate from the critical path — worth roughly 0.02–0.04 of PUE on its own — and leaves the load free to be curtailed against the grid. Separately, the reference design is stated to support a site PUE range of ${DSX.pueRange[0]}–${DSX.pueRange[1]}; that band is set mostly by cooling and climate, not by the electrical topology.`);
  L.push("");
  L.push(`Concurrent maintainability lives at the **medium-voltage layer**, not in duplicated LV plant: every ring leaves an A-lineup ${DSX.lineupFeederA} A feeder and lands on a B-lineup feeder, with a normally-open point so the operating state stays radial. There is no 2N LV duplication to pay for — and no LV redundancy either: the boards are single-corded, so an MSB-GPU or its MVT cannot be maintained without dropping the racks it feeds. This is not an Uptime Tier III facility-level claim.`);
  L.push("");

  L.push("## Where the resilience actually is");
  L.push(`- **Core block (× 1 per site)** — network, control and storage on ${DSX.core.itSkids} interlocked ${V.coreIT} boards, each with dual interlocked incomers (transformer / generator) and **${DSX.core.upsPerBoard} × ${DSX.core.upsMVA} MVA** double-conversion Li-ion UPS. ${d.coreUps} UPS on the whole site — and nowhere else.`);
  L.push(`- **Backup generation** — note 1 sizes it to the core slice only: ≈ 6% of IT load plus 40% of that in mechanical load ⇒ **${round1(d.backupMW)} MW** (${round1(d.backupMW / DSX.genPF)} MVA at ${DSX.genPF} pf), landing on the tie bus through XFO-BU-Gen. ${nominal ? `The sheets draw a ${DSX.backupBlockMVA} MVA N+1 block at this size — headroom above the obligation.` : `The sheets' ${DSX.backupBlockMVA} MVA block is a ${DSX.itMWNominal} MW datum and is **not** a scaling rule; the figure above is the note-1 obligation at this site size.`} The optional GS-1…8 core generators (${round1(d.coreGenMW)} MW) serve the same core slice at LV/MV; note 4 offers them as an option and we read them as an *alternative* to the MV block rather than an addition — an interpretation, not a statement of the source.`);
  if (spec.bess) {
    L.push(`- **BESS — ${d.bessBlocks} × ${DSX.bessBlockMW} MW @ ${DSX.bessDurationH} h (${d.bessMW} MW)** on dedicated MV feeders, ≤ ${DSX.bessBlockMW} MW per feeder — ${spec.bessCoverFacility ? `sized to cover the ${sz.facilityMW} MW facility load so the whole site is curtailable (an assumption about note 6's intent, not a sourced quantity)` : `the ${DSX.bessBlocksPerLineup} blocks per lineup the sheets draw; note 6 leaves the total to customer requirements`}. This is the commercial lever, not a ride-through battery: it makes the site a fully flexible, curtailable load and and, per note 6, can support potential acceleration of the grid interconnection.`);
  }
  if (spec.onsiteGen) {
    L.push(`- **On-site base generation — ${DSX.onsiteGenMVA} MVA per lineup** (thermal, HRSG, fuel cells, solar) at each lineup's outboard end; note 2 allows it to replace the backup block outright.`);
  }
  L.push(`- **Lineup capacity** — ${d.rings} ring${d.rings === 1 ? "" : "s"} across ${d.lineupPairs} A/B pair${d.lineupPairs === 1 ? "" : "s"} ⇒ **${d.feedersPerLineup} of ${DSX.lineupFeederPositions}** × ${DSX.lineupFeederA} A positions used on each 8DA10 lineup (${d.ringsPerLineup} rings + station aux${spec.bess ? ` + ${d.bessPerLineup} BESS` : ""}).`);
  if (d.lineupPairs > 1) {
    L.push(`  > **This site outgrows the reference substation.** It needs **${d.lineupPairs} A/B lineup pairs** (${d.lineupPairs * 2} lineups, ${d.lineupPairs} tie sections, ${d.lineupPairs * DSX.utilityPrimaries} utility primaries). The Siemens set draws one pair, sized for the ${DSX.itMWNominal} MW nominal — the ring plan scales, the substation arrangement past one pair does not, and belongs in a project-specific study. The single-line draws one representative pair.`);
  }
  if (nominal && d.duCount === DSX.duCountNominal) {
    // The real cross-check on the nominal: gear sized for single-lineup N-1. (The
    // 13+1+2 = 16 feeder closure is NOT independent — §1 states that enumeration
    // verbatim, so it only confirms the encoding.)
    const mva = round1(sz.facilityMW / 0.9);
    L.push(`- **N-1 check** — at ${sz.facilityMW} MW facility (≈ ${mva} MVA at 0.9 pf), one lineup carrying the whole site sees ≈ ${Math.round((mva * 1e6) / (Math.sqrt(3) * 38000))} A on a ${DSX.lineupBusA} A / ${DSX.lineupKV} bus, and ≈ ${mva} MVA against a 150 MVA main transformer. The sourced gear is sized for single-lineup N-1 at this capacity.`);
  }
  L.push("");

  L.push("## Deployment unit — the repeatable block");
  L.push(`${d.duCount} × ≈ ${round1(DSX.duITMW)} MW IT. The DU is an indivisible kit, so the site scales in whole units:`);
  L.push("");
  L.push("| Per DU | Qty | Rating |");
  L.push("|---|---:|---|");
  L.push(`| RMU skid (4-way) | ${DSX.du.skids} | ${DSX.ringKV} · 600 A ways |`);
  L.push(`| MSB-GPU | ${DSX.du.msbGpu} | 5000 A · ${V.gpu} 3Ph-3W |`);
  L.push(`| MSB-SUPP | ${DSX.du.msbSupp} | 3000 A · ${V.supp} 3Ph-4W |`);
  L.push(`| MSB-CHILLERS | ${DSX.du.msbChiller} | 1200 A · ${V.chiller} 3Ph-4W |`);
  L.push(`| MSB-MECH | ${DSX.du.msbMech} | 2000 A · ${V.gpu} 3Ph-3W |`);
  L.push(`| RPP (compute / support) | ${DSX.du.rppGpu} / ${DSX.du.rppSupp} | ${DSX.du.rppGpuA} A / ${DSX.du.rppSuppA} A |`);
  L.push("");

  L.push("## Major equipment schedule");
  L.push("| Equipment | Qty | Unit rating | Scheme | Lead / risk |");
  L.push("|---|---:|---|---|---|");
  sz.schedule.forEach((r) => L.push(`| ${r.item} | ${r.qty.toLocaleString()} | ${r.rating} | ${r.scheme} | ${r.lead} · ${r.risk} |`));
  L.push("");
  L.push("*Source: Siemens UL Reference Design for DSX Vera Rubin NVL72 (S&L DAT-SII-2026-054), distilled in `docs/ai-factory/dsx-vr-architecture.md` + `data/power-equipment.json`. Sized estimate — verify against the governing NVIDIA RA and the project basis of design. Open source discrepancies are logged in §6 of that document.*");
  return L.join("\n");
}
