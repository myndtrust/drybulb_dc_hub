// ─────────────────────────────────────────────────────────────────────────────
// Entitlements — access tiers for Drybulb tools
//
// Today's policy: any signed-in member gets full access to premium tools (free
// during beta). This module is the single seam to switch on paid enforcement
// later — replace `userTier()` with a lookup of the user's subscription/plan
// (e.g. a Supabase `subscriptions` row) and nothing else has to change.
// ─────────────────────────────────────────────────────────────────────────────

export type Tier = "free" | "members" | "pro";

/** Minimum tier required to use each tool, keyed by its slug. */
export const TOOL_TIER: Record<string, Tier> = {
  "pue-calculator": "free",
  "cost-model": "members",
};

const RANK: Record<Tier, number> = { free: 0, members: 1, pro: 2 };

export function requiredTier(slug: string): Tier {
  return TOOL_TIER[slug] ?? "free";
}

export function isPremium(slug: string): boolean {
  return requiredTier(slug) !== "free";
}

/**
 * The tier granted to the current visitor.
 *
 * Current policy: signed-in ⇒ full access ("pro"); anonymous ⇒ "free".
 * When payments launch, derive this from the user's plan instead of a boolean.
 */
export function userTier(signedIn: boolean): Tier {
  return signedIn ? "pro" : "free";
}

export function hasAccess(slug: string, signedIn: boolean): boolean {
  return RANK[userTier(signedIn)] >= RANK[requiredTier(slug)];
}
