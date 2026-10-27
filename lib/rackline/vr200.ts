// NVIDIA Vera Rubin NVL72 (VR200) halls after a modular reference design for
// Vera Rubin NVL72: AI Modules of GPU racks and support racks, one Power Pod
// per module with 4-to-make-3 rack distribution, a separate mechanical
// powertrain, and hybrid cooling (direct-to-chip to dry / fluid coolers, chillers
// for CRAHs and assist, thermal energy storage). Rack figures come from NVIDIA and
// SemiAnalysis; the network is an estimate (no NVIDIA Vera Rubin enterprise RA).
//
// Sources (see docs/rackline/vr200-nvl72.md):
//  [rd]  VR200 modular reference design (planning-level basis of design, document
//        on file): 13.44 MW = 4 × 3.36 MW AI Modules; per module 14 GPU
//        racks at 200 kW + 16 support racks at 35 kW; Power Pod 5 MVA 34.5 kV→480Y/277,
//        5 MW generator, 6,000 A MSB (85 kA, UL891), 2 × 2,000 kVA UPS, 6,000 A UDS,
//        4 × 1,600 A feeders; 4-to-make-3 at rack / feeder / Pod level; mechanical
//        powertrain 3.25 MVA / 3.25 MW; dry cooler loop 104/122 °F, chiller loop
//        68/82.4 °F, IT coolant < 45 °C at ~10 K ΔT, 82 °F switch point, TES 31,397 gal
//        (~6 min); N+1 pump skids, chillers, CRAHs, CDUs, fluid coolers; PUE 1.27.
//  [nv]  NVIDIA Vera Rubin NVL72 page: 72 Rubin GPUs, 36 Vera CPUs, 45 °C inlet.
//  [sa]  SemiAnalysis "Vera Rubin": 180–220 kW (Max-Q / Max-P); 4 × 110 kW shelves
//        N+1 on two 100 A whips each; 8 ConnectX-9 + 1 BlueField-4 per tray.

import { analyze, cableAnalysis } from "./analysis";
import { COOL_K, redN } from "./constants";
import { addDevice, autoLayoutElectrical, choosePDU, libIndex, newRack, newScenario, uid } from "./model";
import { DEFAULT_NETS } from "./network";
import {
  NVL72_RACK, POWER_ARCH, buildNvl72Pod, buildPower, groupWarnings, maxDryAmbientC, node, pickName, rating,
  type Nvl72Bom, type Nvl72PodOptions, type Nvl72PodResult, type RaNetwork,
} from "./nvl72";
import type { Electrical, ElecNode, LibItem, NetTier, Rack } from "./types";

/** The modular reference design's planning basis. */
export const VR_RD = {
  ref: "VR200 modular reference design",
  itMW: 13.44, moduleMW: 3.36, modules: 4, gpuPerModule: 14, supportPerModule: 16, gpuKW: 200, supportKW: 35,
  pue: 1.27, siteMW: 17.1, mechMW: 2.8,
  podKVA: 5000, genKW: 5000, msbA: 6000, udsA: 6000, upsKVA: 2000, feederA: 1600, feeders: 4, mechKVA: 3250,
  dryLoopC: [40, 50] as const, chwLoopC: [20, 28] as const, switchC: 27.8, itSupplyMaxC: 45, itDeltaC: 10,
  tesGal: 31397, tesMin: 6,
} as const;

/** The VR200 rack library item; its design load follows the chosen power profile. */
export const VR_MODEL = "vr200-nvl72";

/** The library with the VR200 rack set to the options' profile ratings (a copy; the input is not changed). */
export function withVrProfile(items: LibItem[], o: Pick<Nvl72PodOptions, "vrProfile" | "maxQKW" | "maxPKW">): LibItem[] {
  return items.map((x) => (x.id === VR_MODEL
    ? { ...x, kwMaxQ: o.maxQKW, kwMaxP: o.maxPKW, kw: o.vrProfile === "maxq" ? o.maxQKW : o.maxPKW }
    : x));
}

/** Rack coolant flow (L/min per kW) for a PG25 loop at a given ΔT (ρ ≈ 1.02 kg/L, cp ≈ 3.85 kJ/kg·K). */
export const tcsLpmPerKW = (deltaC: number) => 60 / (1.02 * 3.85 * Math.max(1, deltaC));

/** Endpoint ports per leaf (64 of an SN6810's 128 face racks, ~6 % kept spare) and spine radix. */
const DOWN = 60, RADIX = 128;

/**
 * Switch counts for `racks` VR200 racks: non-blocking two-tier fabrics on
 * SN6810 (an estimate; no NVIDIA Vera Rubin enterprise network RA). Compute
 * fabric: 144 × 800G per rack; converged: 18 × 800G (BlueField-4) per rack.
 */
export function vrNetwork(racks: number): RaNetwork {
  const n = Math.max(1, Math.round(racks));
  const notes = ["Network counts are an estimate: non-blocking two-tier leaf–spine on Spectrum-X SN6810 (128 × 800G), up to 60 of each leaf's 64 rack-facing ports used. No NVIDIA Vera Rubin enterprise network RA was available."];
  const tier = (access: number) => {
    const leaf = Math.max(1, Math.ceil(access / DOWN));
    return { leaf, spine: leaf > 1 ? Math.ceil(access / RADIX) : 0 };
  };
  const c = tier(144 * n), v = tier(18 * n);
  let superSpine = 0;
  if (c.leaf > RADIX) {
    superSpine = Math.ceil(c.spine / 2);
    notes.push(`${c.leaf} leaves exceed one SN6810 spine's 128 ports: a super-spine tier (~${superSpine}, estimate) or SN6800 (512-port) spines are needed.`);
  }
  return { design: null, pods: Math.ceil(n / VR_RD.gpuPerModule), computeLeaf: c.leaf, computeSpine: c.spine, superSpine, convLeaf: v.leaf, convSpine: v.spine, oob: 2 * n, notes };
}

/** Build a reference-design scenario for either platform. */
export function buildReferencePod(o: Nvl72PodOptions, libItems: LibItem[], elecIn: Nvl72PodResult["elec"]): Nvl72PodResult {
  return o.platform === "vr200" ? buildVr200Hall(o, libItems, elecIn) : buildNvl72Pod(o, libItems, elecIn);
}

/**
 * Power Pods: one per module (at least two, so every rack has two Pods),
 * each MV transformer → [ATS ← generator] → main switchboard → [UPS → UPS
 * distribution board] → feeders. Racks take feeders from Pods i and i+1 round
 * robin, each from the least-loaded feeder of its Pod. Plus one mechanical
 * powertrain per module.
 */
function podPower(o: Nvl72PodOptions, racks: { r: Rack; kva: number }[], modules: number) {
  const V = 480;
  const e: Electrical = { nodes: [], links: [] };
  const add = (n: ElecNode) => { e.nodes.push(n); return n; };
  const link = (a: ElecNode, b: ElecNode) => e.links.push({ id: uid(), from: a.id, to: b.id });
  const P = Math.max(2, modules);
  const amps = (kvaLoad: number, step = 400, min = 800) => Math.max(min, Math.ceil((kvaLoad * 1000) / (Math.sqrt(3) * V * 0.8) / step) * step);
  const util = add(node("utility", "Utility / 34.5 kV", { v: 34500, scc: 0 }));
  const mvsw = add(node("switch", "MV switchgear 34.5 kV", { v: 34500, amps: 1200 }));
  link(util, mvsw);
  const feedAmps = o.feed === "busway" ? o.busAmps : o.rppAmps;
  const pods = Array.from({ length: P }, (_, p) => {
    const tag = String.fromCharCode(65 + p);
    const t = add(node("xfmr", pickName(`Power Pod ${tag} TX ${o.xfmrKva / 1000} MVA`, o.picks.transformers), { kva: o.xfmrKva, vp: 34500, v: V, z: 5.75 }));
    link(mvsw, t);
    let up: ElecNode = t;
    if (o.gen) {
      const g = add(node("gen", pickName(`Power Pod ${tag} GEN ${o.genKw / 1000} MW`, o.picks.generators), { kva: Math.round(o.genKw / 0.8), v: V }));
      const ats = add(node("ats", `Power Pod ${tag} ATS`, { v: V, amps: VR_RD.msbA }));
      link(t, ats); link(g, ats); up = ats;
    }
    const msb = add(node("swbd", pickName(`Power Pod ${tag} MSB ${VR_RD.msbA} A`, o.picks.lv), { v: V, amps: VR_RD.msbA }));
    link(up, msb); up = msb;
    if (o.ups) {
      // Parallel UPS modules are one node rated at the pair (2 × upsKva).
      const ups = add(node("ups", pickName(`Power Pod ${tag} UPS A1+A2 (2× ${o.upsKva} kVA)`, o.picks.ups), { v: V, kva: 2 * o.upsKva, eff: 0.97 }));
      const uds = add(node("swbd", `Power Pod ${tag} UPS distribution ${VR_RD.udsA} A`, { v: V, amps: VR_RD.udsA }));
      link(msb, ups); link(ups, uds); up = uds;
    }
    const feeders = Array.from({ length: Math.max(1, o.feedersPerPod) }, (_, k) => {
      const f = add(node(o.feed === "busway" ? "busway" : "rpp", pickName(`Pod ${tag} feeder ${k + 1} ${feedAmps} A`, o.feed === "busway" ? o.picks.busway : undefined), { v: V, amps: feedAmps }));
      link(up, f);
      // Load the feeder carries when every rack's other feed is lost (A side, B side).
      return { n: f, asA: 0, asB: 0 };
    });
    return { tag, feeders, cap: Math.min(o.xfmrKva, o.ups ? 2 * o.upsKva : Infinity, rating(V, VR_RD.msbA), feeders.length * rating(V, feedAmps)) };
  });
  // Mechanical powertrain, one per module.
  for (let m = 0; m < Math.max(1, modules); m++) {
    const t = add(node("xfmr", `Mechanical powertrain ${m + 1} TX ${o.mechXfmrKva / 1000} MVA`, { kva: o.mechXfmrKva, vp: 34500, v: V, z: 5.75 }));
    link(mvsw, t);
    let up: ElecNode = t;
    if (o.gen) {
      const g = add(node("gen", `Mechanical powertrain ${m + 1} GEN ${o.mechXfmrKva / 1000} MW`, { kva: Math.round(o.mechXfmrKva / 0.8), v: V }));
      const ats = add(node("ats", `Mechanical powertrain ${m + 1} ATS`, { v: V, amps: amps(o.mechXfmrKva) }));
      link(t, ats); link(g, ats); up = ats;
    }
    const sw = add(node("swbd", `Mechanical MSB ${m + 1}`, { v: V, amps: amps(o.mechXfmrKva) }));
    const mech = add(node("mech", `Mechanical ${m + 1}: fan walls, chillers, CDUs and pumps`, { v: V, amps: amps(o.mechXfmrKva, 200, 400), auto: true, kw: 0 }));
    link(up, sw); link(sw, mech);
  }
  // Racks: two Pods each, rotating through every pair of Pods so a lost Pod's racks spread over
  // all the others (4-to-make-3); on each Pod the feeder with the least load on that side.
  // Ordered pairs, so each Pod is the A side as often as the B side.
  const pairs: [number, number][] = [];
  for (let d = 1; d < P; d++) for (let a = 0; a < P; a++) pairs.push([a, (a + d) % P]);
  const share = new Map<string, { a: number; b: number }>(); // rack id → pod indices
  const sideA = new Array(P).fill(0), sideB = new Array(P).fill(0), used = new Map<string, number>();
  // Largest racks first, each on the ordered pair that keeps the worst one-side Pod load lowest
  // (ties: the least-used pair, so every Pod shares racks with every other).
  for (const { r, kva } of [...racks].sort((x, y) => y.kva - x.kva)) {
    let best = pairs[0], bestKey = [Infinity, Infinity];
    for (const pr of pairs) {
      const key = [Math.max(sideA[pr[0]] + kva, sideB[pr[1]] + kva), used.get(pr.join()) ?? 0];
      if (key[0] < bestKey[0] - 1e-6 || (Math.abs(key[0] - bestKey[0]) <= 1e-6 && key[1] < bestKey[1])) { best = pr; bestKey = key; }
    }
    const [a, b] = best;
    sideA[a] += kva; sideB[b] += kva;
    used.set(best.join(), (used.get(best.join()) ?? 0) + 1);
    const fa = pods[a].feeders.reduce((x, y) => (y.asA < x.asA ? y : x));
    const fb = pods[b].feeders.reduce((x, y) => (y.asB < x.asB ? y : x));
    fa.asA += kva; fb.asB += kva;
    r.feedA = fa.n.id; r.feedB = fb.n.id;
    share.set(r.id, { a, b });
  }
  // Pod-level 4-to-make-3: lose any one Pod; its racks move fully to their other Pod.
  let worst = { lost: "", on: "", load: 0, cap: 0 };
  for (let q = 0; q < P; q++) {
    const load = new Array(P).fill(0);
    for (const { r, kva } of racks) {
      const { a, b } = share.get(r.id)!;
      if (a === q) load[b] += kva; else if (b === q) load[a] += kva; else { load[a] += kva / 2; load[b] += kva / 2; }
    }
    for (let p = 0; p < P; p++) if (p !== q && load[p] / pods[p].cap > (worst.cap ? worst.load / worst.cap : 0))
      worst = { lost: pods[q].tag, on: pods[p].tag, load: load[p], cap: pods[p].cap };
  }
  autoLayoutElectrical(e);
  const notes = [
    `${P} Power Pods (${o.xfmrKva / 1000} MVA, ${o.feedersPerPod} × ${feedAmps} A feeders${o.ups ? `, 2 × ${o.upsKva} kVA UPS` : ", no UPS"}${o.gen ? `, ${o.genKw / 1000} MW generator` : ", no generator"}) and ${Math.max(1, modules)} mechanical powertrain(s), per the reference design ${VR_RD.ref}.`,
    "Each rack is modelled on two feeders from two Pods (A/B). The reference design's rack-level 4-to-make-3 (four rack power paths) is wider than this model's A/B feeds; the Pod-loss check below covers the Pod level.",
  ];
  const warnings: string[] = [];
  if (worst.cap && worst.load > worst.cap)
    warnings.push(`Power Pod ${P >= 4 ? "4-to-make-3" : "N-1"} not met: losing Pod ${worst.lost} puts ${Math.round(worst.load)} kVA on Pod ${worst.on}, above its ${Math.round(worst.cap)} kVA (the smallest of transformer, UPS, switchboard and feeders). The reference design notes Pod-level 4-to-make-3 needs added capacity or a defined redundancy strategy.`);
  return { e, notes, warnings };
}

/**
 * Build a Vera Rubin NVL72 hall after the modular reference design. Each AI Module
 * is two facing rows: GPU racks, a CDU slot, then support racks, with a compute
 * hot aisle and a support hot aisle; modules stack down the hall.
 */
export function buildVr200Hall(o: Nvl72PodOptions, libIn: LibItem[], elecIn: Nvl72PodResult["elec"]): Nvl72PodResult {
  const libItems = withVrProfile(libIn, o);
  const lib = libIndex(libItems);
  const V = o.voltage;
  const elec = { ...elecIn, vLL: V, vLN: V === 480 ? 277 : 240 };
  const warnings: string[] = [];
  const s = newScenario(o.name);
  s.nets = DEFAULT_NETS.map((n) => {
    const fabric = n.id === "net-fabric" || n.id === "net-storage";
    return { ...n, cables: [...n.cables], racks: [], attach: fabric ? o.fabricAttach : "nearest", uplink: fabric ? o.uplink : n.uplink };
  });
  const model = VR_MODEL;
  const L = lib[model], SW = lib.sn6810, SB = lib["vr-support-block"];
  if (!L || !SW || !SB) throw new Error("Vera Rubin library items are missing");
  const nRacks = Math.max(1, Math.round(o.racks));
  const gpm = Math.max(1, Math.round(o.gpuPerModule));
  const M = Math.ceil(nRacks / gpm);
  const gpuIn = Array.from({ length: M }, (_, m) => Math.min(gpm, nRacks - m * gpm));
  const supIn = gpuIn.map((g) => Math.max(1, Math.ceil((g * o.supportPerModule) / gpm)));
  const net = vrNetwork(nRacks);

  // CDUs: the liquid load needs this many; The reference design places two per module, between the GPU and support racks.
  const liqKW = nRacks * L.kw * L.liq;
  const cduN = Math.ceil(liqKW / o.cduKW), cduTot = cduN + redN(o.cduRed, cduN);
  const cduPerRow = o.cduPos === "in-row" ? Math.max(1, Math.ceil(Math.max(cduTot, 2 * M) / (2 * M))) : 0;
  const cdu = COOL_K.cdu;

  // Geometry: module m = rows 2m and 2m+1 facing each other across a hot aisle.
  const W = NVL72_RACK.w, D = 1.2, H = o.hot, C = o.cold;
  const podDepth = D + H + D + C;
  const rowY = (row: number) => Math.floor(row / 2) * podDepth + (row % 2 ? D + H : 0);
  const rowRot = (row: number) => (row % 2 ? 180 : 0);
  const gap = cduPerRow * cdu.w + 0.6;
  let maxLen = 0;

  type Placed = { r: Rack; row: number; support: boolean; i: number; m: number };
  const placed: Placed[] = [];
  let gi = 0;
  for (let m = 0; m < M; m++) {
    const gA = Math.ceil(gpuIn[m] / 2), gB = gpuIn[m] - gA, sA = Math.ceil(supIn[m] / 2), sB = supIn[m] - sA;
    const gpuLen = Math.max(gA, gB) * W, supX = gpuLen + gap, supLen = Math.max(sA, sB) * W;
    [[gA, sA], [gB, sB]].forEach(([g, sp], side) => {
      const row = 2 * m + side, y = rowY(row);
      for (let k = 0; k < g; k++) {
        const r = newRack(`G${m + 1}${side ? "B" : "A"}${String(k + 1).padStart(2, "0")}`, k * W + W / 2, y, rowRot(row));
        r.d = NVL72_RACK.d;
        addDevice(r, model, lib);
        for (let j = 0; j < 2; j++) {
          const d = addDevice(r, "sn2201-dc", lib, true);
          if (d) { d.net = "net-oob"; d.tier = "leaf"; }
        }
        placed.push({ r, row, support: false, i: gi++, m });
      }
      for (let k = 0; k < sp; k++) {
        const r = newRack(`S${m + 1}${side ? "B" : "A"}${String(k + 1).padStart(2, "0")}`, supX + k * W + W / 2, y, rowRot(row));
        r.role = "storage";
        // Its own OOB switch for the support equipment's BMC ports (estimate).
        const ob = addDevice(r, "sn2201", lib, true);
        if (ob) { ob.net = "net-oob"; ob.tier = "leaf"; }
        placed.push({ r, row, support: true, i: -1, m });
      }
      if (cduPerRow) for (let k = 0; k < cduPerRow; k++)
        s.coolers.push({ id: uid(), name: `CDU-${m + 1}${side ? "B" : "A"}${k + 1}`, kind: "cdu", x: gpuLen + 0.3 + cdu.w / 2 + k * cdu.w, y, w: cdu.w, d: cdu.d, rot: rowRot(row), cap: o.cduKW });
    });
    if (o.contain) {
      const y = rowY(2 * m) + D / 2 + H / 2;
      s.hacs.push({ id: uid(), name: `Compute HAC ${m + 1}`, x: gpuLen / 2, y, w: gpuLen, d: H, rot: 0 });
      s.hacs.push({ id: uid(), name: `Support HAC ${m + 1}`, x: supX + supLen / 2, y, w: supLen, d: H, rot: 0 });
    }
    maxLen = Math.max(maxLen, supX + supLen);
  }

  // Network switches into the support racks (leaves by each module's share, spines round robin),
  // then support equipment up to the support rack's design load.
  type NetDev = { lib: string; net: string; tier: NetTier };
  const sw = (n: number, net: string, tier: NetTier): NetDev[] => Array.from({ length: n }, () => ({ lib: "sn6810", net, tier }));
  const share = (total: number, m: number) => Math.round((total * gpuIn.slice(0, m + 1).reduce((a, c) => a + c, 0)) / nRacks) - Math.round((total * gpuIn.slice(0, m).reduce((a, c) => a + c, 0)) / nRacks);
  const rr = (total: number, m: number) => Math.floor(total / M) + (m < total % M ? 1 : 0);
  for (let m = 0; m < M; m++) {
    const devs = [
      ...sw(share(net.computeLeaf, m), "net-fabric", "leaf"), ...sw(share(net.convLeaf, m), "net-storage", "leaf"),
      ...sw(rr(net.computeSpine + net.superSpine, m), "net-fabric", "spine"), ...sw(rr(net.convSpine, m), "net-storage", "spine"),
    ];
    const racks = placed.filter((p) => p.support && p.m === m).map((p) => p.r);
    let k = 0;
    for (const d of devs) {
      // Next support rack with room (switch power under the rack's load, and U).
      for (let t = 0; t < racks.length; t++) {
        const r = racks[(k + t) % racks.length];
        const kw = r.devs.reduce((a, x) => a + (lib[x.lib]?.kw ?? 0), 0);
        if (kw + SW.kw <= o.supportKW) {
          const dev = addDevice(r, d.lib, lib, true);
          if (dev) { dev.net = d.net; dev.tier = d.tier; k = (k + t + 1) % racks.length; break; }
        }
      }
    }
    for (const r of racks) {
      let kw = r.devs.reduce((a, x) => a + (lib[x.lib]?.kw ?? 0), 0);
      while (kw + SB.kw / 2 < o.supportKW && addDevice(r, SB.id, lib)) kw += SB.kw;
    }
  }
  const placedSw = placed.reduce((a, p) => a + p.r.devs.filter((d) => d.lib === "sn6810").length, 0);
  const wantSw = net.computeLeaf + net.convLeaf + net.computeSpine + net.superSpine + net.convSpine;
  if (placedSw < wantSw) warnings.push(`Only ${placedSw} of ${wantSw} network switches fit in the support racks: add support racks or raise their design load.`);

  // Power.
  const computeKW = nRacks * L.kw;
  const supportKWTot = placed.filter((p) => p.support).reduce((a, p) => a + p.r.devs.reduce((b, d) => b + (lib[d.lib]?.kw ?? 0), 0), 0);
  const notes: string[] = [...net.notes];
  if (o.power === "power-pods") {
    const ap = podPower(o, placed.map((p) => ({ r: p.r, kva: p.r.devs.reduce((a, d) => a + (lib[d.lib]?.kw ?? 0), 0) / 0.99 })), M);
    s.electrical = ap.e;
    notes.push(...ap.notes);
    warnings.push(...ap.warnings);
  } else {
    // DSX grid-direct or 2N: the shared builder, with support racks as its UPS-backed "network" racks.
    const rows = Array.from({ length: 2 * M }, (_, row) => placed.filter((p) => p.row === row && !p.support).length);
    const pw = buildPower(o, computeKW, L.kw, rows, supportKWTot);
    s.electrical = pw.e;
    for (const p of placed) pw.feeds(p.r, p.i, p.row, p.support);
    notes.push(...pw.notes);
  }
  for (const p of placed) {
    if (!choosePDU(p.r, lib, elec, 1)) warnings.push(`${p.r.name}: no PDU size passes the feed-loss check at ${V} V.`);
    s.racks.push(p.r);
  }

  // Cooling basis: liquid racks to dry / fluid coolers (or chillers), chillers for CRAHs.
  s.cool.cduKW = o.cduKW;
  s.cool.cduRed = o.cduRed;
  s.cool.dlcRej = o.heatRej;
  s.cool.ambF = Math.round((o.ambC * 9) / 5 + 32);
  s.cool.tcsLpm = +tcsLpmPerKW(o.deltaC).toFixed(3);
  s.cool.fwDtF = Math.round((o.deltaC * 9) / 5);
  s.cool.red = "N+1";
  s.cool.upsEff = o.ups ? 0.97 : 1;

  // Trays: fiber on the cold side and busway / power over the hot side of every row; a fiber spine joins the rows.
  for (let row = 0; row < 2 * M; row++) {
    const y = rowY(row), sgn = rowRot(row) ? -1 : 1;
    s.trays.push({ id: uid(), name: `Fiber row ${row + 1}`, kind: "fiber", wmm: 600, dmm: 150, elev: 2.9, pts: [[-0.9, y - 0.15 * sgn], [maxLen + 0.3, y - 0.15 * sgn]] });
    s.trays.push({ id: uid(), name: `${o.feed === "busway" ? "Busway" : "Power"} row ${row + 1}`, kind: o.feed === "busway" ? "busway" : "power", wmm: o.feed === "busway" ? 250 : 600, dmm: 150, elev: 2.6, pts: [[0, y + 0.35 * sgn], [maxLen, y + 0.35 * sgn]] });
  }
  if (2 * M > 1) s.trays.push({ id: uid(), name: "Fiber spine", kind: "fiber", wmm: 600, dmm: 150, elev: 2.9, pts: [[-0.9, rowY(0) - 0.15], [-0.9, rowY(2 * M - 1) + 0.15]] });
  const DUCTS: [number, number][] = [[600, 150], [900, 150], [900, 200], [1200, 200]];
  for (let pass = 0; o.sizeDucts && pass < DUCTS.length; pass++) {
    const over = new Set(cableAnalysis(s, lib).segs.filter((g) => g.fill > s.cable.fillMax).map((g) => g.t.id));
    if (!over.size) break;
    for (const t of s.trays) {
      if (!over.has(t.id)) continue;
      const i = DUCTS.findIndex(([w, d]) => w * d > t.wmm * t.dmm);
      if (i >= 0) [t.wmm, t.dmm] = DUCTS[i];
    }
  }

  // CDUs in a gallery when not in-row; CRAHs along the top wall.
  const an0 = analyze(s, { lib, elec });
  if (!cduPerRow) {
    const gy = rowY(2 * M - 1) + D + C + 1.2;
    for (let i = 0; i < an0.cduTot; i++)
      s.coolers.push({ id: uid(), name: `CDU-${i + 1}`, kind: "cdu", x: i * 1.0 + 0.5, y: gy, w: cdu.w, d: cdu.d, rot: 0, cap: o.cduKW });
  }
  const crahY = -D / 2 - C - 0.45;
  for (let i = 0; i < an0.crahTot; i++) {
    const k = COOL_K.crah;
    s.coolers.push({ id: uid(), name: `CRAH-${i + 1}`, kind: "crah", x: maxLen / 2 + (i - (an0.crahTot - 1) / 2) * 3.2, y: crahY, w: k.w, d: k.d, rot: 180, cap: s.cool.crahKW });
  }
  const an = analyze(s, { lib, elec });

  // Offset onto the plan.
  const ox = o.ox || 0, oy = o.oy || 0;
  for (const r of s.racks) { r.x += ox; r.y += oy; }
  for (const c of s.coolers) { c.x += ox; c.y += oy; }
  for (const h of s.hacs) { h.x += ox; h.y += oy; }
  for (const t of s.trays) t.pts = t.pts.map((q) => [q[0] + ox, q[1] + oy]);

  // Checks and notes.
  const maxAmb = maxDryAmbientC(o.supplyC);
  if (o.heatRej === "drycooler" && o.ambC > maxAmb)
    warnings.push(`Design ambient ${o.ambC} °C is above the ${maxAmb} °C a dry cooler can serve for ${o.supplyC} °C supply. Use chillers, or chiller assist as the reference design does.`);
  if (o.heatRej === "drycooler" && o.ambC > VR_RD.switchC)
    notes.push(`The reference design switches from dry coolers to chiller assist above 82 °F (${VR_RD.switchC} °C) dry bulb: at ${o.ambC} °C design ambient, plan the chiller-assist hours.`);
  if (o.supplyC > VR_RD.itSupplyMaxC) warnings.push(`${o.supplyC} °C supply is above NVIDIA's 45 °C Vera Rubin inlet.`);
  if (o.floor === "raised") warnings.push("VR200 NVL72 racks are heavier than GB300 NVL72 (~3,000 lb): confirm raised-floor concentrated and rolling load ratings, or use slab on grade.");
  if (o.cduKW < (gpm * L.kw * L.liq) / 2) warnings.push(`A ${o.cduKW} kW CDU is under half an AI Module's liquid load (${Math.round(gpm * L.kw)} kW): the reference design's two CDUs per module can't carry it N+1.`);
  warnings.push(...groupWarnings(an.warns.map((w) => w.msg)));
  const itMW = (computeKW + supportKWTot) / 1000;
  const tes = Math.round((VR_RD.tesGal * itMW) / VR_RD.itMW);
  notes.push(
    `Reference design planning basis for 13.44 MW: PUE ${VR_RD.pue}, ${VR_RD.mechMW} MW mechanical, ${VR_RD.siteMW} MW site. This model estimates PUE ${an.pue.toFixed(2)} from the Cooling tab's basis.`,
    `Thermal energy storage: ~${tes.toLocaleString("en-US")} gal on the high-temperature side for ~${VR_RD.tesMin} min ride-through (the reference design's 31,397 gal scaled to ${itMW.toFixed(2)} MW).`,
    `IT coolant ${o.supplyC} °C supply at ${o.deltaC} K ΔT: ${(tcsLpmPerKW(o.deltaC) * L.kw).toFixed(0)} L/min per rack. Dry / fluid cooler loop ${VR_RD.dryLoopC[0]}/${VR_RD.dryLoopC[1]} °C, chilled water ${VR_RD.chwLoopC[0]}/${VR_RD.chwLoopC[1]} °C for CRAHs (reference design).`,
  );
  s.notes = `${nRacks}× Vera Rubin NVL72 (${L.kw} kW) + ${placed.filter((p) => p.support).length} support racks in ${M} AI Module(s), ${nRacks * NVL72_RACK.gpus} GPUs, ${POWER_ARCH[o.power].label}. After the reference design ${VR_RD.ref}; estimates to verify.`;

  const cnt = (t: ElecNode["type"]) => s.electrical.nodes.filter((n) => n.type === t).length;
  const bom: Nvl72Bom[] = [
    { item: "Vera Rubin NVL72 rack", qty: nRacks, detail: `${L.kw} kW design (${o.vrProfile === "maxq" ? "Max-Q" : "Max-P"}; Max-Q ${o.maxQKW} / Max-P ${o.maxPKW} kW), 2 in-rack SN2201 OOB` },
    { item: "Support racks", qty: placed.filter((p) => p.support).length, detail: `${o.supportKW} kW design load: ${placedSw} SN6810 switches + support equipment` },
    { item: "AI Modules", qty: M, detail: `${gpm} GPU + ${o.supportPerModule} support racks each` },
    { item: "CDU", qty: s.coolers.filter((c) => c.kind === "cdu").length, detail: `${o.picks.cdus ?? "L2L CDU"} · ${o.cduKW} kW · ${o.cduRed} (needs ${an.cduTot})` },
    { item: "CRAH", qty: an.crahTot, detail: o.picks.crah ?? `${s.cool.crahKW} kW chilled-water CRAH` },
    { item: o.heatRej === "drycooler" ? "Dry / fluid coolers + chiller assist" : "Chillers", qty: 0, detail: `${Math.round(an.liq * (1 + s.cool.margin))} kW liquid heat rejection` },
    { item: "Thermal energy storage", qty: 0, detail: `~${tes.toLocaleString("en-US")} gal (~${VR_RD.tesMin} min)` },
    { item: "Transformers", qty: cnt("xfmr"), detail: o.picks.transformers ?? "" },
    { item: "Switchboards", qty: cnt("swbd"), detail: o.picks.lv ?? "" },
    { item: "UPS", qty: cnt("ups"), detail: o.picks.ups ?? "" },
    { item: "Generators", qty: cnt("gen"), detail: o.picks.generators ?? "" },
    { item: o.feed === "busway" ? "Busway feeders" : "RPPs", qty: cnt(o.feed === "busway" ? "busway" : "rpp"), detail: `${o.feed === "busway" ? o.busAmps : o.rppAmps} A` },
  ];

  return {
    scenario: s, lib: libItems, elec, net, bom, warnings, notes,
    summary: {
      racks: nRacks, gpus: nRacks * NVL72_RACK.gpus, computeKW, netKW: supportKWTot, itKW: an.it, cduTot: an.cduTot, crahTot: an.crahTot,
      mechKW: an.mechKW, pue: an.pue, areaM2: an.area,
    },
  };
}
