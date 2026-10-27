// node:test for GB300 NVL72 pods (lib/rackline/nvl72.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { analyze, electricalLoads } from "./analysis";
import { DEF_LIB } from "./constants";
import { DEFAULT_ELEC, libIndex, stripeLoads } from "./model";
import { netSummaries } from "./network";
import {
  NVL72_LIB, POWER_ARCH, buildNvl72Pod, defaultNvl72Options, ensureNvl72Lib, maxDryAmbientC, raNetwork, specRating, type Nvl72PodOptions,
} from "./nvl72";
import type { LibItem } from "./types";

const libItems = (): LibItem[] => { const l = DEF_LIB.map((x) => ({ ...x })); ensureNvl72Lib(l); return l; };
const build = (o: Partial<Nvl72PodOptions> = {}) => {
  const items = libItems();
  return { items, res: buildNvl72Pod({ ...defaultNvl72Options(), ...o }, items, DEFAULT_ELEC) };
};

test("nvl72: RA network counts follow NVL72 RA Tables 6–7 (GB300)", () => {
  assert.deepEqual([raNetwork(2).computeLeaf, raNetwork(2).computeSpine, raNetwork(2).convLeaf], [8, 4, 2]);
  assert.deepEqual([raNetwork(4).computeLeaf, raNetwork(4).computeSpine, raNetwork(4).convSpine], [16, 8, 2]);
  assert.deepEqual([raNetwork(8).computeLeaf, raNetwork(8).computeSpine, raNetwork(8).convLeaf, raNetwork(8).convSpine], [32, 12, 7, 4]);
  assert.equal(raNetwork(3).design, 4);
  assert.equal(raNetwork(6).design, 8);
  assert.equal(raNetwork(16).design, null);
  assert.ok(raNetwork(16).superSpine > 0);
  assert.equal(raNetwork(8).oob, 16);
});

test("nvl72: catalog spec strings give ratings", () => {
  assert.equal(specRating("Liquid-to-liquid CDU, up to 1.35 MW", "kW"), 1350);
  assert.equal(specRating("L2L / L2A CDU, 105 kW-2.5 MW", "kW"), 2500);
  assert.equal(specRating("Liquid-to-liquid CDU, 1,000 kW", "kW"), 1000);
  assert.equal(specRating("250-1,200 kVA, transformer-free", "kVA"), 1200);
  assert.equal(specRating("Overhead plug-in busway, 40-1,250 A", "A"), 1250);
  assert.equal(specRating("Coolant distribution unit", "kW"), null);
});

test("nvl72: an 8-rack GB300 pod per the RA is complete and every rack is fed", () => {
  const { items, res } = build();
  const s = res.scenario;
  const lib = libIndex(items);
  const compute = s.racks.filter((r) => r.devs.some((d) => d.lib === "gb300-nvl72"));
  assert.equal(compute.length, 8);
  assert.equal(res.summary.gpus, 576);
  assert.equal(res.summary.computeKW, 8 * 142);
  assert.ok(s.racks.some((r) => r.role === "network"));
  // [ra] 2 SN2201 in every rack; 12 management nodes in the control-plane rack.
  for (const r of compute) assert.equal(r.devs.filter((d) => d.lib === "sn2201-dc" && d.net === "net-oob").length, 2, r.name);
  assert.equal(s.racks.find((r) => r.name === "MGMT-1")!.devs.filter((d) => d.lib === "ra-mgmt-node").length, 12);
  const ids = new Set(s.electrical.nodes.map((n) => n.id));
  for (const r of s.racks) {
    assert.ok(r.feedA && ids.has(r.feedA), `${r.name} feed A`);
    assert.ok(r.feedB && ids.has(r.feedB) && r.feedB !== r.feedA, `${r.name} feed B`);
  }
  // 2N default: compute is on UPS (no grid-direct path for GB300).
  const up = new Map(s.electrical.links.map((l) => [l.to, l.from]));
  const byId = new Map(s.electrical.nodes.map((n) => [n.id, n]));
  for (const r of compute) {
    let cur: string | undefined = r.feedA!, ups = false;
    while (cur) { ups ||= byId.get(cur)!.type === "ups"; cur = up.get(cur); }
    assert.ok(ups, r.name);
  }
  // Whips: each rack's 60 A-class circuits pass at normal load (feed loss is checked separately).
  for (const r of compute) assert.ok(stripeLoads(r, lib, res.elec, 1).maxN <= stripeLoads(r, lib, res.elec, 1).lim, r.name);
  // CDUs cover the liquid load; CRAHs carry the ~10 % residual air.
  const an = analyze(s, { lib, elec: res.elec });
  assert.ok(s.coolers.filter((c) => c.kind === "cdu").length >= an.cduTot);
  assert.ok(an.cduTot * 1350 >= an.liq);
  assert.ok(an.air > 8 * 142 * 0.09);
  assert.ok(an.crahTot > 0);
});

test("nvl72: OOB cables stay in the rack; fabrics spread over every leaf", () => {
  const { items, res } = build();
  const lib = libIndex(items);
  const an = analyze(res.scenario, { lib, elec: res.elec });
  const oob = an.cab.groups.filter((g) => g.net === "net-oob" && g.from.devs.some((d) => d.lib === "gb300-nvl72"));
  assert.ok(oob.length && oob.every((g) => g.via === "in-rack" && g.from.id === g.to.id));
  const sums = netSummaries(res.scenario, lib, an.cab.groups);
  assert.equal(sums.find((n) => n.sys.id === "net-oob")!.access, 8 * 54 + 12);
  assert.equal(sums.find((n) => n.sys.id === "net-fabric")!.access, 8 * 144);
  assert.equal(sums.find((n) => n.sys.id === "net-storage")!.access, 8 * 36 + 12 * 4);
  assert.ok(!an.warns.some((w) => /leaf switch ports/.test(w.msg)), an.warns.map((w) => w.msg).join("; "));
});

test("nvl72: no distribution node is over its rating, in any architecture", () => {
  for (const power of ["dsx-grid-direct", "ups-2n", "dr-4to3"] as const) {
    for (const feed of ["rpp", "busway"] as const) {
      const { items, res } = build({ power, feed, voltage: power === "dsx-grid-direct" ? 480 : 415, racks: 16 });
      const lib = libIndex(items);
      const an = analyze(res.scenario, { lib, elec: res.elec });
      const loads = electricalLoads(res.scenario, an.racks, an.mechKW, res.elec);
      for (const x of Object.values(loads)) {
        if (["rpp", "busway"].includes(x.n.type)) assert.ok(x.util <= 1.0001, `${power}/${feed} ${x.n.name} ${x.util.toFixed(2)}`);
      }
    }
  }
});

test("nvl72: GB300 offers 2N and 4-to-make-3 only", () => {
  assert.deepEqual(Object.entries(POWER_ARCH).filter(([, v]) => v.platforms.includes("gb300")).map(([k]) => k), ["ups-2n", "dr-4to3"]);
  assert.deepEqual(Object.entries(POWER_ARCH).filter(([, v]) => v.platforms.includes("vr200")).map(([k]) => k), ["power-pods", "dsx-grid-direct", "ups-2n"]);
});

test("nvl72: checks flag dry coolers in a hot climate, warm water and a raised floor", () => {
  assert.equal(maxDryAmbientC(45), 35);
  const hot = build({ heatRej: "drycooler", ambC: 35, supplyC: 30, floor: "raised" }).res.warnings;
  assert.ok(hot.some((w) => w.includes("a dry cooler can serve")));
  assert.ok(hot.some((w) => w.includes("raised-floor")));
  assert.ok(build({ supplyC: 45 }).res.warnings.some((w) => w.includes("177 L/min per rack")));
  assert.ok(build({ supplyC: 50 }).res.warnings.some((w) => w.includes("outside the 25–45 °C")));
  assert.ok(!build().res.warnings.some((w) => w.includes("a dry cooler can serve") || w.includes("Mechanical panel")));
});

test("nvl72: library items are rack-scale, 3-phase, 8 × 33 kW shelves", () => {
  for (const l of NVL72_LIB.filter((x) => x.cat === "compute" && x.id.startsWith("gb300"))) {
    assert.equal(l.phase3, true);
    assert.equal(l.psu * l.psuW, 8 * 33000);
    assert.deepEqual(l.ports, { fabric: 144, storage: 36, bmc: 54 });
  }
  const items = libItems();
  const n = items.length;
  ensureNvl72Lib(items);
  assert.equal(items.length, n, "ensureNvl72Lib is idempotent");
});
