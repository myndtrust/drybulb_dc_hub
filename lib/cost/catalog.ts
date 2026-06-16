// ─────────────────────────────────────────────────────────────────────────────
// Equipment catalog — thin, typed access layer over the generated data.
//
// The data itself lives in data/equipment-catalog.json (the source of truth) and
// is code-generated into catalog.gen.ts by scripts/equipment_catalog.py. This
// module never hard-codes equipment; it only indexes EQUIPMENT_CATALOG and offers
// lookup helpers + default seeds for the itemized BOM. Keep this file free of any
// import from ./types so types.ts can import the seed helpers without a cycle.
// ─────────────────────────────────────────────────────────────────────────────

import {
  EQUIPMENT_CATALOG,
  type CatalogCategory,
  type CatalogComponent,
  type CatalogProduct,
} from "./catalog.gen";

export { EQUIPMENT_CATALOG };
export type { CatalogCategory, CatalogComponent, CatalogProduct };

const CATALOG_BY_KEY: Record<string, CatalogCategory> = Object.fromEntries(
  EQUIPMENT_CATALOG.map((c) => [c.key, c]),
);

export const FACILITY_CATEGORIES = EQUIPMENT_CATALOG.filter((c) => c.group === "facility");
export const AI_CATEGORIES = EQUIPMENT_CATALOG.filter((c) => c.group === "ai");

const COMPONENT_INDEX: Record<string, { category: CatalogCategory; component: CatalogComponent }> = {};
for (const cat of EQUIPMENT_CATALOG)
  for (const comp of cat.components) COMPONENT_INDEX[comp.key] = { category: cat, component: comp };

export function getCategory(key: string): CatalogCategory | undefined {
  return CATALOG_BY_KEY[key];
}

export function getComponent(
  key: string,
): { category: CatalogCategory; component: CatalogComponent } | undefined {
  return COMPONENT_INDEX[key];
}

/** Seed for LocationConfig.categoryMode — every category starts in lump-sum mode. */
export function defaultCategoryMode(): Record<string, "lump"> {
  const out: Record<string, "lump"> = {};
  for (const cat of EQUIPMENT_CATALOG) out[cat.key] = "lump";
  return out;
}

/**
 * Seed for LocationConfig.componentCosts — every BOM component pre-filled with its
 * default $/W, so toggling a category to "Itemized" is non-destructive (the sum
 * equals the lump-sum default).
 */
export function defaultComponentCosts(): Record<string, { value: number; unit: "perW" }> {
  const out: Record<string, { value: number; unit: "perW" }> = {};
  for (const cat of EQUIPMENT_CATALOG)
    for (const comp of cat.components) out[comp.key] = { value: comp.defaultPerW, unit: "perW" };
  return out;
}
