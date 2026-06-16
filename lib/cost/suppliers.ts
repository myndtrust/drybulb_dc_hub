// ─────────────────────────────────────────────────────────────────────────────
// Supplier integration seam (scaffold).
//
// The itemized BOM (data/equipment-catalog.json → lib/cost/catalog.ts) is the set
// of supplier-mappable units. In the future each component can bind to a supplier
// that returns a live price + spec for a specific product. This module defines the
// interfaces and a no-op resolver so the UI can wire a "Source" affordance now;
// getItemQuote() returns null today, so the model falls back to catalog defaults.
// ─────────────────────────────────────────────────────────────────────────────

import type { CatalogProduct } from "./catalog";
import type { CostUnit } from "./types";

export interface QuoteContext {
  /** Built nameplate IT power, in watts — lets a provider price $/W vs $ total. */
  capacityW: number;
  /** Optional region hint for freight / tariff / lead-time adjustments. */
  region?: string;
}

export interface SupplierQuote {
  price: number;
  unit: CostUnit;
  currency: string; // e.g. "USD"
  leadTimeWeeks?: number;
  product?: CatalogProduct;
  source: string; // provider id / attribution
  retrievedAt?: string;
}

/** Binds a BOM component to a chosen supplier product. */
export interface SupplierBinding {
  componentKey: string;
  vendor: string;
  productId?: string;
}

export interface SupplierProvider {
  id: string;
  label: string;
  getQuote(binding: SupplierBinding, ctx: QuoteContext): Promise<SupplierQuote | null>;
}

/** Registered providers — empty until an integration is wired. */
export const SUPPLIER_PROVIDERS: SupplierProvider[] = [];

/**
 * Resolve a price for a component from a supplier. No provider is wired yet, so
 * this always returns null and the model uses the catalog default for the line.
 */
export async function getItemQuote(
  _componentKey: string,
  _ctx: QuoteContext,
): Promise<SupplierQuote | null> {
  return null;
}
