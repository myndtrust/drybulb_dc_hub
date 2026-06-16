#!/usr/bin/env python3
"""
Maintain the Data Center Cost Model equipment catalog.

Single source of truth:  data/equipment-catalog.json
Generated for the app:    lib/cost/catalog.gen.ts   (run `build`)

The catalog is a list of CATEGORIES (electrical, mechanical, ... , gpus, otherAI).
Each category has COMPONENTS (the BOM line items, e.g. "generators"), and each
component has PRODUCTS (alternative vendor offerings with a link to literature).

  category   { key, label, group:"facility"|"ai", defaultPerW, color, sharePct?, includes?, components[] }
  component  { key, label, defaultPerW, kind, confidence:"sourced"|"estimate",
               priceRef?, leadTimeMonths?|leadTimeWeeks?, risk?, products[] }
  product    { vendor, model, spec, price?, url }

`defaultPerW` is $/W of critical IT ($1/W == $1M/MW). A category's component
defaults should sum to the category default (validate warns if they don't).

USAGE  (run from the repo root; on Windows use `python scripts\\equipment_catalog.py ...`)
  python scripts/equipment_catalog.py validate
  python scripts/equipment_catalog.py list
  python scripts/equipment_catalog.py list --category electrical
  python scripts/equipment_catalog.py add-product --component generators \\
      --vendor "Cummins" --model "C2500D6" --spec "2,500 kW standby diesel" \\
      --url "https://www.cummins.com" [--price "~$300/kW"]
  python scripts/equipment_catalog.py set-default --component generators --value 0.50
  python scripts/equipment_catalog.py build      # regenerate lib/cost/catalog.gen.ts

TO EDIT BY HAND: open data/equipment-catalog.json, edit/add entries following the
shape above, then run `validate` and `build`.
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "equipment-catalog.json"
GEN = ROOT / "lib" / "cost" / "catalog.gen.ts"


def load() -> dict:
    with DATA.open(encoding="utf-8") as f:
        return json.load(f)


def save(doc: dict) -> None:
    with DATA.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def find_component(doc: dict, comp_key: str):
    for cat in doc["categories"]:
        for comp in cat.get("components", []):
            if comp["key"] == comp_key:
                return cat, comp
    return None, None


def cmd_validate(doc: dict) -> int:
    errors, warnings = [], []
    seen_cat, seen_comp = set(), set()
    for cat in doc["categories"]:
        for field in ("key", "label", "group", "defaultPerW", "components"):
            if field not in cat:
                errors.append(f"category missing '{field}': {cat.get('key', '?')}")
        if cat.get("group") not in ("facility", "ai"):
            errors.append(f"category '{cat.get('key')}' group must be facility|ai")
        if cat["key"] in seen_cat:
            errors.append(f"duplicate category key: {cat['key']}")
        seen_cat.add(cat["key"])
        comp_sum = 0.0
        for comp in cat.get("components", []):
            for field in ("key", "label", "defaultPerW"):
                if field not in comp:
                    errors.append(f"component missing '{field}' in {cat['key']}")
            if comp["key"] in seen_comp:
                errors.append(f"duplicate component key: {comp['key']}")
            seen_comp.add(comp["key"])
            comp_sum += float(comp.get("defaultPerW", 0))
            if comp.get("confidence") not in (None, "sourced", "estimate"):
                errors.append(f"{comp['key']}: confidence must be sourced|estimate")
            for p in comp.get("products", []):
                for field in ("vendor", "model", "url"):
                    if not p.get(field):
                        errors.append(f"{comp['key']} product missing '{field}'")
        if abs(comp_sum - float(cat["defaultPerW"])) > 0.011:
            warnings.append(
                f"category '{cat['key']}': components sum {comp_sum:.2f} != defaultPerW "
                f"{cat['defaultPerW']:.2f} (itemized will differ from the lump-sum estimate)"
            )
    for w in warnings:
        print(f"  warn: {w}")
    for e in errors:
        print(f"  ERROR: {e}")
    n_cat = len(doc["categories"])
    n_comp = sum(len(c.get("components", [])) for c in doc["categories"])
    n_prod = sum(len(p.get("products", [])) for c in doc["categories"] for p in c.get("components", []))
    print(f"\n{n_cat} categories · {n_comp} components · {n_prod} products · "
          f"{len(warnings)} warnings · {len(errors)} errors")
    return 1 if errors else 0


def cmd_list(doc: dict, category: str | None) -> int:
    for cat in doc["categories"]:
        if category and cat["key"] != category:
            continue
        print(f"\n## {cat['label']}  ({cat['key']}, {cat['group']})  ${cat['defaultPerW']}/W")
        for comp in cat.get("components", []):
            conf = comp.get("confidence", "")
            print(f"  - {comp['label']}  ({comp['key']})  ${comp['defaultPerW']}/W  {conf}")
            for p in comp.get("products", []):
                price = f"  [{p['price']}]" if p.get("price") else ""
                print(f"      · {p['vendor']} {p['model']} — {p.get('spec','')}{price}  {p['url']}")
    return 0


def cmd_add_product(doc: dict, args) -> int:
    cat, comp = find_component(doc, args.component)
    if not comp:
        print(f"component '{args.component}' not found")
        return 1
    comp.setdefault("products", []).append({
        "vendor": args.vendor, "model": args.model, "spec": args.spec or "",
        "price": args.price or "", "url": args.url,
    })
    save(doc)
    print(f"added {args.vendor} {args.model} to {args.component} ({len(comp['products'])} products)")
    return 0


def cmd_set_default(doc: dict, args) -> int:
    cat, comp = find_component(doc, args.component)
    if not comp:
        print(f"component '{args.component}' not found")
        return 1
    comp["defaultPerW"] = args.value
    save(doc)
    print(f"set {args.component} defaultPerW = {args.value}")
    return 0


def cmd_build(doc: dict) -> int:
    header = (
        "// AUTO-GENERATED from data/equipment-catalog.json by scripts/equipment_catalog.py.\n"
        "// Do NOT edit by hand — edit the JSON and run `python scripts/equipment_catalog.py build`.\n\n"
        "export interface CatalogProduct { vendor: string; model: string; spec: string; price?: string; url: string; }\n"
        "export interface CatalogComponent {\n"
        "  key: string; label: string; defaultPerW: number; kind?: string;\n"
        "  confidence?: \"sourced\" | \"estimate\"; priceRef?: string;\n"
        "  leadTimeMonths?: number; leadTimeWeeks?: number; risk?: \"low\" | \"med\" | \"high\";\n"
        "  products: CatalogProduct[];\n}\n"
        "export interface CatalogCategory {\n"
        "  key: string; label: string; group: \"facility\" | \"ai\"; defaultPerW: number;\n"
        "  color: string; sharePct?: string; includes?: string; components: CatalogComponent[];\n}\n\n"
        "export const EQUIPMENT_CATALOG: CatalogCategory[] = "
    )
    body = json.dumps(doc["categories"], indent=2, ensure_ascii=False)
    with GEN.open("w", encoding="utf-8", newline="\n") as f:
        f.write(header + body + ";\n")
    print(f"wrote {GEN.relative_to(ROOT)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Maintain the equipment catalog.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate")
    pl = sub.add_parser("list"); pl.add_argument("--category")
    pa = sub.add_parser("add-product")
    pa.add_argument("--component", required=True)
    pa.add_argument("--vendor", required=True)
    pa.add_argument("--model", required=True)
    pa.add_argument("--spec", default="")
    pa.add_argument("--price", default="")
    pa.add_argument("--url", required=True)
    ps = sub.add_parser("set-default")
    ps.add_argument("--component", required=True)
    ps.add_argument("--value", type=float, required=True)
    sub.add_parser("build")
    args = ap.parse_args()

    doc = load()
    if args.cmd == "validate":
        return cmd_validate(doc)
    if args.cmd == "list":
        return cmd_list(doc, args.category)
    if args.cmd == "add-product":
        return cmd_add_product(doc, args)
    if args.cmd == "set-default":
        return cmd_set_default(doc, args)
    if args.cmd == "build":
        return cmd_build(doc)
    return 1


if __name__ == "__main__":
    sys.exit(main())
