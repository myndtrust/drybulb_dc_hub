// ─────────────────────────────────────────────────────────────────────────────
// Synthetic ("inorganic") demand modeling — build an 8,760-hour demand series
// from a few statistical knobs a freshman can reason about:
//
//   demand[h] = base
//             + diurnalAmp · cos(2π·(hourOfDay − peakHour)/24)
//             + seasonalAmp · cos(2π·(dayOfYear − peakDay)/365)
//             + trend · (h / 8759)
//             + variability      ← from a chosen distribution
//
// Two methods for the variability term:
//   • additive  — smooth, autocorrelated wander (AR(1)); the deterministic
//                 diurnal/seasonal shape dominates.
//   • sampling  — each hour drawn independently from the distribution (spiky).
// All values are clamped to [0, 1] (a fraction of the service's peak demand).
// ─────────────────────────────────────────────────────────────────────────────

import { HOURS } from "./types";
import type { SynthModel } from "./types";
import { dayShape } from "./profile";

// Small, fast, seeded RNG (mulberry32) → reproducible series for a given seed.
function mulberry32(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A zero-mean draw whose typical magnitude is `spread`, by distribution. */
function zeroMeanSample(dist: SynthModel["dist"], spread: number, rng: () => number): number {
  if (spread <= 0) return 0;
  switch (dist) {
    case "uniform":
      return (rng() * 2 - 1) * spread; // U(−spread, +spread)
    case "triangular":
      return (rng() + rng() - 1) * spread; // symmetric triangular
    case "beta": {
      // Bell-ish, slightly skewed: mean of 4 uniforms (Irwin–Hall), centered.
      let s = 0;
      for (let i = 0; i < 4; i++) s += rng();
      return (s / 4 - 0.5) * 2 * spread;
    }
    case "normal":
    default: {
      // Box–Muller; std ≈ spread.
      const u1 = Math.max(1e-9, rng());
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng()) * spread;
    }
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function synthDemand(m: SynthModel): number[] {
  const rng = mulberry32(m.seed);
  const base = m.baseLevelPct / 100;
  const dAmp = m.diurnalAmpPct / 100;
  const sAmp = m.seasonalAmpPct / 100;
  const trend = m.trendPct / 100;
  const spread = m.spreadPct / 100;
  const peakDay = (m.peakMonth - 1) * (365 / 12);

  const out = new Array<number>(HOURS);
  let walk = 0; // AR(1) state for the additive (smooth) method
  const rho = 0.92;

  for (let h = 0; h < HOURS; h++) {
    const hod = h % 24;
    const doy = h / 24;
    // Diurnal term: −amp at the trough hour → +amp at the peak hour (asymmetric).
    const diurnal = dAmp * (2 * dayShape(hod, m.peakHour, m.troughHour) - 1);
    const mean =
      base +
      diurnal +
      sAmp * Math.cos((2 * Math.PI * (doy - peakDay)) / 365) +
      trend * (h / (HOURS - 1));

    let variability: number;
    if (m.method === "additive") {
      // Autocorrelated wander → smooth, organic-looking noise.
      walk = rho * walk + Math.sqrt(1 - rho * rho) * zeroMeanSample(m.dist, 1, rng);
      variability = walk * spread;
    } else {
      // Independent per-hour draw → spiky.
      variability = zeroMeanSample(m.dist, spread, rng);
    }
    out[h] = clamp01(mean + variability);
  }
  return out;
}
