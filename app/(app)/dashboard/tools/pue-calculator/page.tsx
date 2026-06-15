"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchStationIndex, fetchStationWeather } from "@/lib/pue/tmy3";
import { PsychrometricChart } from "@/components/pue/psychrometric-chart";
import { LiquidCoolingTab } from "@/components/pue/liquid-cooling-tab";
import { LocationSelect } from "@/components/pue/location-select";
import {
  COOLING_SYSTEMS,
  DEFAULT_INPUTS,
  IT_PRESETS,
  UPS_CONFIGS,
} from "@/lib/pue/equipment-defaults";
import {
  calculateAnnualPUE,
  lpmToGPM,
  pueRating,
  PUE_BENCHMARKS,
} from "@/lib/pue/calculations";
import type {
  AnnualPUEResult,
  CoolingType,
  HourlyWeather,
  ITPreset,
  MonthlyWeather,
  PUEInputs,
  TmyStation,
  UPSType,
} from "@/lib/pue/types";
import { MONTH_LABELS } from "@/lib/pue/types";
import { SavedModelsDrawer } from "@/components/pue/saved-models-drawer";
import type { SavedModelInputs } from "@/lib/pue/saved-models";

// ─────────────────────────────────────────────────────────────────────────────
// Temperature unit helpers
// ─────────────────────────────────────────────────────────────────────────────

type TempUnit = "C" | "F";

const cToF = (c: number) => c * 1.8 + 32;
const fToC = (f: number) => (f - 32) / 1.8;
const deltaCToF = (dc: number) => dc * 1.8;
const deltaFToC = (df: number) => df / 1.8;

function formatTemp(celsius: number, unit: TempUnit, decimals = 1): string {
  if (unit === "C") {
    return `${celsius.toFixed(decimals)}\u00B0C (${cToF(celsius).toFixed(decimals)}\u00B0F)`;
  }
  return `${cToF(celsius).toFixed(decimals)}\u00B0F (${celsius.toFixed(decimals)}\u00B0C)`;
}

function formatDelta(deltaC: number, unit: TempUnit, decimals = 0): string {
  if (unit === "C") {
    return `${deltaC.toFixed(decimals)}\u00B0C (${deltaCToF(deltaC).toFixed(decimals)}\u00B0F)`;
  }
  return `${deltaCToF(deltaC).toFixed(decimals)}\u00B0F (${deltaC.toFixed(decimals)}\u00B0C)`;
}

function displayTemp(celsius: number, unit: TempUnit): number {
  return unit === "C" ? celsius : cToF(celsius);
}

function displayDelta(deltaC: number, unit: TempUnit): number {
  return unit === "C" ? deltaC : deltaCToF(deltaC);
}

function inputToC(value: number, unit: TempUnit): number {
  return unit === "C" ? value : fToC(value);
}

function inputDeltaToC(value: number, unit: TempUnit): number {
  return unit === "C" ? value : deltaFToC(value);
}

/** Format flow rate: primary LPM with GPM in parens, or vice versa */
function formatFlow(lpm: number): string {
  return `${lpm.toFixed(1)} L/min (${lpmToGPM(lpm).toFixed(1)} GPM)`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unit Toggle
// ─────────────────────────────────────────────────────────────────────────────

function UnitToggle({
  unit,
  onChange,
}: {
  unit: TempUnit;
  onChange: (u: TempUnit) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border text-xs">
      <button
        className={`px-2.5 py-1 rounded-l-md transition-colors ${
          unit === "C"
            ? "bg-primary text-primary-foreground"
            : "hover:bg-accent"
        }`}
        onClick={() => onChange("C")}
      >
        &deg;C
      </button>
      <button
        className={`px-2.5 py-1 rounded-r-md transition-colors ${
          unit === "F"
            ? "bg-primary text-primary-foreground"
            : "hover:bg-accent"
        }`}
        onClick={() => onChange("F")}
      >
        &deg;F
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Number Input helper
// ─────────────────────────────────────────────────────────────────────────────

function NumberInput({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step ?? 1}
        />
        {unit && (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Select helper
// ─────────────────────────────────────────────────────────────────────────────

function SelectInput<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5">{label}</label>
      <select
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Results: Monthly Bar Chart
// ─────────────────────────────────────────────────────────────────────────────

function MonthlyChart({ result }: { result: AnnualPUEResult }) {
  const chartMax = Math.ceil(Math.max(...result.monthly.map((m) => m.pue)) * 10) / 10;

  return (
    <div className="space-y-1.5">
      {result.monthly.map((m) => {
        const pct = ((m.pue - 1) / (chartMax - 1)) * 100;
        return (
          <div key={m.month} className="flex items-center gap-2 text-sm">
            <span className="w-8 text-muted-foreground font-mono text-xs">
              {MONTH_LABELS[m.month]}
            </span>
            <div className="flex-1 h-6 bg-muted/30 rounded relative overflow-hidden">
              <div
                className={`h-full rounded transition-all duration-500 ${
                  m.pue <= 1.2
                    ? "bg-green-500/70"
                    : m.pue <= 1.4
                      ? "bg-emerald-500/70"
                      : m.pue <= 1.6
                        ? "bg-yellow-500/70"
                        : m.pue <= 2.0
                          ? "bg-orange-500/70"
                          : "bg-red-500/70"
                }`}
                style={{ width: `${Math.max(pct, 5)}%` }}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {m.airEconomizing && (
                  <span className="text-[9px] font-medium text-muted-foreground/70">
                    AIR-ECO
                  </span>
                )}
                {m.liquidFreeCooling && (
                  <span className="text-[9px] font-medium text-blue-500/70">
                    LIQ-FC
                  </span>
                )}
                <span className="text-xs font-mono font-medium">
                  {m.pue.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Results: Weather & Cooling Table
// ─────────────────────────────────────────────────────────────────────────────

function WeatherTable({
  result,
  unit,
  hasLiquid,
}: {
  result: AnnualPUEResult;
  unit: TempUnit;
  hasLiquid: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="pb-2 pr-3 font-medium text-muted-foreground">Month</th>
            <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">Dry Bulb</th>
            <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">Wet Bulb</th>
            <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">RH</th>
            <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">Air COP</th>
            <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">Air kW</th>
            {hasLiquid && (
              <>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">Liq COP</th>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">Liq kW</th>
                <th className="pb-2 pr-3 font-medium text-muted-foreground text-right">Flow</th>
              </>
            )}
            <th className="pb-2 font-medium text-muted-foreground text-right">PUE</th>
          </tr>
        </thead>
        <tbody>
          {result.monthly.map((m) => (
            <tr key={m.month} className="border-b border-border/30">
              <td className="py-1.5 pr-3 font-mono text-xs">{MONTH_LABELS[m.month]}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs">
                {formatTemp(m.oatDryBulb, unit)}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs">
                {formatTemp(m.oatWetBulb, unit)}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs">{m.humidity.toFixed(0)}%</td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs">
                {m.airCoolingCOP > 0 ? m.airCoolingCOP.toFixed(1) : "\u2014"}
              </td>
              <td className="py-1.5 pr-3 text-right font-mono text-xs">
                {m.airCoolingKW > 0 ? m.airCoolingKW.toFixed(0) : "\u2014"}
              </td>
              {hasLiquid && (
                <>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs">
                    {m.liquidCoolingCOP > 0 ? m.liquidCoolingCOP.toFixed(1) : "\u2014"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs">
                    {m.liquidCoolingKW > 0 ? m.liquidCoolingKW.toFixed(0) : "\u2014"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-xs">
                    {m.waterFlowLPM > 0 ? formatFlow(m.waterFlowLPM) : "\u2014"}
                  </td>
                </>
              )}
              <td className={`py-1.5 text-right font-mono text-xs font-semibold ${pueRating(m.pue).color}`}>
                {m.pue.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Results: Power Breakdown
// ─────────────────────────────────────────────────────────────────────────────

function PowerBreakdown({
  result,
  hasLiquid,
}: {
  result: AnnualPUEResult;
  hasLiquid: boolean;
}) {
  const avg = {
    it: result.itLoadKW,
    airCooling:
      result.monthly.reduce((s, m) => s + m.airCoolingKW, 0) / 12,
    liquidCooling:
      result.monthly.reduce((s, m) => s + m.liquidCoolingKW, 0) / 12,
    ups: result.monthly.reduce((s, m) => s + m.upsLossKW, 0) / 12,
    pdu: result.monthly.reduce((s, m) => s + m.pduLossKW, 0) / 12,
    lighting: result.monthly.reduce((s, m) => s + m.lightingKW, 0) / 12,
  };
  const total =
    avg.it + avg.airCooling + avg.liquidCooling + avg.ups + avg.pdu + avg.lighting;

  const segments = [
    { label: "IT Load", kw: avg.it, color: "bg-blue-500" },
    { label: "Air Cooling", kw: avg.airCooling, color: "bg-cyan-500" },
    ...(hasLiquid
      ? [{ label: "Liquid Cooling", kw: avg.liquidCooling, color: "bg-indigo-500" }]
      : []),
    { label: "UPS Losses", kw: avg.ups, color: "bg-amber-500" },
    { label: "PDU Losses", kw: avg.pdu, color: "bg-orange-500" },
    { label: "Lighting & Misc", kw: avg.lighting, color: "bg-gray-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex h-8 rounded overflow-hidden">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={`${seg.color} transition-all duration-500`}
            style={{ width: `${(seg.kw / total) * 100}%` }}
            title={`${seg.label}: ${seg.kw.toFixed(0)} kW (${((seg.kw / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-sm ${seg.color}`} />
              <span className="text-muted-foreground">{seg.label}</span>
            </div>
            <span className="font-mono">
              {seg.kw.toFixed(0)} kW
              <span className="text-muted-foreground ml-1">
                ({((seg.kw / total) * 100).toFixed(1)}%)
              </span>
            </span>
          </div>
        ))}
        <div className="col-span-2 border-t pt-1.5 flex items-center justify-between font-medium">
          <span>Total Facility Power</span>
          <span className="font-mono">{total.toFixed(0)} kW</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Results: Benchmark Comparison
// ─────────────────────────────────────────────────────────────────────────────

function BenchmarkComparison({ annualPUE }: { annualPUE: number }) {
  const allValues = [...PUE_BENCHMARKS.map((b) => b.pue), annualPUE];
  const maxVal = Math.max(...allValues);

  return (
    <div className="space-y-2">
      {PUE_BENCHMARKS.map((b) => (
        <div key={b.label} className="flex items-center gap-3 text-sm">
          <span className="w-44 text-muted-foreground text-xs truncate">{b.label}</span>
          <div className="flex-1 h-4 bg-muted/30 rounded relative">
            <div
              className="h-full bg-muted-foreground/20 rounded"
              style={{ width: `${((b.pue - 1) / (maxVal - 1)) * 100}%` }}
            />
            <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] font-mono">
              {b.pue.toFixed(2)}
            </span>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3 text-sm border-t pt-2">
        <span className="w-44 font-semibold text-xs">Your Estimate</span>
        <div className="flex-1 h-5 bg-muted/30 rounded relative">
          <div
            className={`h-full rounded ${
              annualPUE <= 1.2
                ? "bg-green-500/80"
                : annualPUE <= 1.4
                  ? "bg-emerald-500/80"
                  : annualPUE <= 1.6
                    ? "bg-yellow-500/80"
                    : annualPUE <= 2.0
                      ? "bg-orange-500/80"
                      : "bg-red-500/80"
            }`}
            style={{ width: `${((annualPUE - 1) / (maxVal - 1)) * 100}%` }}
          />
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-xs font-mono font-bold">
            {annualPUE.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PueCalculatorPage() {
  const [inputs, setInputs] = useState<PUEInputs>(DEFAULT_INPUTS);
  const [stations, setStations] = useState<TmyStation[]>([]);
  const [weather, setWeather] = useState<MonthlyWeather | null>(null);
  const [hourly, setHourly] = useState<HourlyWeather | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "chart" | "table" | "psychro" | "power" | "liquid" | "benchmark"
  >("chart");
  const [tempUnit, setTempUnit] = useState<TempUnit>("F");

  const station = stations.find((s) => s.usaf === inputs.stationId);
  const hasLiquid = inputs.liquidCoolingPct > 0;

  // Load the TMY3 station index once; default to a featured DC market (Ashburn).
  useEffect(() => {
    fetchStationIndex()
      .then((list) => {
        setStations(list);
        setInputs((prev) => {
          if (list.some((s) => s.usaf === prev.stationId)) return prev;
          const def =
            list.find((s) => s.dcMarket && /dulles/i.test(s.name)) ??
            list.find((s) => s.dcMarket) ??
            list[0];
          return def ? { ...prev, stationId: def.usaf } : prev;
        });
      })
      .catch(() => setError("Couldn't load the station list."));
  }, []);

  const fetchWeather = useCallback(async (s: TmyStation) => {
    setLoading(true);
    setError(null);
    try {
      const { monthly, hourly: hrly } = await fetchStationWeather(s);
      setWeather(monthly);
      setHourly(hrly);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch weather data");
      setWeather(null);
      setHourly(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (station) fetchWeather(station);
  }, [station, fetchWeather]);

  const result = useMemo(() => {
    if (!weather) return null;
    return calculateAnnualPUE(inputs, weather);
  }, [inputs, weather]);

  const rating = result ? pueRating(result.annualPUE) : null;

  const update = <K extends keyof PUEInputs>(key: K, val: PUEInputs[K]) =>
    setInputs((prev) => ({ ...prev, [key]: val }));

  const applyITPreset = (preset: ITPreset) => {
    const p = IT_PRESETS[preset];
    setInputs((prev) => ({
      ...prev,
      itLoadKW: p.totalKW,
      kwPerRack: p.kwPerRack,
      rackCount: p.rackCount,
    }));
  };

  // Restore a saved model: inputs + the display unit it was saved with.
  const handleLoadModel = (loaded: SavedModelInputs) => {
    const { tempUnit: savedUnit, ...savedInputs } = loaded;
    setInputs(savedInputs);
    if (savedUnit === "C" || savedUnit === "F") setTempUnit(savedUnit);
  };

  // Display values for temperature inputs
  const supplyDisplay = Math.round(displayTemp(inputs.supplyAirTemp, tempUnit));
  const airRiseDisplay = Math.round(displayDelta(inputs.temperatureRise, tempUnit));
  const returnAirC = inputs.supplyAirTemp + inputs.temperatureRise;
  const waterInletDisplay = Math.round(displayTemp(inputs.waterInletTemp, tempUnit));
  const waterRiseDisplay = Math.round(displayDelta(inputs.waterTempRise, tempUnit));
  const waterOutletC = inputs.waterInletTemp + inputs.waterTempRise;

  return (
    <div className="container mx-auto max-w-6xl px-4 py-10">
      <nav className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-8">
        <Link href="/tools" className="hover:text-foreground transition-colors">
          Tools
        </Link>
        <span>/</span>
        <span className="text-foreground/60">PUE Calculator</span>
      </nav>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            PUE Calculator
          </h1>
          <p className="text-muted-foreground max-w-2xl">
            Estimate your facility&apos;s Power Usage Effectiveness using 20-year
            climatological weather data. Select a location, configure your
            equipment, and compare against industry benchmarks.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <SavedModelsDrawer
            currentInputs={{ ...inputs, tempUnit }}
            onLoad={handleLoadModel}
          />
          <UnitToggle unit={tempUnit} onChange={setTempUnit} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        {/* ── Left: Configuration Panel ── */}
        <div className="space-y-4">
          {/* Location */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Location</CardTitle>
              <CardDescription>
                TMY3 typical-year hourly weather (8,760 h) — {stations.length || "…"} US stations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LocationSelect
                value={inputs.stationId}
                onChange={(id) => update("stationId", id)}
                stations={stations}
              />
              {station && (
                <p className="mt-2 text-xs text-muted-foreground font-mono">
                  {station.lat.toFixed(2)}&deg;N, {Math.abs(station.lon).toFixed(2)}&deg;
                  {station.lon < 0 ? "W" : "E"} · {station.elevationM} m · USAF {station.usaf}
                </p>
              )}
            </CardContent>
          </Card>

          {/* IT Equipment */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">IT Equipment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Preset</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.values(IT_PRESETS).map((p) => (
                    <button
                      key={p.preset}
                      className={`px-2 py-1.5 text-xs rounded border transition-colors ${
                        inputs.itLoadKW === p.totalKW &&
                        inputs.kwPerRack === p.kwPerRack
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-accent"
                      }`}
                      onClick={() => applyITPreset(p.preset)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <NumberInput
                label="Total IT Load"
                value={inputs.itLoadKW}
                onChange={(v) => update("itLoadKW", v)}
                unit="kW"
                min={1}
                step={10}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  label="Per Rack"
                  value={inputs.kwPerRack}
                  onChange={(v) => update("kwPerRack", v)}
                  unit="kW"
                  min={1}
                  step={1}
                />
                <NumberInput
                  label="Rack Count"
                  value={inputs.rackCount}
                  onChange={(v) => update("rackCount", v)}
                  min={1}
                  step={1}
                />
              </div>
            </CardContent>
          </Card>

          {/* Heat Rejection Split */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Heat Rejection Split</CardTitle>
              <CardDescription>
                Air and liquid fractions can exceed 100% total to account for
                supplemental loads
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  label="Air Cooling"
                  value={inputs.airCoolingPct}
                  onChange={(v) => update("airCoolingPct", v)}
                  unit="% IT"
                  min={0}
                  max={150}
                  step={5}
                />
                <NumberInput
                  label="Liquid Cooling"
                  value={inputs.liquidCoolingPct}
                  onChange={(v) => update("liquidCoolingPct", v)}
                  unit="% IT"
                  min={0}
                  max={150}
                  step={5}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
                <span>
                  Total: {inputs.airCoolingPct + inputs.liquidCoolingPct}% of IT load
                </span>
                {inputs.airCoolingPct + inputs.liquidCoolingPct < 100 && (
                  <span className="text-orange-500">Below 100%</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Air-Side Cooling */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Air-Side Cooling</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SelectInput<CoolingType>
                label="Cooling Type"
                value={inputs.coolingType}
                onChange={(v) => update("coolingType", v)}
                options={Object.values(COOLING_SYSTEMS).map((c) => ({
                  value: c.type,
                  label: c.label,
                }))}
              />
              <p className="text-xs text-muted-foreground">
                {COOLING_SYSTEMS[inputs.coolingType].description}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  label="Supply Air"
                  value={supplyDisplay}
                  onChange={(v) =>
                    update("supplyAirTemp", Math.round(inputToC(v, tempUnit)))
                  }
                  unit={`\u00B0${tempUnit}`}
                  min={tempUnit === "C" ? 10 : 50}
                  max={tempUnit === "C" ? 30 : 86}
                />
                <NumberInput
                  label={`Temp Rise (\u0394T)`}
                  value={airRiseDisplay}
                  onChange={(v) =>
                    update("temperatureRise", Math.round(inputDeltaToC(v, tempUnit)))
                  }
                  unit={`\u00B0${tempUnit}`}
                  min={tempUnit === "C" ? 3 : 5}
                  max={tempUnit === "C" ? 30 : 54}
                />
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                Return air: {formatTemp(returnAirC, tempUnit, 0)}
              </p>
            </CardContent>
          </Card>

          {/* Liquid-Side Cooling — only shown when liquidCoolingPct > 0 */}
          {hasLiquid && (
            <Card className="border-indigo-500/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Direct-to-Chip Liquid Cooling
                </CardTitle>
                <CardDescription>
                  Warm-water cold plates with dry cooler / trim chiller heat rejection
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput
                    label="Water Inlet"
                    value={waterInletDisplay}
                    onChange={(v) =>
                      update("waterInletTemp", Math.round(inputToC(v, tempUnit)))
                    }
                    unit={`\u00B0${tempUnit}`}
                    min={tempUnit === "C" ? 15 : 59}
                    max={tempUnit === "C" ? 50 : 122}
                  />
                  <NumberInput
                    label={`Temp Rise (\u0394T)`}
                    value={waterRiseDisplay}
                    onChange={(v) =>
                      update("waterTempRise", Math.round(inputDeltaToC(v, tempUnit)))
                    }
                    unit={`\u00B0${tempUnit}`}
                    min={tempUnit === "C" ? 3 : 5}
                    max={tempUnit === "C" ? 25 : 45}
                  />
                </div>
                <div className="space-y-1 text-xs text-muted-foreground font-mono">
                  <p>Water outlet: {formatTemp(waterOutletC, tempUnit, 0)}</p>
                  {result && (
                    <p>
                      Flow rate: {formatFlow(result.waterFlowLPM)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Power Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Power Distribution</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <SelectInput<UPSType>
                label="UPS Type"
                value={inputs.upsType}
                onChange={(v) => update("upsType", v)}
                options={Object.values(UPS_CONFIGS).map((u) => ({
                  value: u.type,
                  label: u.label,
                }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberInput
                  label="PDU Loss"
                  value={inputs.pduLossPct}
                  onChange={(v) => update("pduLossPct", v)}
                  unit="%"
                  min={0}
                  max={10}
                  step={0.5}
                />
                <NumberInput
                  label="Lighting & Misc"
                  value={inputs.lightingPct}
                  onChange={(v) => update("lightingPct", v)}
                  unit="%"
                  min={0}
                  max={10}
                  step={0.5}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Results Panel ── */}
        <div className="space-y-4">
          {loading && (
            <Card>
              <CardContent className="py-12 text-center">
                <div className="inline-block h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm text-muted-foreground">
                  Fetching weather data for {station?.name}...
                </p>
              </CardContent>
            </Card>
          )}

          {error && (
            <Card className="border-destructive/50">
              <CardContent className="py-6">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => station && fetchWeather(station)}
                >
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}

          {result && rating && !loading && (
            <>
              {/* Annual PUE Hero */}
              <Card>
                <CardContent className="py-8">
                  <div className="flex flex-col sm:flex-row items-center gap-6">
                    <div className="text-center">
                      <div className={`text-6xl font-bold font-mono tracking-tighter ${rating.color}`}>
                        {result.annualPUE.toFixed(2)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        Annual PUE
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className={`text-lg font-semibold ${rating.color}`}>
                        {rating.label}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {rating.description}
                      </p>
                      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                        <span>
                          Best: <strong className="text-foreground">{result.bestMonth.pue.toFixed(2)}</strong>{" "}
                          ({MONTH_LABELS[result.bestMonth.month]})
                        </span>
                        <span>
                          Worst: <strong className="text-foreground">{result.worstMonth.pue.toFixed(2)}</strong>{" "}
                          ({MONTH_LABELS[result.worstMonth.month]})
                        </span>
                        {hasLiquid && (
                          <span>
                            Flow: <strong className="text-foreground">{formatFlow(result.waterFlowLPM)}</strong>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tab navigation */}
              <div className="flex gap-1 border-b">
                {(
                  [
                    { key: "chart", label: "Monthly PUE" },
                    { key: "table", label: "Weather Data" },
                    { key: "psychro", label: "Psychrometric" },
                    { key: "power", label: "Power Breakdown" },
                    { key: "liquid", label: "Liquid Cooling" },
                    { key: "benchmark", label: "Benchmarks" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.key}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === tab.key
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <Card>
                <CardContent className="pt-6">
                  {activeTab === "chart" && <MonthlyChart result={result} />}
                  {activeTab === "table" && (
                    <WeatherTable
                      result={result}
                      unit={tempUnit}
                      hasLiquid={hasLiquid}
                    />
                  )}
                  {activeTab === "psychro" && (
                    <PsychrometricChart hourly={hourly} unit={tempUnit} />
                  )}
                  {activeTab === "power" && (
                    <PowerBreakdown result={result} hasLiquid={hasLiquid} />
                  )}
                  {activeTab === "liquid" && (
                    <LiquidCoolingTab hourly={hourly} unit={tempUnit} />
                  )}
                  {activeTab === "benchmark" && (
                    <BenchmarkComparison annualPUE={result.annualPUE} />
                  )}
                </CardContent>
              </Card>

              <p className="text-[11px] text-muted-foreground/60 text-center">
                Weather: TMY3 typical-year hourly data (8,760 h) via EPW; monthly values
                derived from the hourly series. ASHRAE 2017 psychrometrics. PUE estimates are
                for planning purposes only.
              </p>

              {/* Engagement CTA */}
              <Card className="bg-muted/40">
                <CardContent className="py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold mb-1">
                      Need a expert, PE-stamped assessment of these numbers?
                    </p>
                    <p className="text-sm text-muted-foreground">
                      I provide independent PUE, efficiency, and life-cycle analysis as a
                      formal engineering report — for owners, operators, and lenders.
                    </p>
                  </div>
                  <Button asChild className="shrink-0">
                    <Link
                      href="/contact?engagement=sustainability"
                      data-umami-event="cta-consulting-pue"
                    >
                      Work with me
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
