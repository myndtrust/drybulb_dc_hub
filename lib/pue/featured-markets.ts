// Featured data-center markets pinned at the top of the station picker. Matched
// against ingested station name + state (substring, case-insensitive) so we
// don't depend on exact USAF ids. Ingestion sets `dcMarket: true` on matches.

export interface FeaturedMarket {
  label: string;
  state: string;
  /** Name substrings that identify the market's TMY3 station(s). */
  match: string[];
}

export const FEATURED_MARKETS: FeaturedMarket[] = [
  { label: "Northern Virginia (Ashburn)", state: "VA", match: ["Dulles", "Leesburg", "Manassas"] },
  { label: "Silicon Valley", state: "CA", match: ["San Jose", "Moffett", "Sunnyvale", "Mountain View"] },
  { label: "Phoenix", state: "AZ", match: ["Phoenix"] },
  { label: "Dallas–Fort Worth", state: "TX", match: ["Dallas", "Fort Worth", "DFW"] },
  { label: "Chicago", state: "IL", match: ["Chicago", "O'Hare", "Ohare"] },
  { label: "Atlanta", state: "GA", match: ["Atlanta"] },
  { label: "Hillsboro / Portland", state: "OR", match: ["Portland", "Hillsboro"] },
  { label: "Central Washington (Quincy)", state: "WA", match: ["Quincy", "Moses Lake", "Grant Co"] },
  { label: "Omaha / Council Bluffs", state: "NE", match: ["Omaha", "Eppley"] },
  { label: "Salt Lake City", state: "UT", match: ["Salt Lake"] },
  { label: "Denver", state: "CO", match: ["Denver"] },
  { label: "Reno", state: "NV", match: ["Reno"] },
  { label: "Columbus", state: "OH", match: ["Columbus"] },
  { label: "Northern New Jersey", state: "NJ", match: ["Newark"] },
];

/** True if a station name/state matches a featured market. */
export function isFeaturedMarket(name: string, state: string): boolean {
  const n = name.toLowerCase();
  return FEATURED_MARKETS.some(
    (m) =>
      m.state.toLowerCase() === state.toLowerCase() &&
      m.match.some((s) => n.includes(s.toLowerCase())),
  );
}
