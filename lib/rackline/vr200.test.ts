// node:test for Vera Rubin NVL72 halls after the modular reference design (lib/rackline/vr200.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { REFERENCE_ARCHITECTURES } from "../factory/reference-architectures.gen";
import { analyze, electricalLoads } from "./analysis";
import { DEF_LIB } from "./constants";
import { DEFAULT_ELEC, libIndex, stripeLoads } from "./model";
import { defaultNvl72Options, ensureNvl72Lib, type Nvl72PodOptions } from "./nvl72";
import { VR_RD, VR_MODEL, buildReferencePod, buildVr200Hall, vrNetwork, withVrProfile } from "./vr200";
import type { LibItem } from "./types";

const libItems = (): LibItem[] => { const l = DEF_LIB.map((x) => ({ ...x, ports: { ...x.ports } })); ensureNvl72Lib(l); return l; };
const build = (o: Partial<Nvl72PodOptions> = {}) => buildVr200Hall({ ...defaultNvl72Options("vr200"), ...o }, libItems(), DEFAULT_ELEC);

test("vr200: the default hall is the reference design's 4 AI Modules of 14 GPU + 16 support racks", () => {
  const r = build();
  const s = r.scenario, lib = libIndex(r.lib!);
  const gpu = s.racks.filter((x) => x.devs.some((d) => d.lib === VR_MODEL));
  const sup = s.racks.filter((x) => x.role === "storage");
  assert.equal(gpu.length, 56);
  assert.equal(sup.length, 64);
  assert.equal(r.summary.gpus, 4032);
  // Support racks are filled to about their 35 kW design load.
  for (const x of sup) {
    const kw = x.devs.reduce((a, d) => a + (lib[d.lib]?.kw ?? 0), 0);
    assert.ok(Math.abs(kw - VR_RD.supportKW) <= 1.5, `${x.name} ${kw} kW`);
  }
  // Two CDUs per module, a compute and a support containment per module.
  assert.equal(s.coolers.filter((c) => c.kind === "cdu").length, 8);
  assert.equal(s.hacs.length, 8);
  // Power Pods: 4 × 5 MVA transformers + 4 mechanical powertrains, 4 generators each kind, 16 × 1,600 A feeders.
  const n = (re: RegExp) => s.electrical.nodes.filter((x) => re.test(x.name)).length;
  assert.equal(n(/^Power Pod . TX 5 MVA/), 4);
  assert.equal(n(/^Mechanical powertrain \d TX/), 4);
  assert.equal(n(/^Power Pod . GEN/), 4);
  assert.equal(n(/^Pod . feeder \d 1600 A/), 16);
  // Every rack takes its two feeds from two different Power Pods.
  const pod = (id: string | null) => s.electrical.nodes.find((x) => x.id === id)!.name.slice(4, 5);
  for (const x of s.racks) assert.notEqual(pod(x.feedA), pod(x.feedB), x.name);
});

test("vr200: each rack carries Max-Q and Max-P ratings; the design load follows the profile and overrides", () => {
  const base = libItems();
  const it = base.find((x) => x.id === VR_MODEL)!;
  assert.deepEqual([it.kwMaxQ, it.kwMaxP], [187, 227]);
  const q = withVrProfile(base, { vrProfile: "maxq", maxQKW: 187, maxPKW: 227 }).find((x) => x.id === VR_MODEL)!;
  assert.equal(q.kw, 187);
  const own = withVrProfile(base, { vrProfile: "maxp", maxQKW: 190, maxPKW: 240 }).find((x) => x.id === VR_MODEL)!;
  assert.deepEqual([own.kw, own.kwMaxQ, own.kwMaxP], [240, 190, 240]);
  assert.equal(base.find((x) => x.id === VR_MODEL)!.kw, 227, "the input library isn't changed");
  assert.equal(build({ vrProfile: "maxq" }).summary.computeKW, 56 * 187);
  assert.equal(build({ maxPKW: 210 }).summary.computeKW, 56 * 210);
});

test("vr200: Max-P can't ride on one feed's 4 inputs; Max-Q can", () => {
  const p = build({ racks: 14 });
  assert.ok(p.warnings.some((w) => /PSU over 55000 W when one feed is lost/.test(w)));
  const q = build({ racks: 14, vrProfile: "maxq" });
  const lib = libIndex(q.lib!);
  for (const x of q.scenario.racks.filter((r) => r.devs.some((d) => d.lib === VR_MODEL)))
    assert.ok(stripeLoads(x, lib, q.elec, 1).util <= 1, x.name);
});

test("vr200: feeders are balanced; losing one Power Pod is checked (the reference design's 4-to-make-3 caveat)", () => {
  const r = build({ vrProfile: "maxq" });
  const lib = libIndex(r.lib!);
  const an = analyze(r.scenario, { lib, elec: r.elec });
  const loads = electricalLoads(r.scenario, an.racks, an.mechKW, r.elec);
  for (const x of Object.values(loads)) if (/feeder|UPS|TX/.test(x.n.name)) assert.ok(x.util <= 1, `${x.n.name} ${x.util.toFixed(2)}`);
  // 2 × 2,000 kVA UPS per Pod can't take a lost Pod's share: flagged, as the reference design warns.
  assert.ok(r.warnings.some((w) => /Power Pod 4-to-make-3 not met/.test(w)));
});

test("vr200: network estimate fits its leaves; DSX and 2N options build", () => {
  const net = vrNetwork(56);
  assert.equal(net.computeLeaf, Math.ceil((144 * 56) / 60));
  assert.equal(net.computeSpine, Math.ceil((144 * 56) / 128));
  const r = build();
  assert.ok(!r.warnings.some((w) => /leaf switch ports|network switches fit/.test(w)), r.warnings.join("; "));
  for (const power of ["dsx-grid-direct", "ups-2n"] as const) {
    const x = build({ power, racks: 28, voltage: power === "ups-2n" ? 415 : 480 });
    const ids = new Set(x.scenario.electrical.nodes.map((n) => n.id));
    for (const rk of x.scenario.racks) assert.ok(ids.has(rk.feedA!) && ids.has(rk.feedB!), `${power} ${rk.name}`);
  }
});

test("vr200: buildReferencePod picks the platform; the catalog has the modular entry", () => {
  const items = libItems();
  assert.equal(buildReferencePod({ ...defaultNvl72Options("vr200"), racks: 14 }, items, DEFAULT_ELEC).summary.gpus, 1008);
  assert.equal(buildReferencePod({ ...defaultNvl72Options("gb300"), racks: 4 }, items, DEFAULT_ELEC).summary.gpus, 288);
  const ra = REFERENCE_ARCHITECTURES.find((a) => a.key === "vr200-nvl72-modular")!;
  assert.ok(ra);
  assert.deepEqual([ra.scalable_unit.racks, ra.system.gpus, ra.racking.kw_per_rack], [14, 72, 200]);
  assert.equal(ra.bom_ratios.find((b) => /Power Pod transformer/.test(b.component))!.qty, 1);
});
