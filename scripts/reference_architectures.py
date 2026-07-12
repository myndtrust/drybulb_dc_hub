#!/usr/bin/env python3
"""
Maintain the AI Factory reference-architecture templates.

Single source of truth:  data/reference-architectures.json
Generated for the app:    lib/factory/reference-architectures.gen.ts   (run `build`)

An RA is a sized building block: a compute `system`, `racking` (systems per rack),
a `scalable_unit` (SU), and `bom_ratios` (every other component per a denominator).
The future engine sizes any target by multiplying ratios by the relevant count.

USAGE  (from the repo root; on Windows use `python scripts\\reference_architectures.py ...`)
  python scripts/reference_architectures.py validate
  python scripts/reference_architectures.py list
  python scripts/reference_architectures.py size --arch gb300-nvl72 --gpus 9216
  python scripts/reference_architectures.py build      # regenerate the typed .gen.ts

TO EDIT BY HAND: open data/reference-architectures.json, follow the shape of an
existing architecture, then run `validate` and `build`.
"""
from __future__ import annotations
import argparse
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "reference-architectures.json"
GEN = ROOT / "lib" / "factory" / "reference-architectures.gen.ts"

PER = {"gpu", "system", "rack", "su", "it_kw", "it_mw"}
CONF = {"sourced", "estimate"}


def load() -> dict:
    with DATA.open(encoding="utf-8") as f:
        return json.load(f)


def cmd_validate(doc: dict) -> int:
    errors, warnings = [], []
    seen = set()
    for a in doc.get("architectures", []):
        key = a.get("key", "?")
        for field in ("key", "label", "system", "racking", "scalable_unit", "bom_ratios"):
            if field not in a:
                errors.append(f"{key}: missing '{field}'")
        if key in seen:
            errors.append(f"duplicate architecture key: {key}")
        seen.add(key)
        sysd, rack, su = a.get("system", {}), a.get("racking", {}), a.get("scalable_unit", {})
        gpus = float(sysd.get("gpus", 0))
        spr = float(rack.get("systems_per_rack", 0))
        if gpus <= 0:
            errors.append(f"{key}: system.gpus must be > 0")
        if spr <= 0:
            errors.append(f"{key}: racking.systems_per_rack must be > 0")
        # consistency: gpus_per_rack == systems_per_rack * gpus
        if gpus > 0 and spr > 0:
            exp = spr * gpus
            if abs(float(rack.get("gpus_per_rack", 0)) - exp) > 0.5:
                errors.append(f"{key}: gpus_per_rack {rack.get('gpus_per_rack')} != systems_per_rack*gpus {exp:.0f}")
            # kw_per_rack ~= systems_per_rack * power_kw (<=5% tolerance)
            exp_kw = spr * float(sysd.get("power_kw", 0))
            kwr = float(rack.get("kw_per_rack", 0))
            if exp_kw > 0 and abs(kwr - exp_kw) / exp_kw > 0.05:
                warnings.append(f"{key}: kw_per_rack {kwr} vs systems_per_rack*power_kw {exp_kw:.0f}")
        # SU consistency
        if su:
            if abs(float(su.get("gpus", 0)) - float(su.get("systems", 0)) * gpus) > 0.5:
                errors.append(f"{key}: scalable_unit.gpus != systems*gpus")
            exp_racks = math.ceil(float(su.get("systems", 0)) / spr) if spr else 0
            if int(su.get("racks", 0)) != exp_racks:
                errors.append(f"{key}: scalable_unit.racks {su.get('racks')} != ceil(systems/systems_per_rack) {exp_racks}")
        # max_config consistency
        mx = a.get("max_config")
        if mx and abs(float(mx.get("gpus", 0)) - float(mx.get("racks", 0)) * float(rack.get("gpus_per_rack", 0))) > 0.5:
            errors.append(f"{key}: max_config.gpus != racks*gpus_per_rack")
        # bom ratios
        for r in a.get("bom_ratios", []):
            for field in ("component", "catalogKey", "per", "qty"):
                if field not in r:
                    errors.append(f"{key}: bom_ratio missing '{field}' ({r.get('component','?')})")
            if r.get("per") not in PER:
                errors.append(f"{key}: bom_ratio '{r.get('component')}' per must be one of {sorted(PER)}")
            if r.get("confidence") not in CONF | {None}:
                errors.append(f"{key}: bom_ratio confidence must be sourced|estimate")

    for w in warnings:
        print(f"  warn: {w}")
    for e in errors:
        print(f"  ERROR: {e}")
    n = len(doc.get("architectures", []))
    nr = sum(len(a.get("bom_ratios", [])) for a in doc.get("architectures", []))
    todo = sum(1 for a in doc.get("architectures", []) for r in a.get("bom_ratios", []) if r.get("catalog_todo"))
    print(f"\n{n} architectures · {nr} bom ratios · {todo} catalog_todo · {len(warnings)} warnings · {len(errors)} errors")
    return 1 if errors else 0


def find(doc: dict, key: str) -> dict | None:
    return next((a for a in doc.get("architectures", []) if a["key"] == key), None)


def size(a: dict, *, gpus=None, scalable_units=None, racks=None, it_mw=None) -> dict:
    sysd, rack, su = a["system"], a["racking"], a["scalable_unit"]
    g_per_sys = float(sysd["gpus"])
    spr = float(rack["systems_per_rack"])
    su_systems = float(su["systems"])
    kw_per_sys = float(sysd["power_kw"])

    if gpus is not None:
        n_systems = math.ceil(gpus / g_per_sys)
    elif scalable_units is not None:
        n_systems = math.ceil(scalable_units * su_systems)
    elif racks is not None:
        n_systems = math.ceil(racks * spr)
    elif it_mw is not None:
        n_systems = math.ceil((it_mw * 1000.0) / kw_per_sys)
    else:
        n_systems = int(su_systems)

    n_racks = math.ceil(n_systems / spr)
    n_su = math.ceil(n_systems / su_systems)
    n_gpus = n_systems * g_per_sys
    it_kw = n_systems * kw_per_sys
    counts = {"gpu": n_gpus, "system": n_systems, "rack": n_racks, "su": n_su, "it_kw": it_kw, "it_mw": it_kw / 1000.0}

    bom = []
    for r in a.get("bom_ratios", []):
        qty = float(r["qty"]) * counts[r["per"]]
        bom.append({"component": r["component"], "model": r.get("model", ""), "qty": qty,
                    "unit": r.get("unit", "ea"), "catalogKey": r["catalogKey"], "confidence": r.get("confidence")})
    system_capex = n_systems * float(sysd.get("capex_usd", 0))
    return {"systems": n_systems, "racks": n_racks, "scalable_units": n_su, "gpus": int(n_gpus),
            "it_mw": round(it_kw / 1000.0, 3), "system_capex_usd": system_capex, "bom": bom}


def cmd_size(doc: dict, args) -> int:
    a = find(doc, args.arch)
    if not a:
        print(f"architecture '{args.arch}' not found")
        return 1
    res = size(a, gpus=args.gpus, scalable_units=args.scalable_units, racks=args.racks, it_mw=args.it_mw)
    print(f"\n## {a['label']}")
    print(f"  systems {res['systems']} · racks {res['racks']} · SU {res['scalable_units']} · "
          f"GPUs {res['gpus']} · IT {res['it_mw']} MW · system capex ${res['system_capex_usd']/1e6:.1f}M")
    for b in res["bom"]:
        print(f"    - {b['component']}: {b['qty']:.0f} {b['unit']}  [{b['catalogKey']}]  {b['confidence']}")
    return 0


def cmd_list(doc: dict) -> int:
    for a in doc.get("architectures", []):
        s, su = a["system"], a["scalable_unit"]
        print(f"\n## {a['label']}  ({a['key']})")
        print(f"  system: {s['gpus']} GPU ({s.get('gpu_model','')}) · {s['power_kw']} kW · ${s.get('capex_usd',0)/1e6:.2f}M")
        print(f"  SU: {su['systems']} systems / {su['racks']} racks / {su['gpus']} GPU · "
              f"cooling {a.get('cooling')} · fabric {a.get('compute_fabric')} · power {a.get('power_scheme')}")
    return 0


TS_HEADER = (
    "// AUTO-GENERATED from data/reference-architectures.json by scripts/reference_architectures.py.\n"
    "// Do NOT edit by hand — edit the JSON and run `python scripts/reference_architectures.py build`.\n\n"
    "export interface RaSystem {\n"
    "  key: string; label: string; catalogKey: string; gpus: number; gpu_model: string;\n"
    "  cpus: number; cpu_model: string; compute_trays?: number; hbm_tb?: number;\n"
    "  power_kw: number; rack_u: number; capex_usd: number; perf_fp4_pflops?: number;\n"
    "  confidence: \"sourced\" | \"estimate\";\n}\n"
    "export interface RaRacking { systems_per_rack: number; gpus_per_rack: number; kw_per_rack: number; }\n"
    "export interface RaScalableUnit { systems: number; racks: number; gpus: number; }\n"
    "export interface RaBomRatio {\n"
    "  component: string; catalogKey: string; model?: string; catalog_todo?: boolean;\n"
    "  per: \"gpu\" | \"system\" | \"rack\" | \"su\" | \"it_kw\" | \"it_mw\"; qty: number;\n"
    "  unit?: string; confidence?: \"sourced\" | \"estimate\";\n}\n"
    "export interface ReferenceArchitecture {\n"
    "  key: string; label: string; vendor: string; family: string;\n"
    "  cooling: string; liquid_fraction: number; power_scheme: string; compute_fabric: string;\n"
    "  confidence: \"sourced\" | \"estimate\"; source: string;\n"
    "  system: RaSystem; racking: RaRacking; scalable_unit: RaScalableUnit;\n"
    "  max_config?: { racks: number; gpus: number }; bom_ratios: RaBomRatio[];\n}\n\n"
    "export const RA_TARGETS = [\"gpus\", \"scalable_units\", \"racks\", \"it_mw\", \"fp4_pflops\"] as const;\n"
    "export type RaTarget = (typeof RA_TARGETS)[number];\n\n"
    "export const REFERENCE_ARCHITECTURES: ReferenceArchitecture[] = "
)


def cmd_build(doc: dict) -> int:
    GEN.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(doc["architectures"], indent=2, ensure_ascii=False)
    with GEN.open("w", encoding="utf-8", newline="\n") as f:
        f.write(TS_HEADER + body + ";\n")
    print(f"wrote {GEN.relative_to(ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Maintain the AI Factory reference architectures.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate")
    sub.add_parser("list")
    sub.add_parser("build")
    ps = sub.add_parser("size")
    ps.add_argument("--arch", required=True)
    ps.add_argument("--gpus", type=float)
    ps.add_argument("--scalable-units", type=float)
    ps.add_argument("--racks", type=float)
    ps.add_argument("--it-mw", type=float)
    args = ap.parse_args()

    doc = load()
    if args.cmd == "validate":
        return cmd_validate(doc)
    if args.cmd == "list":
        return cmd_list(doc)
    if args.cmd == "size":
        return cmd_size(doc, args)
    if args.cmd == "build":
        return cmd_build(doc)
    return 1


if __name__ == "__main__":
    sys.exit(main())
