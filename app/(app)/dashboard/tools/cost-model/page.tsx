"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  categoryPerW,
  computePortfolio,
  fmtPerMWh,
  fmtPerW,
  fmtUSD,
  type CapexSegment,
  type CostResult,
} from "@/lib/cost/model";
import {
  DEFAULT_INPUTS,
  DEFAULT_POWER_CAPEX,
  FACILITY_LINE_ITEMS,
  LOCATION_COLORS,
  makeBlankService,
  makeLocation,
  powerLineLabel,
  SOURCE_NOTES,
  type CategoryMode,
  type ComponentCost,
  type CostInputs,
  type CostUnit,
  type LocationConfig,
  type PowerSource,
  type PriceMode,
} from "@/lib/cost/types";
import {
  getCategory,
  getComponent,
  type CatalogComponent,
  type CatalogProduct,
} from "@/lib/cost/catalog";
import type {
  DemandSource,
  Distribution,
  ProfileShape,
  ServiceChannel,
  SynthMethod,
  SynthModel,
} from "@/lib/energy/types";
import {
  demandToCSV,
  generateProfile,
  loadDurationCurve,
  parseDemandCSV,
} from "@/lib/energy/profile";
import { synthDemand } from "@/lib/energy/stochastic";
import { COOLING_SYSTEMS } from "@/lib/pue/equipment-defaults";
import { fetchStationIndex, fetchStationWeather } from "@/lib/pue/tmy3";
import { LocationSelect } from "@/components/pue/location-select";
import type { CoolingType, HourlyWeather, TmyStation } from "@/lib/pue/types";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { PremiumGate } from "@/components/app/premium-gate";

// Hex palette for canvas charts (services + locations).
const SERVICE_COLORS = [
  "#0d9488", "#2563eb", "#d97706", "#7c3aed",
  "#0891b2", "#db2777", "#475569", "#16a34a",
];

// ─────────────────────────────────────────────────────────────────────────────
// Inputs
// ─────────────────────────────────────────────────────────────────────────────

function SliderInput({
  label, value, onChange, min, max, step, display, hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; display: string; hint?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{display}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="cm-range w-full"
        style={{ background: `linear-gradient(90deg, var(--primary) ${pct}%, var(--secondary) ${pct}%)` }}
      />
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumberInput({
  label, value, onChange, min, step, unit, hint,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; step?: number; unit?: string; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number" value={value} min={min} step={step ?? 1}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {unit && <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>}
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Toggle<T extends string>({
  value, onChange, options,
}: {
  value: T; onChange: (v: T) => void; options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex w-full rounded-md bg-muted p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.key}
          className={`flex-1 rounded-[6px] px-3 py-1.5 transition-colors ${
            value === o.key
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SelectInput<T extends string>({
  label, value, onChange, options,
}: {
  label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      <select
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function FieldNote({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-xs text-muted-foreground">{children}</p>;
}

const SHAPE_NOTES: Record<ProfileShape, string> = {
  flat: "Steady at peak demand all year.",
  diurnal: "Daily cycle, lowest pre-dawn.",
  business: "Peak on weekday business hours.",
  ramp: "Linear fill from min to peak over the year.",
};

const FACILITY_HINTS: Record<string, string> = {
  labor: "On-site construction labor.",
  materials: "Concrete, steel, structure.",
  tenantFitout: "Interior build-out of the IT space.",
  electrical: "Switchgear, UPS, distribution.",
  mechanical: "Cooling plant, CDUs, pumps.",
  softCosts: "Design, permitting, fees, financing.",
};

// ─────────────────────────────────────────────────────────────────────────────
// Itemized BOM (per-category capex) + products pop-up
// ─────────────────────────────────────────────────────────────────────────────

const UNIT_OPTS: { value: CostUnit; label: string }[] = [
  { value: "perW", label: "$/W" },
  { value: "perMW", label: "$/MW" },
  { value: "total", label: "$ total" },
];

function ConfidenceBadge({ confidence }: { confidence?: "sourced" | "estimate" }) {
  const sourced = confidence === "sourced";
  return (
    <span
      className={`rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ${
        sourced
          ? "border border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
          : "border bg-secondary text-muted-foreground"
      }`}
    >
      {sourced ? "sourced" : "estimate"}
    </span>
  );
}

/** One BOM line: name + value + unit select, then confidence / lead / ref / products. */
function BomRow({
  comp, cost, onChange, onProducts,
}: {
  comp: CatalogComponent;
  cost: ComponentCost;
  onChange: (c: ComponentCost) => void;
  onProducts: () => void;
}) {
  const lead = comp.leadTimeWeeks
    ? `⏱ ${comp.leadTimeWeeks} wk`
    : comp.leadTimeMonths
      ? `⏱ ${comp.leadTimeMonths} mo`
      : null;
  return (
    <div className="space-y-1.5 border-b pb-2 last:border-b-0 last:pb-0">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <span className="text-[12.5px] font-medium">{comp.label}</span>
        <input
          type="number" value={cost.value} step={0.01} min={0}
          onChange={(e) => onChange({ ...cost, value: parseFloat(e.target.value) || 0 })}
          className="w-[72px] rounded-md border border-input bg-background px-2 py-1 text-right font-mono text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <select
          value={cost.unit}
          onChange={(e) => onChange({ ...cost, unit: e.target.value as CostUnit })}
          className="rounded-md border border-input bg-background px-1.5 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {UNIT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <ConfidenceBadge confidence={comp.confidence} />
        {lead && <span className="text-orange-700 dark:text-orange-400">{lead}</span>}
        {comp.priceRef && <span>ref ≈ {comp.priceRef}</span>}
        {comp.products.length > 0 && (
          <button
            onClick={onProducts}
            className="ml-auto rounded-md border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            ⊞ Products ({comp.products.length})
          </button>
        )}
      </div>
    </div>
  );
}

/** Compact per-category segmented toggle: Lump sum | Itemized. */
function ModeSeg({ mode, onChange }: { mode: CategoryMode; onChange: (m: CategoryMode) => void }) {
  return (
    <div className="inline-flex rounded-md bg-muted p-0.5 text-[11px]">
      {([["lump", "Lump sum"], ["itemized", "Itemized"]] as const).map(([k, l]) => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`rounded-[5px] px-2.5 py-1 transition-colors ${
            mode === k
              ? "bg-background font-semibold text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

/** A single capex category: lump-sum slider OR itemized BOM, with its own toggle. */
function CategoryCapex({
  loc, catKey, label, hint, min, max, step, lumpValue,
  onLump, onMode, onComponent, onProducts,
}: {
  loc: LocationConfig;
  catKey: string;
  label: string;
  hint?: string;
  min: number; max: number; step: number;
  lumpValue: number;
  onLump: (v: number) => void;
  onMode: (m: CategoryMode) => void;
  onComponent: (compKey: string, c: ComponentCost) => void;
  onProducts: (compKey: string) => void;
}) {
  const cat = getCategory(catKey);
  const mode: CategoryMode = loc.categoryMode?.[catKey] ?? "lump";
  const capacityW = loc.capacityMW * 1e6;
  const itemized = mode === "itemized" && !!cat;
  const effective = categoryPerW(loc, catKey, capacityW);

  return (
    <div className="space-y-2">
      {itemized ? (
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              {label}
              <span className="rounded border border-orange-300 bg-orange-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-800 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-300">
                itemized
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {fmtPerW(effective)} <span className="text-muted-foreground/60">sum</span>
            </span>
          </div>
          <div className="rounded-lg border bg-muted/40 p-3">
            <div className="mb-2 flex items-baseline justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
              <span>Bill of materials</span><span>$/W · unit · products</span>
            </div>
            <div className="space-y-2">
              {(cat?.components ?? []).map((comp) => {
                const cost: ComponentCost =
                  loc.componentCosts?.[comp.key] ?? { value: comp.defaultPerW, unit: "perW" };
                return (
                  <BomRow
                    key={comp.key} comp={comp} cost={cost}
                    onChange={(c) => onComponent(comp.key, c)}
                    onProducts={() => onProducts(comp.key)}
                  />
                );
              })}
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t pt-2 text-[12.5px] font-semibold">
              <span>Category total</span>
              <span className="font-mono tabular-nums">{fmtPerW(effective)}</span>
            </div>
          </div>
        </div>
      ) : (
        <SliderInput
          label={label} value={lumpValue} onChange={onLump}
          min={min} max={max} step={step} display={fmtPerW(lumpValue)} hint={hint}
        />
      )}
      {cat && <ModeSeg mode={mode} onChange={onMode} />}
    </div>
  );
}

/** Pop-up listing alternative products for a BOM component, with literature links. */
function ProductsModal({ componentKey, onClose }: { componentKey: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const entry = getComponent(componentKey);
  if (!entry) return null;
  const { category, component } = entry;

  // Future: outbound click / ad-referral tracking hook.
  const trackOutbound = (p: CatalogProduct) => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("outbound-click", { product: `${p.vendor} ${p.model}`, href: p.url });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-5" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-auto rounded-xl border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <div className="text-[15px] font-semibold">{component.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{category.label} · alternative products</div>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-muted-foreground transition-colors hover:text-foreground">×</button>
        </div>
        <div className="px-5 py-1">
          {component.products.map((p, i) => (
            <div key={i} className="flex items-start justify-between gap-3 border-b py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{p.vendor}</div>
                <div className="text-sm font-semibold">{p.model}</div>
                {p.spec && <div className="mt-0.5 text-xs text-muted-foreground">{p.spec}</div>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {p.price && <span className="font-mono text-xs tabular-nums">{p.price}</span>}
                <a
                  href={p.url} target="_blank" rel="noopener noreferrer"
                  data-track="outbound" data-product={`${p.vendor} ${p.model}`}
                  onClick={() => trackOutbound(p)}
                  className="rounded-md border bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
                >
                  Literature ↗
                </a>
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pb-4 pt-1 text-[11px] text-muted-foreground">
          Prices are planning-grade references; confidence varies by line. Links open vendor product literature.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Result primitives
// ─────────────────────────────────────────────────────────────────────────────

function Stat({
  label, value, unit, sub, accent,
}: {
  label: string; value: string; unit?: string; sub?: string; accent?: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      {accent && <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />}
      <CardContent className="py-4">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="font-mono text-2xl font-bold tabular-nums tracking-tight">
          {value}{unit && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>}
        </div>
        {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${strong ? "font-semibold" : ""}`}>{value}</span>
    </div>
  );
}

function CapexBreakdown({ segments, total }: { segments: CapexSegment[]; total: number }) {
  return (
    <div className="space-y-4">
      <div className="flex h-8 gap-px overflow-hidden rounded-md bg-border">
        {segments.map((s) => (
          <div key={s.key} className={`${s.color} h-full`} style={{ width: `${(s.amount / total) * 100}%` }}
            title={`${s.label}: ${fmtUSD(s.amount)}`} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-x-7 gap-y-1.5 text-sm sm:grid-cols-2">
        {[...segments].sort((a, b) => b.amount - a.amount).map((s) => (
          <div key={s.key} className="flex items-baseline justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${s.color}`} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">
              {fmtUSD(s.amount)}<span className="ml-1 text-muted-foreground/70">{((s.amount / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between border-t pt-2 font-semibold sm:col-span-2">
          <span>Total upfront capex</span><span className="font-mono tabular-nums">{fmtUSD(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas charts
// ─────────────────────────────────────────────────────────────────────────────

function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.getBoundingClientRect().width;
    const h = parseInt(canvas.dataset.h || "240", 10);
    canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h); draw(ctx, w, h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function watermark(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.font = "11px ui-monospace, monospace";
  ctx.fillStyle = "rgba(120,120,120,0.35)";
  ctx.textAlign = "right";
  ctx.fillText("drybulb.com", w - 8, h - 7);
  ctx.restore();
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name)?.trim() || fallback;
}

const GRID = "rgba(130,130,130,0.14)";
const AXIS = "rgba(130,130,130,0.85)";

const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type ChartGeom = { padL: number; padR: number; padT: number; padB: number; plotW: number; plotH: number; w: number; h: number };

/** Adaptive x-axis label for an hour-of-year index, by the zoom window span (h). */
function hourLabel(i: number, span: number): string {
  const d = new Date(Date.UTC(2001, 0, 1) + i * 3600000); // 2001 is non-leap
  const mon = MONTHS3[d.getUTCMonth()];
  if (span >= 24 * 45) return mon;
  if (span >= 24 * 3) return `${mon} ${d.getUTCDate()}`;
  return `${mon} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}h`;
}

function drawTimeAxis(ctx: CanvasRenderingContext2D, g: ChartGeom, win: [number, number]) {
  const span = win[1] - win[0];
  ctx.fillStyle = AXIS; ctx.textAlign = "center"; ctx.font = "10px ui-monospace, monospace";
  for (let k = 0; k <= 6; k++) {
    const i = win[0] + (span * k) / 6;
    ctx.fillText(hourLabel(i, span), g.padL + (g.plotW * k) / 6, g.padT + g.plotH + 14);
  }
}

/** A canvas time-series with drag-to-zoom (select a horizontal range) + double-click reset. */
function ZoomableChart({
  length,
  height = 180,
  padL = 46,
  draw,
}: {
  length: number;
  height?: number;
  padL?: number;
  draw: (ctx: CanvasRenderingContext2D, g: ChartGeom, win: [number, number]) => void;
}) {
  const padR = 10, padT = 10, padB = 22;
  const [win, setWin] = useState<[number, number]>([0, length]);
  const [selPx, setSelPx] = useState<[number, number] | null>(null);
  const dragStart = useRef<number | null>(null);

  useEffect(() => { setWin([0, length]); }, [length]);

  const ref = useCanvas((ctx, w, h) => {
    const plotW = w - padL - padR, plotH = h - padT - padB;
    draw(ctx, { padL, padR, padT, padB, plotW, plotH, w, h }, win);
    if (selPx) {
      ctx.fillStyle = "rgba(90,120,200,0.18)";
      ctx.fillRect(Math.min(selPx[0], selPx[1]), padT, Math.abs(selPx[1] - selPx[0]), plotH);
    }
  }, [win, selPx, length, draw]);

  const at = (clientX: number) => {
    const el = ref.current;
    const rect = el ? el.getBoundingClientRect() : ({ left: 0, width: 0 } as DOMRect);
    const relX = clientX - rect.left;
    const plotW = rect.width - padL - padR;
    const fx = Math.max(0, Math.min(1, (relX - padL) / (plotW || 1)));
    return { relX, idx: win[0] + fx * (win[1] - win[0]) };
  };
  const zoomedIn = win[0] > 0 || win[1] < length;

  return (
    <div className="space-y-1">
      <canvas
        ref={ref}
        data-h={`${height}`}
        className="w-full cursor-crosshair select-none"
        onMouseDown={(e) => { const p = at(e.clientX); dragStart.current = p.idx; setSelPx([p.relX, p.relX]); }}
        onMouseMove={(e) => { if (dragStart.current != null) { const p = at(e.clientX); setSelPx((s) => (s ? [s[0], p.relX] : null)); } }}
        onMouseUp={(e) => {
          if (dragStart.current != null) {
            const a = dragStart.current, b = at(e.clientX).idx;
            const lo = Math.max(0, Math.min(a, b)), hi = Math.min(length, Math.max(a, b));
            if (hi - lo > 6) setWin([lo, hi]);
          }
          dragStart.current = null; setSelPx(null);
        }}
        onMouseLeave={() => { dragStart.current = null; setSelPx(null); }}
        onDoubleClick={() => setWin([0, length])}
      />
      <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground/70">
        <span>drag to zoom{zoomedIn ? " · double-click to reset" : ""}</span>
        {zoomedIn && (
          <button
            onClick={() => setWin([0, length])}
            className="rounded border px-2 py-0.5 font-medium text-foreground transition-colors hover:bg-muted"
          >
            Reset to full year
          </button>
        )}
      </div>
    </div>
  );
}

/** Stacked service-demand chart over the whole year (MW). */
function ServiceDemandChart({ services }: { services: ServiceChannel[] }) {
  const WIN = 8760;
  const series = useMemo(
    () =>
      services.map((s) => {
        const arr = new Array<number>(WIN);
        for (let h = 0; h < WIN; h++) arr[h] = s.peakDemandMW * (s.demand[h] ?? 0);
        return arr;
      }),
    [services],
  );
  const totalMax = useMemo(() => {
    let m = 0;
    for (let h = 0; h < WIN; h++) { let s = 0; for (const ser of series) s += ser[h]; if (s > m) m = s; }
    return m || 1;
  }, [series]);

  const draw = useCallback((ctx: CanvasRenderingContext2D, g: ChartGeom, win: [number, number]) => {
    const i0 = Math.max(0, Math.floor(win[0])), i1 = Math.min(WIN - 1, Math.ceil(win[1]));
    const top = totalMax * 1.06;
    const xOf = (i: number) => g.padL + (g.plotW * (i - win[0])) / (win[1] - win[0]);
    const yOf = (v: number) => g.padT + g.plotH * (1 - v / top);

    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.fillStyle = AXIS;
    for (let k = 0; k <= 2; k++) {
      const val = (top * k) / 2, y = yOf(val);
      ctx.fillText(val.toFixed(0), g.padL - 6, y + 3);
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(g.padL, y); ctx.lineTo(g.padL + g.plotW, y); ctx.stroke();
    }

    const lower = new Array<number>(WIN).fill(0);
    series.forEach((ser, si) => {
      const color = SERVICE_COLORS[si % SERVICE_COLORS.length];
      ctx.beginPath();
      ctx.moveTo(xOf(i0), yOf(lower[i0]));
      for (let i = i0; i <= i1; i++) ctx.lineTo(xOf(i), yOf(lower[i] + ser[i]));
      for (let i = i1; i >= i0; i--) ctx.lineTo(xOf(i), yOf(lower[i]));
      ctx.closePath();
      ctx.fillStyle = color + "cc"; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) { const x = xOf(i), y = yOf(lower[i] + ser[i]); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
      for (let i = i0; i <= i1; i++) lower[i] += ser[i];
    });

    drawTimeAxis(ctx, g, win);
    watermark(ctx, g.w, g.h);
  }, [series, totalMax]);

  return <ZoomableChart length={WIN} height={180} padL={46} draw={draw} />;
}

/** Load-duration of the facility energy vector (MW). */
function EnergyVectorChart({ facilityMW, height = 240 }: { facilityMW: number[]; height?: number }) {
  const curve = useMemo(() => loadDurationCurve(facilityMW), [facilityMW]);
  const maxV = curve.length ? curve[0] : 1;
  const ref = useCanvas((ctx, w, h) => {
    const padL = 50, padR = 10, padT = 10, padB = 22;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const top = maxV > 0 ? maxV : 1;
    const accent = cssVar("--primary", "#1a1a1a");
    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.fillStyle = AXIS;
    for (let k = 0; k <= 4; k++) {
      const y = padT + plotH * (1 - k / 4);
      ctx.fillText(((top * k) / 4).toFixed(0), padL - 6, y + 3);
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
    }
    const n = curve.length;
    ctx.beginPath(); ctx.moveTo(padL, padT + plotH);
    for (let i = 0; i < n; i++) ctx.lineTo(padL + (plotW * i) / (n - 1), padT + plotH * (1 - curve[i] / top));
    ctx.lineTo(padL + plotW, padT + plotH); ctx.closePath();
    ctx.fillStyle = "rgba(120,120,120,0.14)"; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const x = padL + (plotW * i) / (n - 1), y = padT + plotH * (1 - curve[i] / top); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = AXIS; ctx.textAlign = "center";
    [0, 2190, 4380, 6570, 8760].forEach((hr) => ctx.fillText(`${(hr / 1000).toFixed(hr === 0 ? 0 : 1)}k`, padL + (plotW * hr) / 8760, padT + plotH + 15));
    watermark(ctx, w, h);
  }, [curve, maxV, height]);
  return <canvas ref={ref} data-h={`${height}`} className="w-full" />;
}

function CashFlowChart({ cashFlow, payback }: { cashFlow: CostResult["cashFlow"]; payback: number | null }) {
  const ref = useCanvas((ctx, w, h) => {
    const padL = 58, padR = 10, padT = 10, padB = 22;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const vals = cashFlow.map((p) => p.cumulative);
    const maxV = Math.max(0, ...vals), minV = Math.min(0, ...vals), range = maxV - minV || 1;
    const yOf = (v: number) => padT + plotH * (1 - (v - minV) / range);
    const xOf = (yr: number) => padL + (plotW * yr) / Math.max(1, cashFlow.length - 1);
    const zeroY = yOf(0);
    ctx.strokeStyle = "rgba(130,130,130,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(padL + plotW, zeroY); ctx.stroke();
    const barW = Math.min(32, (plotW / cashFlow.length) * 0.5);
    cashFlow.forEach((p) => {
      const x = xOf(p.year), y = yOf(p.cumulative);
      ctx.fillStyle = p.cumulative >= 0 ? "rgba(22,120,70,0.55)" : "rgba(204,51,51,0.5)";
      ctx.fillRect(x - barW / 2, Math.min(y, zeroY), barW, Math.abs(y - zeroY));
    });
    ctx.beginPath();
    cashFlow.forEach((p, i) => { const x = xOf(p.year), y = yOf(p.cumulative); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
    ctx.strokeStyle = cssVar("--primary", "#1a1a1a"); ctx.lineWidth = 2; ctx.stroke();
    ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = AXIS; ctx.textAlign = "right";
    [minV, (minV + maxV) / 2, maxV].forEach((v) => ctx.fillText(fmtUSD(v), padL - 6, yOf(v) + 3));
    ctx.textAlign = "center";
    cashFlow.forEach((p) => ctx.fillText(`Y${p.year}`, xOf(p.year), padT + plotH + 15));
    if (payback != null) {
      const x = xOf(payback);
      ctx.strokeStyle = "rgba(204,51,51,0.9)"; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(204,51,51,1)"; ctx.textAlign = "left";
      ctx.fillText(`payback ${payback.toFixed(1)}y`, Math.min(x + 4, w - 72), padT + 10);
    }
    watermark(ctx, w, h);
  }, [cashFlow, payback]);
  return <canvas ref={ref} data-h="240" className="w-full" />;
}

/** Chronological 8,760-hour dry-bulb temperature for a city (x = hour of year). */
function WeatherTempChart({ tdb, unit }: { tdb: number[]; unit: "C" | "F" }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, g: ChartGeom, win: [number, number]) => {
    const conv = (c: number) => (unit === "F" ? c * 1.8 + 32 : c);
    const i0 = Math.max(0, Math.floor(win[0])), i1 = Math.min(tdb.length - 1, Math.ceil(win[1]));
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i <= i1; i++) { const t = conv(tdb[i]); if (t < lo) lo = t; if (t > hi) hi = t; }
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const range = hi - lo || 1;
    const yOf = (t: number) => g.padT + g.plotH * (1 - (t - lo) / range);
    const xOf = (i: number) => g.padL + (g.plotW * (i - win[0])) / (win[1] - win[0]);
    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.fillStyle = AXIS;
    for (let k = 0; k <= 4; k++) {
      const t = lo + (range * k) / 4, y = g.padT + g.plotH * (1 - k / 4);
      ctx.fillText(`${t.toFixed(0)}°`, g.padL - 6, y + 3);
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(g.padL, y); ctx.lineTo(g.padL + g.plotW, y); ctx.stroke();
    }
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) { const x = xOf(i), y = yOf(conv(tdb[i])); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = cssVar("--primary", "#1a1a1a"); ctx.lineWidth = 1; ctx.stroke();
    drawTimeAxis(ctx, g, win);
    watermark(ctx, g.w, g.h);
  }, [tdb, unit]);
  return <ZoomableChart length={tdb.length} height={180} padL={44} draw={draw} />;
}

/** Histogram of the 8,760 demand values (0–1) — the distribution made visible. */
function HistogramChart({ values, bins = 24 }: { values: number[]; bins?: number }) {
  const counts = useMemo(() => {
    const c = new Array<number>(bins).fill(0);
    for (const v of values) c[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
    return c;
  }, [values, bins]);
  const ref = useCanvas((ctx, w, h) => {
    const padL = 10, padR = 10, padT = 10, padB = 18;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    const max = Math.max(1, ...counts);
    const bw = plotW / bins;
    ctx.fillStyle = cssVar("--primary", "#1a1a1a");
    counts.forEach((c, i) => { const bh = plotH * (c / max); ctx.fillRect(padL + i * bw + 1, padT + plotH - bh, Math.max(1, bw - 2), bh); });
    ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = AXIS; ctx.textAlign = "center";
    ["0", "0.5", "1.0"].forEach((lbl, i) => ctx.fillText(lbl, padL + plotW * (i / 2), padT + plotH + 13));
    watermark(ctx, w, h);
  }, [counts]);
  return <canvas ref={ref} data-h="140" className="w-full" />;
}

/** Chronological 8,760-hour demand of one service (MW). */
function DemandYearChart({ demand, peakMW }: { demand: number[]; peakMW: number }) {
  const draw = useCallback((ctx: CanvasRenderingContext2D, g: ChartGeom, win: [number, number]) => {
    const i0 = Math.max(0, Math.floor(win[0])), i1 = Math.min(demand.length - 1, Math.ceil(win[1]));
    const top = peakMW > 0 ? peakMW : 1;
    const xOf = (i: number) => g.padL + (g.plotW * (i - win[0])) / (win[1] - win[0]);
    const yOf = (frac: number) => g.padT + g.plotH * (1 - frac);
    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.fillStyle = AXIS;
    for (let k = 0; k <= 4; k++) {
      const y = g.padT + g.plotH * (1 - k / 4);
      ctx.fillText(((top * k) / 4).toFixed(0), g.padL - 6, y + 3);
      ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(g.padL, y); ctx.lineTo(g.padL + g.plotW, y); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(xOf(i0), g.padT + g.plotH);
    for (let i = i0; i <= i1; i++) ctx.lineTo(xOf(i), yOf(demand[i] ?? 0));
    ctx.lineTo(xOf(i1), g.padT + g.plotH); ctx.closePath();
    ctx.fillStyle = "rgba(120,120,120,0.14)"; ctx.fill();
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) { const x = xOf(i), y = yOf(demand[i] ?? 0); i === i0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
    ctx.strokeStyle = cssVar("--primary", "#1a1a1a"); ctx.lineWidth = 1.2; ctx.stroke();
    drawTimeAxis(ctx, g, win);
    watermark(ctx, g.w, g.h);
  }, [demand, peakMW]);
  return <ZoomableChart length={demand.length} height={200} padL={50} draw={draw} />;
}

function ModeToggle() {
  return (
    <div className="inline-flex rounded-md border text-xs">
      <span className="rounded-l-md bg-primary px-3 py-1.5 text-primary-foreground">Terrestrial</span>
      <span className="flex items-center gap-1.5 rounded-r-md px-3 py-1.5 text-muted-foreground">
        Orbital comparison
        <span className="rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">Soon</span>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function CostModelPage() {
  return (
    <PremiumGate slug="cost-model" toolTitle="Data Center Cost Model">
      <CostModelTool />
    </PremiumGate>
  );
}

function CostModelTool() {
  const [inputs, setInputs] = useState<CostInputs>(DEFAULT_INPUTS);
  const [activeId, setActiveId] = useState<string>(DEFAULT_INPUTS.locations[0].id);
  const [activeTab, setActiveTab] = useState<"capex" | "scheduler" | "returns" | "energy" | "notes">("capex");
  const [signedIn, setSignedIn] = useState(false);
  const [schedServiceId, setSchedServiceId] = useState<string | null>(null);
  const [schedWeek, setSchedWeek] = useState(0); // 0..51
  const [tempUnit, setTempUnit] = useState<"C" | "F">("F");
  const [productsKey, setProductsKey] = useState<string | null>(null);

  const [stations, setStations] = useState<TmyStation[]>([]);
  const [weatherMap, setWeatherMap] = useState<Map<string, HourlyWeather | null>>(new Map());

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSignedIn(Boolean(s)));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => { fetchStationIndex().then(setStations).catch(() => {}); }, []);

  const stationIds = useMemo(
    () => Array.from(new Set(inputs.locations.map((l) => l.stationId).filter(Boolean))) as string[],
    [inputs.locations],
  );
  const stationKey = stationIds.join(",");

  useEffect(() => {
    if (!stationIds.length || !stations.length) return;
    let cancelled = false;
    Promise.all(
      stationIds.map(async (id) => {
        const st = stations.find((s) => s.usaf === id);
        if (!st) return [id, null] as const;
        try { const { hourly } = await fetchStationWeather(st); return [id, hourly] as const; }
        catch { return [id, null] as const; }
      }),
    ).then((entries) => { if (!cancelled) setWeatherMap(new Map(entries)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationKey, stations]);

  const portfolio = useMemo(() => computePortfolio(inputs, weatherMap), [inputs, weatherMap]);

  const isTotal = activeId === "total";
  const activeLoc = inputs.locations.find((l) => l.id === activeId) ?? null;
  const activeResult = portfolio.perLocation.find((p) => p.id === activeId)?.result;
  const station = activeLoc?.stationId ? stations.find((s) => s.usaf === activeLoc.stationId) : undefined;
  const activeWeather = activeLoc?.stationId ? weatherMap.get(activeLoc.stationId) ?? null : null;

  // — Location mutations —
  const patchLoc = (id: string, patch: Partial<LocationConfig>) =>
    setInputs((prev) => ({ locations: prev.locations.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const upd = (patch: Partial<LocationConfig>) => activeLoc && patchLoc(activeLoc.id, patch);
  const updFacility = (key: keyof LocationConfig["facility"], v: number) =>
    activeLoc && patchLoc(activeLoc.id, { facility: { ...activeLoc.facility, [key]: v } });
  const updAI = (key: keyof LocationConfig["ai"], v: number) =>
    activeLoc && patchLoc(activeLoc.id, { ai: { ...activeLoc.ai, [key]: v } });
  const updCooling = (patch: Partial<LocationConfig["cooling"]>) =>
    activeLoc && patchLoc(activeLoc.id, { cooling: { ...activeLoc.cooling, ...patch } });
  const setPowerSource = (src: PowerSource) =>
    activeLoc && patchLoc(activeLoc.id, { powerSource: src, facility: { ...activeLoc.facility, power: DEFAULT_POWER_CAPEX[src] } });
  const setCategoryMode = (catKey: string, mode: CategoryMode) =>
    activeLoc && patchLoc(activeLoc.id, { categoryMode: { ...(activeLoc.categoryMode ?? {}), [catKey]: mode } });
  const setComponentCost = (compKey: string, c: ComponentCost) =>
    activeLoc && patchLoc(activeLoc.id, { componentCosts: { ...(activeLoc.componentCosts ?? {}), [compKey]: c } });

  const addLocation = () => {
    const loc = makeLocation(`Site ${inputs.locations.length + 1}`);
    setInputs((prev) => ({ locations: [...prev.locations, loc] }));
    setActiveId(loc.id);
  };
  const removeLocation = (id: string) => {
    if (inputs.locations.length <= 1) return;
    const remaining = inputs.locations.filter((l) => l.id !== id);
    setInputs({ locations: remaining });
    if (activeId === id) setActiveId(remaining[0].id);
  };

  // — Service mutations (active location) —
  const patchService = (sid: string, patch: Partial<ServiceChannel>) =>
    activeLoc && patchLoc(activeLoc.id, { services: activeLoc.services.map((s) => (s.id === sid ? { ...s, ...patch } : s)) });
  const addService = () =>
    activeLoc && patchLoc(activeLoc.id, { services: [...activeLoc.services, makeBlankService()] });
  const removeService = (sid: string) =>
    activeLoc && patchLoc(activeLoc.id, { services: activeLoc.services.filter((s) => s.id !== sid) });

  // — Scheduler (per-service 8,760-h demand) —
  const regenPreset = (sid: string, profile: ServiceChannel["profile"]) =>
    patchService(sid, { profile, demand: generateProfile(profile), demandSource: "preset" });
  const regenModel = (sid: string, model: SynthModel) =>
    patchService(sid, { model, demand: synthDemand(model), demandSource: "model" });
  const setDemandSource = (s: ServiceChannel, src: DemandSource) => {
    if (src === "preset") patchService(s.id, { demandSource: "preset", demand: generateProfile(s.profile) });
    else if (src === "model") patchService(s.id, { demandSource: "model", demand: synthDemand(s.model) });
    else patchService(s.id, { demandSource: "custom" }); // keep current demand; await CSV
  };
  const setDemandHour = (sid: string, hour: number, frac: number) => {
    const s = activeLoc?.services.find((x) => x.id === sid);
    if (!s) return;
    const next = s.demand.slice();
    next[hour] = Math.max(0, Math.min(1, frac));
    patchService(sid, { demand: next });
  };
  async function importDemandCSV(sid: string, file: File) {
    try { patchService(sid, { demand: parseDemandCSV(await file.text()), demandSource: "custom" }); } catch { /* ignore */ }
  }
  function exportDemandCSV(s: ServiceChannel) {
    const blob = new Blob([demandToCSV(s.demand)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${s.label.replace(/\s+/g, "-").toLowerCase()}-demand-8760.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const sectionCard = "rounded-xl border bg-card";
  const cardHd = "px-4 pt-4 pb-2";
  const cardBd = "px-4 pb-4 space-y-4";

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <nav className="mb-7 flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Link href="/tools" className="transition-colors hover:text-foreground">Tools</Link>
        <span>/</span><span className="text-foreground/60">Data Center Cost Model</span>
      </nav>

      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <h1 className="mb-1.5 text-3xl font-bold tracking-tight">Data Center Cost Model</h1>
          <p className="max-w-2xl text-muted-foreground">
            Build a portfolio of locations — each with its own services, energy profile, build cost and
            returns — then roll them up into a total view. Planning-grade; tune every assumption.
          </p>
        </div>
        <div className="shrink-0"><ModeToggle /></div>
      </div>

      {/* LOCATION TABS */}
      <div className="mb-6 flex flex-wrap items-center gap-1 border-b">
        {inputs.locations.map((loc) => (
          <button
            key={loc.id}
            onClick={() => setActiveId(loc.id)}
            className={`group relative -mb-px flex items-center gap-2 rounded-t-md px-3.5 py-2 text-sm transition-colors ${
              activeId === loc.id ? "bg-card font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {loc.name}
            {inputs.locations.length > 1 && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); removeLocation(loc.id); }}
                className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              >×</span>
            )}
            {activeId === loc.id && <span className="absolute inset-x-2.5 -bottom-px h-0.5 rounded bg-primary" />}
          </button>
        ))}
        <button onClick={addLocation}
          className="ml-1 rounded-md border border-dashed px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-ring hover:text-foreground">
          + Add location
        </button>
        <button onClick={() => setActiveId("total")}
          className={`ml-auto rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            isTotal ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-muted"
          }`}>
          Σ Total
        </button>
      </div>

      {/* ───────────── TOTAL VIEW ───────────── */}
      {isTotal ? (
        <TotalView portfolio={portfolio} locations={inputs.locations} />
      ) : activeLoc && activeResult ? (
        /* ───────────── ACTIVE LOCATION ───────────── */
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[380px_1fr]">
          {/* LEFT: Location → Energy → Services */}
          <div className="space-y-4">
            {/* Location */}
            <div className={sectionCard}>
              <div className={cardHd}>
                <div className="text-[15px] font-semibold">Location</div>
                <div className="mt-1 text-xs text-muted-foreground">A city&apos;s TMY3 weather drives the hourly PUE &amp; energy vector</div>
              </div>
              <div className={cardBd}>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Name</label>
                  <input value={activeLoc.name} onChange={(e) => upd({ name: e.target.value })}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                {stations.length > 0 ? (
                  <>
                    <LocationSelect value={activeLoc.stationId ?? ""} onChange={(id) => upd({ stationId: id })} stations={stations} />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums">
                        {activeResult.weatherCoupled ? `weather · avg PUE ${activeResult.avgPue.toFixed(3)}` : "flat PUE"}
                      </span>
                      {activeLoc.stationId && (
                        <button className="underline transition-colors hover:text-foreground" onClick={() => upd({ stationId: null })}>use flat PUE</button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Weather data unavailable here — the flat PUE applies.</p>
                )}
                {!activeLoc.stationId && (
                  <SliderInput label="Flat PUE" value={activeLoc.pue} onChange={(v) => upd({ pue: v })}
                    min={1.05} max={1.6} step={0.01} display={activeLoc.pue.toFixed(2)} hint="Used when no city is selected." />
                )}
              </div>
            </div>

            {/* Weather time series (drives PUE & energy) */}
            <div className={sectionCard}>
              <div className={cardHd}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[15px] font-semibold">Weather — dry-bulb</div>
                  <div className="inline-flex overflow-hidden rounded-md border text-xs">
                    {(["C", "F"] as const).map((u) => (
                      <button key={u} onClick={() => setTempUnit(u)}
                        className={`px-2.5 py-1 transition-colors ${tempUnit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                        °{u}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Hourly temperature over the year — drives the hourly PUE &amp; energy vector
                </div>
              </div>
              <div className={cardBd}>
                {activeWeather && activeWeather.tdb.length > 0 ? (
                  <>
                    <WeatherTempChart tdb={activeWeather.tdb} unit={tempUnit} />
                    {(() => {
                      const conv = (c: number) => (tempUnit === "F" ? c * 1.8 + 32 : c);
                      const t = activeWeather.tdb;
                      let lo = Infinity, hi = -Infinity, sum = 0;
                      for (const c of t) { sum += c; if (c < lo) lo = c; if (c > hi) hi = c; }
                      const avg = sum / t.length;
                      return (
                        <div className="grid grid-cols-3 gap-2">
                          <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Min</div><div className="font-mono tabular-nums">{conv(lo).toFixed(0)}°{tempUnit}</div></div>
                          <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Avg</div><div className="font-mono tabular-nums">{conv(avg).toFixed(0)}°{tempUnit}</div></div>
                          <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Max</div><div className="font-mono tabular-nums">{conv(hi).toFixed(0)}°{tempUnit}</div></div>
                        </div>
                      );
                    })()}
                  </>
                ) : (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {activeLoc.stationId ? "Loading weather…" : "No city selected — pick one in Location to see its hourly weather."}
                  </p>
                )}
              </div>
            </div>

            {/* Services — stacked demand chart at top */}
            <div className={sectionCard}>
              <div className={cardHd}>
                <div className="text-[15px] font-semibold">Services</div>
                <div className="mt-1 text-xs text-muted-foreground">Each service sets its own demand time series; stacked below (representative week, MW)</div>
              </div>
              <div className={cardBd}>
                <ServiceDemandChart services={activeLoc.services} />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {activeLoc.services.map((s, i) => (
                    <span key={s.id} className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERVICE_COLORS[i % SERVICE_COLORS.length] }} />
                      {s.label}
                    </span>
                  ))}
                </div>

                {activeLoc.services.map((s) => (
                  <div key={s.id} className="space-y-3 rounded-lg border bg-muted/40 p-3">
                    <div className="flex items-center gap-2">
                      <input value={s.label} onChange={(e) => patchService(s.id, { label: e.target.value })}
                        className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                      <button className="px-1 text-xs text-muted-foreground transition-colors hover:text-destructive" onClick={() => removeService(s.id)}>Remove</button>
                    </div>
                    <NumberInput label="Peak demand" value={s.peakDemandMW} onChange={(v) => patchService(s.id, { peakDemandMW: Math.max(0, v) })}
                      min={0} step={0.1} unit="MW"
                      hint="The service's maximum IT power. Hourly demand = this × the schedule." />
                    <SliderInput label="Unit price" value={s.unitPricePerMWh} onChange={(v) => patchService(s.id, { unitPricePerMWh: v })}
                      min={0} max={10000} step={50} display={`$${s.unitPricePerMWh.toLocaleString()}/MWh`}
                      hint="Price per MWh of IT delivered. Revenue = unit price × the MWh this service runs." />
                    <button
                      onClick={() => { setSchedServiceId(s.id); setActiveTab("scheduler"); }}
                      className="text-xs font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      Edit demand schedule (8,760 h) →
                    </button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-full" onClick={addService}>+ Add service</Button>
              </div>
            </div>
          </div>

          {/* RIGHT: IT load + stats + result tabs + double-wide build-cost grid */}
          <div className="space-y-4">
            {/* IT load — its own card, top of the column */}
            <div className={sectionCard}>
              <div className={cardHd}>
                <div className="flex items-center justify-between">
                  <div className="text-[15px] font-semibold">IT load</div>
                  <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs tabular-nums">{activeLoc.capacityMW.toLocaleString()} MW</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Built nameplate IT power — the capex basis. Services book demand against it.</div>
              </div>
              <div className={cardBd}>
                <NumberInput label="Critical IT load" value={activeLoc.capacityMW} onChange={(v) => upd({ capacityMW: Math.max(0, v) })}
                  min={0} step={0.1} unit="MW"
                  hint="Nameplate IT power — enter any value. (A future option will express this in NVIDIA scalable units.)" />
                {(() => {
                  const peak = activeLoc.services.reduce((a, s) => a + s.peakDemandMW, 0);
                  return (
                    <div className="text-xs text-muted-foreground">
                      Services peak demand: <span className="font-mono tabular-nums text-foreground">{peak.toLocaleString()} MW</span>
                      {peak > activeLoc.capacityMW && <span className="text-destructive"> · exceeds nameplate</span>}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Stat label="Upfront capex" value={`$${activeResult.capexPerW.toFixed(2)}`} unit="/W" sub={`${fmtUSD(activeResult.totalCapex)} total`} accent="var(--chart-1)" />
              <Stat label="Annual revenue" value={fmtUSD(activeResult.annualRevenue)} sub="at current utilization" />
              <Stat label="Payback" value={activeResult.paybackYears != null ? activeResult.paybackYears.toFixed(1) : `>${activeLoc.analysisYears}`} unit="yr" sub="cumulative break-even" accent="var(--chart-2)" />
              <Stat label="ROI" value={`${activeResult.roiPct >= 0 ? "+" : ""}${activeResult.roiPct.toFixed(0)}%`} sub={`over ${activeLoc.analysisYears} yr`} />
            </div>

            <div className="flex gap-0.5 border-b">
              {([
                { key: "capex", label: "Build cost" },
                { key: "scheduler", label: "Scheduler" },
                { key: "returns", label: "Returns" },
                { key: "energy", label: "Energy" },
                { key: "notes", label: "Technical notes" },
              ] as const).map((t) => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                    activeTab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}>{t.label}</button>
              ))}
            </div>

            {activeTab === "capex" && (
              <>
                <Card><CardContent className="pt-6"><CapexBreakdown segments={activeResult.capexBreakdown} total={activeResult.totalCapex} /></CardContent></Card>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Facilities capex */}
                  <div className={sectionCard}>
                    <div className={cardHd}>
                      <div className="flex items-center justify-between">
                        <div className="text-[15px] font-semibold">Facilities capex build-up</div>
                        <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs tabular-nums">{fmtPerW(activeResult.facilityCapexPerW)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">$/W of critical IT ($1/W = $1M/MW)</div>
                    </div>
                    <div className={cardBd}>
                      {FACILITY_LINE_ITEMS.map((li) => (
                        <CategoryCapex key={li.key} loc={activeLoc} catKey={li.key}
                          label={li.label} hint={FACILITY_HINTS[li.key]} min={0} max={8} step={0.1}
                          lumpValue={activeLoc.facility[li.key as keyof LocationConfig["facility"]]}
                          onLump={(v) => updFacility(li.key as keyof LocationConfig["facility"], v)}
                          onMode={(m) => setCategoryMode(li.key, m)}
                          onComponent={setComponentCost} onProducts={setProductsKey} />
                      ))}
                      <CategoryCapex loc={activeLoc} catKey="power"
                        label={powerLineLabel(activeLoc.powerSource)} min={0} max={6} step={0.1}
                        lumpValue={activeLoc.facility.power}
                        onLump={(v) => updFacility("power", v)}
                        onMode={(m) => setCategoryMode("power", m)}
                        onComponent={setComponentCost} onProducts={setProductsKey} />
                    </div>
                  </div>

                  {/* AI capex */}
                  <div className={sectionCard}>
                    <div className={cardHd}>
                      <div className="flex items-center justify-between">
                        <div className="text-[15px] font-semibold">AI infrastructure capex</div>
                        <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs tabular-nums">{fmtPerW(activeResult.aiCapex / activeResult.capacityW)}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">The compute payload, same $/W basis</div>
                    </div>
                    <div className={cardBd}>
                      <CategoryCapex loc={activeLoc} catKey="gpus" label="GPUs / accelerators"
                        hint="Accelerator hardware per watt of IT." min={0} max={60} step={1}
                        lumpValue={activeLoc.ai.gpus} onLump={(v) => updAI("gpus", v)}
                        onMode={(m) => setCategoryMode("gpus", m)}
                        onComponent={setComponentCost} onProducts={setProductsKey} />
                      <CategoryCapex loc={activeLoc} catKey="otherAI" label="Other AI infrastructure"
                        hint="Networking, storage, head nodes." min={0} max={30} step={0.5}
                        lumpValue={activeLoc.ai.otherAI} onLump={(v) => updAI("otherAI", v)}
                        onMode={(m) => setCategoryMode("otherAI", m)}
                        onComponent={setComponentCost} onProducts={setProductsKey} />
                      <SliderInput label="GPU refresh interval" value={activeLoc.gpuRefreshYears} onChange={(v) => upd({ gpuRefreshYears: v })} min={0} max={10} step={1}
                        display={activeLoc.gpuRefreshYears === 0 ? "never" : `every ${activeLoc.gpuRefreshYears} yr`} hint="Re-spend GPU capex every N years (0 = none)." />
                    </div>
                  </div>

                  {/* Cooling */}
                  <div className={sectionCard}>
                    <div className={cardHd}>
                      <div className="text-[15px] font-semibold">Cooling</div>
                      <div className="mt-1 text-xs text-muted-foreground">How weather becomes hourly PUE</div>
                    </div>
                    <div className={cardBd}>
                      <SelectInput<CoolingType> label="Cooling system" value={activeLoc.cooling.coolingType}
                        onChange={(v) => updCooling({ coolingType: v })}
                        options={Object.values(COOLING_SYSTEMS).map((c) => ({ value: c.type, label: c.label }))} />
                      <SliderInput label="Supply-air setpoint" value={activeLoc.cooling.supplyAirTemp} onChange={(v) => updCooling({ supplyAirTemp: v })}
                        min={16} max={30} step={1} display={`${activeLoc.cooling.supplyAirTemp} °C`} hint="Warmer air widens free cooling (lower PUE)." />
                      <SliderInput label="Liquid cooling share" value={activeLoc.cooling.liquidCoolingPct} onChange={(v) => updCooling({ liquidCoolingPct: v })}
                        min={0} max={100} step={5} display={`${activeLoc.cooling.liquidCoolingPct}%`} hint="Share of IT heat on direct-to-chip liquid (rest on air)." />
                    </div>
                  </div>

                  {/* Power & energy */}
                  <div className={sectionCard}>
                    <div className={cardHd}><div className="text-[15px] font-semibold">Power &amp; energy price</div></div>
                    <div className={cardBd}>
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">Power source</label>
                        <Toggle<PowerSource> value={activeLoc.powerSource} onChange={setPowerSource}
                          options={[{ key: "grid", label: "Grid" }, { key: "gas", label: "On-site gas" }]} />
                      </div>
                      {activeLoc.powerSource === "gas" ? (
                        <>
                          <SliderInput label="Heat rate" value={activeLoc.heatRateBtuPerKWh} onChange={(v) => upd({ heatRateBtuPerKWh: v })} min={5800} max={9000} step={50} display={`${activeLoc.heatRateBtuPerKWh.toLocaleString()} Btu/kWh`} hint="Fuel per kWh generated; lower is more efficient." />
                          <SliderInput label="Natural gas price" value={activeLoc.gasPricePerMMBtu} onChange={(v) => upd({ gasPricePerMMBtu: v })} min={2} max={10} step={0.1} display={`$${activeLoc.gasPricePerMMBtu.toFixed(2)}/MMBtu`} hint="Delivered fuel price." />
                        </>
                      ) : (
                        <>
                          <div>
                            <label className="mb-1.5 block text-sm font-medium">Pricing</label>
                            <Toggle<PriceMode> value={activeLoc.priceMode} onChange={(v) => upd({ priceMode: v })}
                              options={[{ key: "flat", label: "Flat" }, { key: "tou", label: "Time-of-use" }]} />
                          </div>
                          {activeLoc.priceMode === "flat" ? (
                            <SliderInput label="Electricity price" value={activeLoc.gridPricePerKWh} onChange={(v) => upd({ gridPricePerKWh: v })} min={0.02} max={0.18} step={0.005} display={`$${activeLoc.gridPricePerKWh.toFixed(3)}/kWh`} hint="Flat delivered grid price." />
                          ) : (
                            <>
                              <SliderInput label="Peak price" value={activeLoc.touPeakPerKWh} onChange={(v) => upd({ touPeakPerKWh: v })} min={0.03} max={0.4} step={0.005} display={`$${activeLoc.touPeakPerKWh.toFixed(3)}/kWh`} hint="Daytime / on-peak rate." />
                              <SliderInput label="Off-peak price" value={activeLoc.touOffPeakPerKWh} onChange={(v) => upd({ touOffPeakPerKWh: v })} min={0.01} max={0.2} step={0.005} display={`$${activeLoc.touOffPeakPerKWh.toFixed(3)}/kWh`} hint="Overnight / off-peak rate." />
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Finance (span 2) */}
                  <div className={`${sectionCard} md:col-span-2`}>
                    <div className={cardHd}>
                      <div className="text-[15px] font-semibold">Finance <span className="font-normal text-muted-foreground">· per-location</span></div>
                      <div className="mt-1 text-xs text-muted-foreground">Horizon, discount, and non-energy operating cost</div>
                    </div>
                    <div className={cardBd}>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <SliderInput label="Investment horizon" value={activeLoc.analysisYears} onChange={(v) => upd({ analysisYears: v })} min={3} max={20} step={1} display={`${activeLoc.analysisYears} yr`} hint="Years used for payback, ROI and LCOE." />
                        <SliderInput label="Discount rate" value={activeLoc.discountRatePct} onChange={(v) => upd({ discountRatePct: v })} min={0} max={15} step={0.5} display={`${activeLoc.discountRatePct}%`} hint="Time-value rate; affects the levelized $/MWh." />
                        <SliderInput label="Other opex" value={activeLoc.otherOpexPerMWYr} onChange={(v) => upd({ otherOpexPerMWYr: v })} min={0} max={3} step={0.05} display={`$${activeLoc.otherOpexPerMWYr.toFixed(2)}M/MW/yr`} hint="Non-energy: staff, networking, insurance, maintenance." />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {activeTab === "scheduler" && (() => {
              const svc = activeLoc.services.find((s) => s.id === schedServiceId) ?? activeLoc.services[0];
              if (!svc) return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Add a service to edit its schedule.</CardContent></Card>;
              const weekStart = schedWeek * 168;
              const rows = Math.min(168, 8760 - weekStart);
              return (
                <Card><CardContent className="space-y-5 pt-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">Service</span>
                    {activeLoc.services.map((s) => (
                      <button key={s.id} onClick={() => setSchedServiceId(s.id)}
                        className={`rounded-md px-3 py-1.5 text-sm transition-colors ${svc.id === s.id ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-muted"}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <DemandYearChart demand={svc.demand} peakMW={svc.peakDemandMW} />
                  <p className="text-xs text-muted-foreground">
                    {svc.label}&apos;s 8,760-hour demand (MW). This vector is multiplied by the city&apos;s hourly PUE to produce facility energy and priced at {`$${svc.unitPricePerMWh.toLocaleString()}/MWh`} delivered.
                  </p>

                  {/* Demand source selector */}
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Demand source</label>
                    <Toggle<DemandSource>
                      value={svc.demandSource}
                      onChange={(v) => setDemandSource(svc, v)}
                      options={[{ key: "preset", label: "Preset" }, { key: "model", label: "Statistical" }, { key: "custom", label: "Custom CSV" }]}
                    />
                  </div>

                  {/* PRESET */}
                  {svc.demandSource === "preset" && (
                    <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
                      <div>
                        <label className="mb-1.5 block text-sm font-medium">Shape</label>
                        <Toggle<ProfileShape>
                          value={svc.profile.shape}
                          onChange={(v) => regenPreset(svc.id, { ...svc.profile, shape: v })}
                          options={[{ key: "flat", label: "Flat" }, { key: "diurnal", label: "Diurnal" }, { key: "business", label: "Business" }, { key: "ramp", label: "Ramp" }]}
                        />
                        <FieldNote>{SHAPE_NOTES[svc.profile.shape]}</FieldNote>
                      </div>
                      {svc.profile.shape === "flat" ? (
                        <SliderInput label="Level" value={svc.profile.peakLoadPct} onChange={(v) => regenPreset(svc.id, { ...svc.profile, peakLoadPct: v })}
                          min={0} max={100} step={1} display={`${svc.profile.peakLoadPct}% of peak`} hint="Constant demand as a share of peak." />
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-3">
                            <SliderInput label="Trough" value={svc.profile.baseLoadPct} onChange={(v) => regenPreset(svc.id, { ...svc.profile, baseLoadPct: v })}
                              min={0} max={100} step={1} display={`${svc.profile.baseLoadPct}% of peak`} hint="Daily minimum, % of peak demand." />
                            <SliderInput label="Peak" value={svc.profile.peakLoadPct} onChange={(v) => regenPreset(svc.id, { ...svc.profile, peakLoadPct: v })}
                              min={0} max={100} step={1} display={`${svc.profile.peakLoadPct}% of peak`} hint="Daily maximum, % of peak demand." />
                          </div>
                          {svc.profile.shape === "diurnal" && (
                            <div className="grid grid-cols-2 gap-3">
                              <SliderInput label="Trough time" value={svc.profile.troughHour ?? 4} onChange={(v) => regenPreset(svc.id, { ...svc.profile, troughHour: v })}
                                min={0} max={23} step={1} display={`${String(svc.profile.troughHour ?? 4).padStart(2, "0")}:00`} hint="Local hour of the daily minimum." />
                              <SliderInput label="Peak time" value={svc.profile.peakHour ?? 15} onChange={(v) => regenPreset(svc.id, { ...svc.profile, peakHour: v })}
                                min={0} max={23} step={1} display={`${String(svc.profile.peakHour ?? 15).padStart(2, "0")}:00`} hint="Local hour of the daily maximum." />
                            </div>
                          )}
                          <SliderInput label="Weekend factor" value={svc.profile.weekendFactor} onChange={(v) => regenPreset(svc.id, { ...svc.profile, weekendFactor: v })}
                            min={0} max={1} step={0.05} display={svc.profile.weekendFactor.toFixed(2)} hint="Shrinks weekend swing (1 = no change)." />
                        </>
                      )}
                    </div>
                  )}

                  {/* STATISTICAL MODEL */}
                  {svc.demandSource === "model" && (() => {
                    const m = svc.model;
                    const set = (patch: Partial<SynthModel>) => regenModel(svc.id, { ...m, ...patch });
                    return (
                      <div className="space-y-4 rounded-lg border bg-muted/40 p-3">
                        <p className="text-xs text-muted-foreground">Synthetic (&quot;inorganic&quot;) demand: a daily &amp; seasonal cosine plus statistical variability. The histogram shows how often each demand level occurs.</p>
                        <div>
                          <label className="mb-1.5 block text-sm font-medium">Method</label>
                          <Toggle<SynthMethod> value={m.method} onChange={(v) => set({ method: v })}
                            options={[{ key: "additive", label: "Additive (smooth)" }, { key: "sampling", label: "Sampling (spiky)" }]} />
                          <FieldNote>{m.method === "additive" ? "Deterministic shape + autocorrelated wander." : "Each hour drawn independently from the distribution."}</FieldNote>
                        </div>
                        <HistogramChart values={svc.demand} />
                        <div className="grid grid-cols-2 gap-3">
                          <SliderInput label="Base level" value={m.baseLevelPct} onChange={(v) => set({ baseLevelPct: v })} min={0} max={100} step={1} display={`${m.baseLevelPct}%`} hint="Average demand, % of peak." />
                          <SliderInput label="Daily swing" value={m.diurnalAmpPct} onChange={(v) => set({ diurnalAmpPct: v })} min={0} max={60} step={1} display={`±${m.diurnalAmpPct}%`} hint="Amplitude of the daily cycle." />
                          <SliderInput label="Peak hour" value={m.peakHour} onChange={(v) => set({ peakHour: v })} min={0} max={23} step={1} display={`${String(m.peakHour).padStart(2, "0")}:00`} hint="Local hour the daily peak occurs." />
                          <SliderInput label="Trough hour" value={m.troughHour} onChange={(v) => set({ troughHour: v })} min={0} max={23} step={1} display={`${String(m.troughHour).padStart(2, "0")}:00`} hint="Local hour the daily trough occurs." />
                          <SliderInput label="Seasonal swing" value={m.seasonalAmpPct} onChange={(v) => set({ seasonalAmpPct: v })} min={0} max={40} step={1} display={`±${m.seasonalAmpPct}%`} hint="Amplitude of the yearly cycle." />
                          <SliderInput label="Peak month" value={m.peakMonth} onChange={(v) => set({ peakMonth: v })} min={1} max={12} step={1} display={["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m.peakMonth - 1]} hint="When the seasonal peak occurs." />
                          <SliderInput label="Yearly trend" value={m.trendPct} onChange={(v) => set({ trendPct: v })} min={-50} max={50} step={1} display={`${m.trendPct > 0 ? "+" : ""}${m.trendPct}%`} hint="Linear growth over the year." />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <SelectInput<Distribution> label="Distribution" value={m.dist} onChange={(v) => set({ dist: v })}
                            options={[{ value: "normal", label: "Normal (bell)" }, { value: "uniform", label: "Uniform (flat)" }, { value: "triangular", label: "Triangular" }, { value: "beta", label: "Beta (bell-ish)" }]} />
                          <SliderInput label="Variability" value={m.spreadPct} onChange={(v) => set({ spreadPct: v })} min={0} max={40} step={1} display={`±${m.spreadPct}%`} hint="Spread of the random term." />
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">Seed <span className="font-mono text-foreground">{m.seed}</span> — reproducible</span>
                          <Button variant="outline" size="sm" onClick={() => set({ seed: Math.floor(Math.random() * 100000) })}>Shuffle</Button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* CUSTOM CSV */}
                  {svc.demandSource === "custom" && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
                      <Button variant="outline" size="sm" onClick={() => exportDemandCSV(svc)}>Export CSV (8,760 rows)</Button>
                      {signedIn ? (
                        <label className="text-xs text-muted-foreground">
                          <span className="mb-1 block font-medium text-foreground">Import CSV (replaces the schedule)</span>
                          <input type="file" accept=".csv,text/csv,text/plain"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) importDemandCSV(svc.id, f); e.target.value = ""; }}
                            className="block text-xs file:mr-2 file:cursor-pointer file:rounded file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs hover:file:bg-accent" />
                        </label>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sign in to import a CSV. (Export works for everyone.)</span>
                      )}
                    </div>
                  )}

                  {/* Weekly editable table */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium">Hourly demand · week {schedWeek + 1} of 52</div>
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled={schedWeek <= 0} onClick={() => setSchedWeek((w) => Math.max(0, w - 1))}>‹ Prev</Button>
                        <Button variant="outline" size="sm" disabled={schedWeek >= 51} onClick={() => setSchedWeek((w) => Math.min(51, w + 1))}>Next ›</Button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-auto rounded-lg border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-card">
                          <tr className="text-left text-muted-foreground">
                            <th className="px-3 py-1.5 font-medium">Hour</th>
                            <th className="px-3 py-1.5 font-medium">Day · hr</th>
                            <th className="px-3 py-1.5 text-right font-medium">Fraction</th>
                            <th className="px-3 py-1.5 text-right font-medium">MW</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: rows }, (_, k) => {
                            const hr = weekStart + k;
                            const day = Math.floor(hr / 24), hod = hr % 24;
                            return (
                              <tr key={hr} className="border-t border-border/50">
                                <td className="px-3 py-1 font-mono text-muted-foreground">{hr}</td>
                                <td className="px-3 py-1 font-mono text-muted-foreground">d{day} · {String(hod).padStart(2, "0")}:00</td>
                                <td className="px-3 py-1 text-right">
                                  <input type="number" min={0} max={1} step={0.01}
                                    value={Number((svc.demand[hr] ?? 0).toFixed(2))}
                                    onChange={(e) => setDemandHour(svc.id, hr, parseFloat(e.target.value) || 0)}
                                    className="w-20 rounded border border-input bg-background px-1.5 py-0.5 text-right font-mono outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                                </td>
                                <td className="px-3 py-1 text-right font-mono text-muted-foreground">{((svc.demand[hr] ?? 0) * svc.peakDemandMW).toFixed(0)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Edit any hour (0–1 of peak demand). For bulk changes, export the CSV, edit in a spreadsheet, and re-import.</p>
                  </div>
                </CardContent></Card>
              );
            })()}

            {activeTab === "returns" && (
              <Card><CardContent className="space-y-5 pt-6">
                <CashFlowChart cashFlow={activeResult.cashFlow} payback={activeResult.paybackYears} />
                <div className="grid grid-cols-2 gap-x-7 gap-y-2 text-sm sm:grid-cols-3">
                  <Line label="Annual revenue" value={`${fmtUSD(activeResult.annualRevenue)}/yr`} />
                  <Line label="Annual opex" value={`${fmtUSD(activeResult.annualOpex)}/yr`} />
                  <Line label="Annual profit" value={`${fmtUSD(activeResult.annualProfit)}/yr`} strong />
                  <Line label="Energy opex" value={`${fmtUSD(activeResult.annualEnergyCost)}/yr`} />
                  <Line label="Other opex" value={`${fmtUSD(activeResult.annualOtherOpex)}/yr`} />
                  <Line label="LCOE" value={fmtPerMWh(activeResult.lcoePerMWh)} />
                </div>
              </CardContent></Card>
            )}

            {activeTab === "energy" && (
              <Card><CardContent className="space-y-5 pt-6">
                <EnergyVectorChart facilityMW={activeResult.energy.facilityMW} />
                <div className="grid grid-cols-2 gap-x-7 gap-y-2 text-sm sm:grid-cols-4">
                  <Line label="Avg PUE" value={activeResult.avgPue.toFixed(3)} strong />
                  <Line label="Avg utilization" value={`${(activeResult.avgUtil * 100).toFixed(0)}%`} />
                  <Line label="IT energy" value={`${(activeResult.annualITMWh / 1000).toFixed(0)} GWh`} />
                  <Line label="Facility energy" value={`${(activeResult.annualFacilityMWh / 1000).toFixed(0)} GWh`} />
                  <Line label="Energy cost" value={`${fmtUSD(activeResult.annualEnergyCost)}/yr`} />
                  <Line label="Source" value={activeResult.weatherCoupled ? "weather" : "flat PUE"} />
                </div>
                <div className="space-y-1.5 border-t pt-3 text-sm">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Services</div>
                  {activeResult.energy.services.map((s) => (
                    <Line key={s.id} label={`${s.label} · ${s.capacityMW.toFixed(0)} MW · ${(s.avgUtil * 100).toFixed(0)}% util`} value={`${fmtUSD(s.annualRevenue)}/yr`} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Load-duration of the facility energy vector{activeResult.weatherCoupled && station ? ` for ${station.name}, ${station.state}` : ""}: facility MW (y) over the 8,760 hours (x).
                </p>
              </CardContent></Card>
            )}

            {activeTab === "notes" && (
              <Card><CardContent className="space-y-4 pt-6 text-sm">
                <p className="text-muted-foreground">Defaults are representative planning figures — replace with project-specific numbers.</p>
                <div className="space-y-3">
                  {SOURCE_NOTES.map((n) => (
                    <div key={n.label} className="border-l-2 pl-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{n.label}</span>
                        <span className="text-right font-mono text-xs text-muted-foreground">{n.value}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{n.source}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t pt-3 text-xs text-muted-foreground">
                  <p><strong className="text-foreground">Scope.</strong> Capex builds up the facility plus AI infrastructure. Energy is integrated hourly over the city&apos;s weather through the PUE cooling engine; differentiated services drive the IT load and revenue. Returns use simple payback and ROI.</p>
                  <p><strong className="text-foreground">Methodology.</strong> Patterned on a public Crusoe presentation (illustrative) and Andrew McCalip&apos;s open-source (MIT) model. Independent Drybulb reimplementation; orbital-solar comparison in development.</p>
                  <p><strong className="text-foreground">Itemized pricing.</strong> Each capex category can be itemized into its bill of materials. Category totals are well-anchored to published build benchmarks; the per-line $/W splits are proportional estimates unless flagged <em>sourced</em> (vendor / market-referenced). Example products and reference prices are planning-grade and vendor-dependent — confirm against live quotes. Equipment data lives in a maintainable catalog (<span className="font-mono">data/equipment-catalog.json</span>); a future supplier integration will replace estimates with quotes.</p>
                </div>
              </CardContent></Card>
            )}

            <p className="text-center text-[11px] text-muted-foreground/60">Planning-grade estimates for screening only. $1/W = $1M/MW.</p>

            <Card className="bg-muted/40">
              <CardContent className="flex flex-col items-start justify-between gap-4 py-6 sm:flex-row sm:items-center">
                <div>
                  <p className="mb-1 font-semibold">Need a expert capex/opex and returns model for your build?</p>
                  <p className="text-sm text-muted-foreground">Independent, PE-stamped cost, energy, and life-cycle analysis for owners, operators, and lenders.</p>
                </div>
                <Button asChild className="shrink-0">
                  <Link href="/contact?engagement=cost-model" data-umami-event="cta-consulting-cost-model">Work with me</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {productsKey && <ProductsModal componentKey={productsKey} onClose={() => setProductsKey(null)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Total view
// ─────────────────────────────────────────────────────────────────────────────

function TotalView({
  portfolio, locations,
}: {
  portfolio: ReturnType<typeof computePortfolio>; locations: LocationConfig[];
}) {
  const { total, perLocation } = portfolio;
  const locColor = (i: number) => LOCATION_COLORS[i % LOCATION_COLORS.length];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Portfolio capex" value={fmtUSD(total.totalCapex)} sub={`${total.locationCount} locations · ${total.totalCapacityMW.toLocaleString()} MW`} accent="var(--chart-1)" />
        <Stat label="Annual revenue" value={fmtUSD(total.annualRevenue)} sub="blended utilization" />
        <Stat label="Blended payback" value={total.paybackYears != null ? total.paybackYears.toFixed(1) : "—"} unit="yr" sub="combined cash flow" accent="var(--chart-2)" />
        <Stat label="Blended ROI" value={`${total.roiPct >= 0 ? "+" : ""}${total.roiPct.toFixed(0)}%`} sub="over the longest horizon" />
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card><CardContent className="space-y-4 pt-6">
          <div className="text-[15px] font-semibold">Capex by location</div>
          <div className="flex h-8 gap-px overflow-hidden rounded-md bg-border">
            {perLocation.map((p, i) => (
              <div key={p.id} className={`${locColor(i)} h-full`} style={{ width: `${(p.result.totalCapex / (total.totalCapex || 1)) * 100}%` }} title={`${p.name}: ${fmtUSD(p.result.totalCapex)}`} />
            ))}
          </div>
          <div className="space-y-1.5 text-sm">
            {perLocation.map((p, i) => (
              <div key={p.id} className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-2 text-muted-foreground"><span className={`h-2.5 w-2.5 rounded-sm ${locColor(i)}`} />{p.name}</span>
                <span className="font-mono tabular-nums">{fmtUSD(p.result.totalCapex)}<span className="ml-1 text-muted-foreground/70">{((p.result.totalCapex / (total.totalCapex || 1)) * 100).toFixed(0)}%</span></span>
              </div>
            ))}
          </div>
        </CardContent></Card>

        <Card><CardContent className="space-y-3 pt-6">
          <div className="text-[15px] font-semibold">Combined cash flow</div>
          <CashFlowChart cashFlow={total.cashFlow} payback={total.paybackYears} />
          <p className="text-xs text-muted-foreground">Each location contributes profit through its own horizon; the portfolio combines over the longest.</p>
        </CardContent></Card>
      </div>

      <Card><CardContent className="pt-6">
        <div className="mb-3 text-[15px] font-semibold">Locations</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">Location</th>
                <th className="pb-2 pr-3 text-right font-medium">MW</th>
                <th className="pb-2 pr-3 text-right font-medium">Avg PUE</th>
                <th className="pb-2 pr-3 text-right font-medium">Capex</th>
                <th className="pb-2 pr-3 text-right font-medium">Revenue/yr</th>
                <th className="pb-2 pr-3 text-right font-medium">Payback</th>
                <th className="pb-2 text-right font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {perLocation.map((p, i) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/50">
                  <td className="py-2 pr-3"><span className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-sm ${locColor(i)}`} />{p.name}</span></td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{p.result.capacityMW.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{p.result.avgPue.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtUSD(p.result.totalCapex)}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtUSD(p.result.annualRevenue)}</td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{p.result.paybackYears != null ? `${p.result.paybackYears.toFixed(1)} yr` : "—"}</td>
                  <td className="py-2 text-right font-mono tabular-nums">{p.result.roiPct >= 0 ? "+" : ""}{p.result.roiPct.toFixed(0)}%</td>
                </tr>
              ))}
              <tr className="bg-secondary font-semibold">
                <td className="py-2 pr-3">Σ Total</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{total.totalCapacityMW.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{total.avgPue.toFixed(2)}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtUSD(total.totalCapex)}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{fmtUSD(total.annualRevenue)}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{total.paybackYears != null ? `${total.paybackYears.toFixed(1)} yr` : "—"}</td>
                <td className="py-2 text-right font-mono tabular-nums">{total.roiPct >= 0 ? "+" : ""}{total.roiPct.toFixed(0)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent></Card>

      {locations.length === 1 && (
        <p className="text-center text-xs text-muted-foreground">Add more locations (tab above) to compare and roll up a portfolio.</p>
      )}
    </div>
  );
}
