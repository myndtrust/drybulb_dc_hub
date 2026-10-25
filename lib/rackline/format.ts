// Display formatting and unit conversion. The model is always metres; the UI
// shows feet or metres per the project setting.

import { FT } from "./constants";
import type { Units } from "./types";

export const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
export const n1 = (v: number) =>
  (Math.round(v * 10) / 10).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const pct = (v: number) => Math.round(v * 100) + "%";

export const toU = (m: number, u: Units) => (u === "ft" ? m / FT : m);
export const fromU = (v: number, u: Units) => (u === "ft" ? v * FT : v);
export const uLbl = (u: Units) => (u === "ft" ? "ft" : "m");
export const fLen = (m: number, u: Units, d?: number) =>
  u === "ft" ? (m / FT).toFixed(d ?? 1) + " ft" : m.toFixed(d ?? 2) + " m";
export const fArea = (m2: number, u: Units) => (u === "ft" ? n0(m2 / (FT * FT)) + " ft²" : n1(m2) + " m²");
export const fTotalLen = (m: number, u: Units) => (u === "ft" ? n0(m / FT) + " ft" : n0(m) + " m");

/** Snap increment: 3 in on imperial projects, 50 mm on metric. */
export const snapStep = (u: Units) => (u === "ft" ? FT / 4 : 0.05);

export const utilTone = (u: number): "bad" | "warn" | "ok" => (u > 1 ? "bad" : u > 0.8 ? "warn" : "ok");

export const fileSafe = (s: string) => s.replace(/[^\w-]+/g, "_");
