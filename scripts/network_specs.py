#!/usr/bin/env python3
"""
Maintain the AI Factory network-equipment specs (same form/schema as rack specs).

Single source of truth:  data/network-specs.json
Generated for the app:    lib/factory/network-specs.gen.ts   (run `build`)

`switches` = switch SKUs (power per unit). `racks` = role-based network racks
(east-west compute fabric / north-south storage / mgmt) composed of those SKUs,
each carrying the SAME power + cooling interface shape as an AI rack.

USAGE  (from the repo root; on Windows: `python scripts\\network_specs.py ...`)
  python scripts/network_specs.py validate
  python scripts/network_specs.py list
  python scripts/network_specs.py build
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "network-specs.json"
GEN = ROOT / "lib" / "factory" / "network-specs.gen.ts"

CONF = {"sourced", "estimate"}
ROLES = {"east-west", "north-south", "storage", "mgmt"}
POWER_FIELDS = ("rack_kw", "voltage_v", "phase", "delivery", "feeds", "redundancy",
                "circuit_amps", "circuit_size", "connector", "rack_pdu")
COOLING_FIELDS = ("type", "liquid_fraction", "coolant", "flow_lpm", "supply_c",
                  "return_c", "delta_c", "manifold", "air_cfm", "air_supply_c")


def load() -> dict:
    with DATA.open(encoding="utf-8") as f:
        return json.load(f)


def cmd_validate(doc: dict) -> int:
    errors: list[str] = []
    warnings: list[str] = []
    sku_pwr: dict[str, float] = {}
    seen = set()
    for s in doc.get("switches", []):
        k = s.get("key", "?")
        if k in seen:
            errors.append(f"duplicate switch key: {k}")
        seen.add(k)
        for f in ("key", "label", "vendor", "model", "role", "power_kw"):
            if f not in s:
                errors.append(f"switch {k}: missing '{f}'")
        if s.get("role") not in ROLES:
            errors.append(f"switch {k}: role must be one of {sorted(ROLES)}")
        if float(s.get("power_kw", 0)) <= 0:
            errors.append(f"switch {k}: power_kw must be > 0")
        if s.get("confidence") not in CONF:
            errors.append(f"switch {k}: confidence must be sourced|estimate")
        sku_pwr[k] = float(s.get("power_kw", 0))

    rseen = set()
    for r in doc.get("racks", []):
        k = r.get("key", "?")
        if k in rseen:
            errors.append(f"duplicate rack key: {k}")
        rseen.add(k)
        for f in ("key", "label", "role", "power", "cooling", "switches"):
            if f not in r:
                errors.append(f"rack {k}: missing '{f}'")
        if r.get("role") not in ROLES:
            errors.append(f"rack {k}: role must be one of {sorted(ROLES)}")
        if r.get("confidence") not in CONF:
            errors.append(f"rack {k}: confidence must be sourced|estimate")
        p = r.get("power", {})
        for f in POWER_FIELDS:
            if f not in p:
                errors.append(f"rack {k}: power missing '{f}'")
        if float(p.get("rack_kw", 0)) <= 0:
            errors.append(f"rack {k}: power.rack_kw must be > 0")
        if int(p.get("feeds", 0)) < 1:
            errors.append(f"rack {k}: power.feeds must be >= 1")
        c = r.get("cooling", {})
        for f in COOLING_FIELDS:
            if f not in c:
                errors.append(f"rack {k}: cooling missing '{f}'")
        # composition + kW roll-up vs declared (warn at >5%)
        comp_kw = 0.0
        for sw in r.get("switches", []):
            sku = sw.get("sku")
            if sku not in sku_pwr:
                errors.append(f"rack {k}: unknown switch sku '{sku}'")
            else:
                comp_kw += sku_pwr[sku] * float(sw.get("qty", 0))
        decl = float(p.get("rack_kw", 0))
        if comp_kw > 0 and decl > 0 and abs(decl - comp_kw) / comp_kw > 0.05:
            warnings.append(f"rack {k}: rack_kw {decl} vs sum switch power {comp_kw:.1f}")

    for w in warnings:
        print(f"  warn: {w}")
    for e in errors:
        print(f"  ERROR: {e}")
    print(f"\n{len(doc.get('switches', []))} switches · {len(doc.get('racks', []))} racks · "
          f"{len(warnings)} warnings · {len(errors)} errors")
    return 1 if errors else 0


def cmd_list(doc: dict) -> int:
    for r in doc.get("racks", []):
        p, c = r["power"], r["cooling"]
        comp = ", ".join(f"{s['qty']}x {s['sku']}" for s in r["switches"])
        print(f"\n## {r['label']}  ({r['key']})  [{r['confidence']}]")
        print(f"  role {r['role']} · {comp}")
        print(f"  power: {p['rack_kw']} kW · {p['feeds']}x {p['circuit_amps']} A · {p['voltage_v']} V {p['phase']}")
        print(f"  cooling: {c['type']} · supply {c['supply_c']} C")
    return 0


TS_HEADER = (
    "// AUTO-GENERATED from data/network-specs.json by scripts/network_specs.py.\n"
    "// Do NOT edit by hand — edit the JSON and run `python scripts/network_specs.py build`.\n\n"
    "import { type RackPower, type RackCooling } from \"./rack-specs.gen\";\n\n"
    "export type NetRole = \"east-west\" | \"north-south\" | \"storage\" | \"mgmt\";\n"
    "export interface NetworkSwitch {\n"
    "  key: string; label: string; vendor: string; model: string; role: NetRole;\n"
    "  ports?: string; speed?: string; power_kw: number;\n"
    "  confidence: \"sourced\" | \"estimate\"; source: string;\n}\n"
    "export interface NetworkRackSwitch { sku: string; qty: number; }\n"
    "export interface NetworkRack {\n"
    "  key: string; label: string; role: NetRole; fabric: string;\n"
    "  switches: NetworkRackSwitch[]; power: RackPower; cooling: RackCooling;\n"
    "  confidence: \"sourced\" | \"estimate\"; source: string;\n}\n\n"
)


def cmd_build(doc: dict) -> int:
    GEN.parent.mkdir(parents=True, exist_ok=True)
    switches = json.dumps(doc["switches"], indent=2, ensure_ascii=False)
    racks = json.dumps(doc["racks"], indent=2, ensure_ascii=False)
    with GEN.open("w", encoding="utf-8", newline="\n") as f:
        f.write(TS_HEADER)
        f.write("export const NETWORK_SWITCHES: NetworkSwitch[] = " + switches + ";\n\n")
        f.write("export const NETWORK_RACKS: NetworkRack[] = " + racks + ";\n\n")
        f.write("export const NETWORK_RACK_BY_KEY: Record<string, NetworkRack> = Object.fromEntries(\n"
                "  NETWORK_RACKS.map((r) => [r.key, r]),\n);\n")
    print(f"wrote {GEN.relative_to(ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Maintain the AI Factory network-equipment specs.")
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
