"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  type HeatRejection,
  type LiquidFamily,
  freeCoolingProfile,
  isWetBulbLimited,
  liquidClasses,
} from "@/lib/pue/liquid-cooling";
import type { HourlyWeather } from "@/lib/pue/types";

const cToF = (c: number) => c * 1.8 + 32;
const tLabel = (c: number, unit: "C" | "F") => (unit === "F" ? `${Math.round(cToF(c))}°F` : `${c}°C`);

export function LiquidCoolingTab({
  hourly,
  unit,
}: {
  hourly: HourlyWeather | null;
  unit: "C" | "F";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [family, setFamily] = useState<LiquidFamily>("W");
  const [classKey, setClassKey] = useState("W27");
  const [rejection, setRejection] = useState<HeatRejection>("cooling-tower");
  const [approachC, setApproachC] = useState(6);
  const [size, setSize] = useState({ w: 720, h: 440 });

  const classes = liquidClasses(family);
  const supplyMaxC = classes.find((c) => c.key === classKey)?.supplyMaxC ?? 27;

  const profile = useMemo(() => {
    if (!hourly) return null;
    return freeCoolingProfile(hourly, { supplyMaxC, rejection, approachC });
  }, [hourly, supplyMaxC, rejection, approachC]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setSize({ w, h: Math.max(420, Math.round(w * 0.46)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (canvasRef.current && profile) drawDuration(canvasRef.current, size, profile, unit, classKey);
  }, [size, profile, unit, classKey]);

  function switchFamily(f: LiquidFamily) {
    setFamily(f);
    setClassKey(liquidClasses(f)[1].key);
  }

  if (!hourly) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-6 py-10 text-center">
        <p className="text-sm font-medium">Hourly weather isn&apos;t available for this location yet.</p>
        <p className="text-sm text-muted-foreground mt-1">
          The free-cooling model needs an 8,760-hour TMY3 dataset. Pick a TMY3 station or upload your own.
        </p>
      </div>
    );
  }

  const freePct = profile ? Math.round(profile.freeFraction * 100) : 0;
  const freeHrs = profile ? Math.round(profile.freeFraction * 8760) : 0;

  return (
    <div className="space-y-5">
      {/* controls — single row above the full-width chart */}
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <Control label="Cooling loop">
          <Segment
            options={[
              { v: "W", label: "FWS · W-class" },
              { v: "S", label: "TCS · S-class" },
            ]}
            value={family}
            onChange={(v) => switchFamily(v as LiquidFamily)}
          />
        </Control>

        <Control label={family === "W" ? "Facility water supply (FWS)" : "Technology cooling supply (TCS)"}>
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c) => (
              <button
                key={c.key}
                onClick={() => setClassKey(c.key)}
                className={`rounded-md border px-2.5 py-1.5 text-sm min-w-[64px] text-center ${
                  c.key === classKey
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-input"
                }`}
              >
                {c.key}
                <span className="block text-[10px] opacity-70">≤ {tLabel(c.supplyMaxC, unit)}</span>
              </button>
            ))}
          </div>
        </Control>

        <Control label="Heat rejection">
          <Segment
            options={[
              { v: "cooling-tower", label: "Cooling tower (wet-bulb)" },
              { v: "dry-cooler", label: "Dry cooler (dry-bulb)" },
            ]}
            value={rejection}
            onChange={(v) => setRejection(v as HeatRejection)}
          />
        </Control>

        <Control label={`Approach ΔT — ${approachC}°C`}>
          <input
            type="range"
            min={2}
            max={12}
            step={1}
            value={approachC}
            onChange={(e) => setApproachC(Number(e.target.value))}
            className="w-44"
          />
        </Control>
      </div>

      {/* full-width chart */}
      <div ref={wrapRef} className="rounded-lg border border-border/60 overflow-hidden">
        <canvas ref={canvasRef} className="block w-full" />
      </div>

      {/* stat cards */}
      <div className="flex flex-wrap gap-3">
        <div className="rounded-lg border border-border/60 px-4 py-3 min-w-[150px]">
          <div className="text-2xl font-bold text-green-600 tabular-nums">{freePct}%</div>
          <div className="text-[11px] text-muted-foreground">Free-cooling hours / yr</div>
        </div>
        <div className="rounded-lg border border-border/60 px-4 py-3 min-w-[150px]">
          <div className="text-2xl font-bold tabular-nums">{freeHrs.toLocaleString()}</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-green-600" /> Free-cooling h/yr
          </div>
        </div>
        <div className="rounded-lg border border-border/60 px-4 py-3 min-w-[150px]">
          <div className="text-2xl font-bold tabular-nums">{(8760 - freeHrs).toLocaleString()}</div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Mechanical (chiller) h/yr
          </div>
        </div>
      </div>

      {/* how to read */}
      <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl">
        <span className="font-medium text-foreground">How to read this:</span> the{" "}
        <span className="font-medium text-foreground">black curve</span> is the year&apos;s achievable
        supply-water temperature, sorted warmest → coolest — a load-duration curve (e.g. the left edge is
        the single hottest hour, the right edge the coolest). The{" "}
        <span className="text-red-500 font-medium">red dashed line</span> is the selected class&apos;s
        maximum supply temperature. Every hour where the curve sits{" "}
        <span className="text-green-600 font-medium">below that line</span> (the green band) can be served
        by <span className="font-medium text-foreground">free cooling</span> — no chiller. Free cooling
        works whenever (outdoor {isWetBulbLimited(rejection) ? "wet-bulb" : "dry-bulb"} + approach ΔT) ≤
        the class limit. Cooling energy / pPUE will attach from the ASHRAE-90.4 engine.
      </p>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      {children}
    </div>
  );
}

function Segment({
  options,
  value,
  onChange,
}: {
  options: { v: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-md border border-input overflow-hidden text-sm">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`px-3 py-1.5 ${value === o.v ? "bg-primary text-primary-foreground" : "bg-background"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function drawDuration(
  canvas: HTMLCanvasElement,
  size: { w: number; h: number },
  profile: ReturnType<typeof freeCoolingProfile>,
  unit: "C" | "F",
  classKey: string,
) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size.w * dpr;
  canvas.height = size.h * dpr;
  canvas.style.height = `${size.h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const M = { l: 46, r: 16, t: 14, b: 40 };
  const plotW = size.w - M.l - M.r;
  const plotH = size.h - M.t - M.b;
  const curve = profile.durationCurveC;
  const supply = profile.supplyMaxC;
  const dispT = (t: number) => (unit === "F" ? t * 1.8 + 32 : t);

  let yMin = supply;
  let yMax = supply;
  for (let i = 0; i < curve.length; i++) {
    if (curve[i] < yMin) yMin = curve[i];
    if (curve[i] > yMax) yMax = curve[i];
  }
  yMin -= 3;
  yMax += 3;
  const mapX = (p: number) => M.l + p * plotW;
  const mapY = (t: number) => M.t + plotH - ((t - yMin) / (yMax - yMin)) * plotH;

  ctx.clearRect(0, 0, size.w, size.h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(M.l, M.t, plotW, plotH);

  ctx.font = "11px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  const ystep = yMax - yMin > 40 ? 10 : 5;
  for (let t = Math.ceil(yMin / ystep) * ystep; t <= yMax; t += ystep) {
    const y = mapY(t);
    ctx.strokeStyle = "#eef0f2";
    ctx.beginPath();
    ctx.moveTo(M.l, y);
    ctx.lineTo(M.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.fillText(String(Math.round(dispT(t))), M.l - 8, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let p = 0; p <= 100; p += 20) {
    ctx.fillStyle = "#9ca3af";
    ctx.fillText(`${p}%`, mapX(p / 100), M.t + plotH + 7);
  }
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillText("% of year exceeding", M.l + plotW / 2, M.t + plotH + 22);
  ctx.save();
  ctx.translate(13, M.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`Achievable supply water (°${unit})`, 0, 0);
  ctx.restore();

  // shade free-cooling region (below supply line)
  const supY = mapY(supply);
  ctx.fillStyle = "rgba(22,163,74,0.10)";
  ctx.fillRect(M.l, supY, plotW, M.t + plotH - supY);

  // duration curve
  ctx.beginPath();
  for (let i = 0; i < curve.length; i++) {
    const x = mapX(i / (curve.length - 1));
    const y = mapY(curve[i]);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.strokeStyle = "#111113";
  ctx.lineWidth = 2;
  ctx.stroke();

  // supply threshold
  ctx.strokeStyle = "#ef4444";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(M.l, supY);
  ctx.lineTo(M.l + plotW, supY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ef4444";
  ctx.font = "600 11px ui-sans-serif, system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(`${classKey} supply ≤ ${Math.round(dispT(supply))}°${unit}`, M.l + 6, supY - 3);
  ctx.fillStyle = "#16a34a";
  ctx.textBaseline = "top";
  ctx.fillText(`free cooling — ${Math.round(profile.freeFraction * 100)}% of hours`, M.l + 6, supY + 5);

  ctx.strokeStyle = "#e5e7eb";
  ctx.strokeRect(M.l, M.t, plotW, plotH);

  ctx.save();
  ctx.font = "600 13px ui-sans-serif, system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(17,17,19,0.14)";
  ctx.fillText("drybulb.com", M.l + plotW - 8, M.t + plotH - 7);
  ctx.restore();
}
