#!/usr/bin/env python3
"""
Maintain the AI Factory rack interface specs (power + cooling + network sizing).

Single source of truth:  data/rack-specs.json
Generated for the app:    lib/factory/rack-specs.gen.ts   (run `build`)

Each rack defines its POWER interface (rack kW, voltage, phase, delivery, per-feed
circuit amps + conductor size, redundancy, connector), COOLING interface (air +
water/DLC: flow, supply/return temps, ΔT, manifold), and NETWORK ratios used to
arrange east-west (compute fabric) and north-south (front-end/storage/mgmt) racks.

USAGE  (from the repo root; on Windows: `python scripts\\rack_specs.py ...`)
  python scripts/rack_specs.py validate
  python scripts/rack_specs.py list
  python scripts/rack_specs.py build      # regenerate the typed .gen.ts
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "rack-specs.json"
GEN = ROOT / "lib" / "factory" / "rack-specs.gen.ts"

CONF = {"sourced", "estimate"}
POWER_FIELDS = ("rack_kw", "voltage_v", "phase", "delivery", "feeds", "redundancy",
                "circuit_amps", "circuit_size", "connector", "rack_pdu")
COOLING_FIELDS = ("type", "liquid_fraction", "coolant", "flow_lpm", "supply_c",
                  "return_c", "delta_c", "manifold", "air_cfm", "air_supply_c")
NETWORK_FIELDS = ("fabric_ew", "racks_per_su", "leaf_per_rack", "spine_per_su",
                  "storage_per_su", "mgmt_per_su", "fabric_ns")


def load() -> dict:
    with DATA.open(encoding="utf-8") as f:
        return json.load(f)


def cmd_validate(doc: dict) -> int:
    errors: list[str] = []
    seen = set()
    for r in doc.get("racks", []):
        key = r.get("key", "?")
        if key in seen:
            errors.append(f"duplicate rack key: {key}")
        seen.add(key)
        for field in ("key", "label", "vendor", "power", "cooling", "network"):
            if field not in r:
                errors.append(f"{key}: missing '{field}'")
        if r.get("confidence") not in CONF:
            errors.append(f"{key}: confidence must be sourced|estimate")
        p = r.get("power", {})
        for f in POWER_FIELDS:
            if f not in p:
                errors.append(f"{key}: power missing '{f}'")
        if float(p.get("rack_kw", 0)) <= 0:
            errors.append(f"{key}: power.rack_kw must be > 0")
        if int(p.get("feeds", 0)) < 1:
            errors.append(f"{key}: power.feeds must be >= 1")
        if float(p.get("circuit_amps", 0)) <= 0:
            errors.append(f"{key}: power.circuit_amps must be > 0")
        c = r.get("cooling", {})
        for f in COOLING_FIELDS:
            if f not in c:
                errors.append(f"{key}: cooling missing '{f}'")
        lf = float(c.get("liquid_fraction", -1))
        if not (0.0 <= lf <= 1.0):
            errors.append(f"{key}: cooling.liquid_fraction must be 0..1")
        n = r.get("network", {})
        for f in NETWORK_FIELDS:
            if f not in n:
                errors.append(f"{key}: network missing '{f}'")

    for e in errors:
        print(f"  ERROR: {e}")
    nr = len(doc.get("racks", []))
    est = sum(1 for r in doc.get("racks", []) if r.get("confidence") == "estimate")
    print(f"\n{nr} racks · {est} estimate · {len(errors)} errors")
    return 1 if errors else 0


def cmd_list(doc: dict) -> int:
    for r in doc.get("racks", []):
        p, c = r["power"], r["cooling"]
        print(f"\n## {r['label']}  ({r['key']})  [{r['confidence']}]")
        print(f"  power: {p['rack_kw']} kW · {p['voltage_v']} V {p['phase']} · "
              f"{p['feeds']}× {p['circuit_amps']} A ({p['redundancy']}) · {p['delivery']}")
        print(f"  cooling: {c['type']} · liquid {c['liquid_fraction']} · "
              f"{c['flow_lpm']} LPM · W{c['supply_c']}/{c['return_c']} (ΔT {c['delta_c']})")
    return 0


TS_HEADER = (
    "// AUTO-GENERATED from data/rack-specs.json by scripts/rack_specs.py.\n"
    "// Do NOT edit by hand — edit the JSON and run `python scripts/rack_specs.py build`.\n\n"
    "export interface RackPower {\n"
    "  rack_kw: number; peak_kw?: number; voltage_v: number;\n"
    "  phase: \"3ph-ac\" | \"dc-busbar\"; delivery: \"vertical-busbar\" | \"whip-rpp\" | \"busway-tap\";\n"
    "  feeds: number; redundancy: \"N\" | \"N+1\" | \"2N\" | \"2N+1\" | \"4-to-make-3\" | \"3-to-make-2\";\n"
    "  circuit_amps: number; circuit_size: string;\n"
    "  connector: string; rack_pdu: string;\n}\n"
    "export interface RackCooling {\n"
    "  type: \"liquid-dlc\" | \"hybrid\" | \"air\"; liquid_fraction: number; coolant: string;\n"
    "  flow_lpm: number; supply_c: number; return_c: number; delta_c: number;\n"
    "  manifold: string; air_cfm: number; air_supply_c: number;\n}\n"
    "export interface RackNetwork {\n"
    "  fabric_ew: string; racks_per_su: number; leaf_per_rack: number; spine_per_su: number;\n"
    "  storage_per_su: number; mgmt_per_su: number; fabric_ns: string;\n}\n"
    "export interface RackSpec {\n"
    "  key: string; label: string; vendor: string; family: string;\n"
    "  accel_model: string; accel_per_rack: number; gpus_per_rack: number;\n"
    "  power: RackPower; cooling: RackCooling; network: RackNetwork;\n"
    "  confidence: \"sourced\" | \"estimate\"; source: string;\n}\n\n"
    "export const RACK_SPECS: RackSpec[] = "
)


def cmd_build(doc: dict) -> int:
    GEN.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(doc["racks"], indent=2, ensure_ascii=False)
    with GEN.open("w", encoding="utf-8", newline="\n") as f:
        f.write(TS_HEADER + body + ";\n\n"
                "export const RACK_SPEC_BY_KEY: Record<string, RackSpec> = Object.fromEntries(\n"
                "  RACK_SPECS.map((r) => [r.key, r]),\n);\n")
    print(f"wrote {GEN.relative_to(ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Maintain the AI Factory rack interface specs.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate")
    sub.add_parser("list")
    sub.add_parser("build")
    args = ap.parse_args()

    doc = load()
    if args.cmd == "validate":
        return cmd_validate(doc)
    if args.cmd == "list":
        return cmd_list(doc)
    if args.cmd == "build":
        return cmd_build(doc)
    return 1


if __name__ == "__main__":
    sys.exit(main())
