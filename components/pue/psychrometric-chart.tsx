"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AIR_CLASSES,
  AIR_CLASS_ORDER,
  envelopePolygon,
  hoursWithinEnvelope,
  type AirClassKey,
} from "@/lib/pue/ashrae-classes";
import { P_STD, humidityRatio, satPressurePa } from "@/lib/pue/psychrometrics";
import type { HourlyWeather } from "@/lib/pue/types";

const CLASS_COLOR: Record<AirClassKey, string> = {
  recommended: "#16a34a",
  a1: "#0ea5e9",
  a2: "#8b5cf6",
  a3: "#f59e0b",
  a4: "#ef4444",
  h1: "#db2777",
};

const cToF = (c: number) => c * 1.8 + 32;

export function PsychrometricChart({
  hourly,
  unit,
}: {
  hourly: HourlyWeather | null;
  unit: "C" | "F";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState<Record<AirClassKey, boolean>>({
    recommended: true,
    a1: true,
    a2: false,
    a3: false,
    a4: false,
    h1: false,
  });
  const [size, setSize] = useState({ w: 720, h: 460 });

  // Humidity ratio (g/kg) per hour, at that hour's station pressure.
  const points = useMemo(() => {
    if (!hourly) return null;
    const n = hourly.tdb.length;
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = humidityRatio(hourly.tdb[i], hourly.rh[i], (hourly.p[i] ?? 1013.25) * 100) * 1000;
    }
    return w;
  }, [hourly]);

  const stats = useMemo(() => {
    if (!hourly) return [];
    return AIR_CLASS_ORDER.filter((k) => on[k]).map((k) => ({
      key: k,
      label: AIR_CLASSES[k].label,
      color: CLASS_COLOR[k],
      ...hoursWithinEnvelope(AIR_CLASSES[k], hourly),
    }));
  }, [hourly, on]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      setSize({ w, h: Math.max(380, Math.round(w * 0.62)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hourly || !points) return;
    draw(canvas, size, hourly, points, on, unit);
  }, [size, hourly, points, on, unit]);

  if (!hourly) {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/30 px-6 py-10 text-center">
        <p className="text-sm font-medium">Hourly weather isn&apos;t available for this location yet.</p>
        <p className="text-sm text-muted-foreground mt-1">
          The psychrometric chart needs an 8,760-hour TMY3 dataset. Pick a TMY3 station, or upload
          your own hourly weather.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {AIR_CLASS_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => setOn((p) => ({ ...p, [k]: !p[k] }))}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-opacity ${
              on[k] ? "border-input" : "border-input opacity-45"
            }`}
          >
            <span
              className="h-2.5 w-2.5 rounded-sm border-2"
              style={{
                borderColor: CLASS_COLOR[k],
                background: on[k] ? CLASS_COLOR[k] : "transparent",
              }}
            />
            {AIR_CLASSES[k].label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_200px] gap-4">
        <div ref={wrapRef} className="rounded-lg border border-border/60 overflow-hidden">
          <canvas ref={canvasRef} className="block w-full" />
        </div>
        <div>
          <h3 className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground mb-3">
            Hours within envelope
          </h3>
          {stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">Toggle a class to see its hours.</p>
          ) : (
            <div className="space-y-3">
              {stats.map((s) => (
                <div key={s.key} className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 text-sm">
                    {s.label}
                    <span className="block text-[11px] text-muted-foreground">
                      {s.hours.toLocaleString()} h/yr
                    </span>
                  </span>
                  <span className="font-mono font-semibold text-sm tabular-nums">
                    {Math.round(s.fraction * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
            Of 8,760 annual hours. RH lines &amp; envelopes drawn at sea level; point humidity ratio
            uses each hour&apos;s station pressure.
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed max-w-3xl mt-4">
        <span className="font-medium text-foreground">How to read this:</span> each{" "}
        <span className="font-medium text-foreground">black dot</span> is one of the 8,760 hours of the
        year, placed by its dry-bulb temperature (x-axis) and humidity ratio (y-axis) — denser regions
        are where the climate spends the most hours. The curved grey lines are constant relative-humidity
        lines (10–100%); the darker outer curve is saturation (100% RH). The colored outlines are the
        ASHRAE allowable envelopes — toggle them above, and the side panel shows how many of the 8,760
        hours fall inside each.
      </p>
    </div>
  );
}

// ── Canvas drawing ───────────────────────────────────────────────────────────
function draw(
  canvas: HTMLCanvasElement,
  size: { w: number; h: number },
  hourly: HourlyWeather,
  pointsW: Float64Array,
  on: Record<AirClassKey, boolean>,
  unit: "C" | "F",
) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = size.w * dpr;
  canvas.height = size.h * dpr;
  canvas.style.height = `${size.h}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const M = { l: 52, r: 16, t: 14, b: 42 };
  const plotW = size.w - M.l - M.r;
  const plotH = size.h - M.t - M.b;

  // Axis ranges (dry-bulb adapts to data; humidity ratio fixed).
  let tMin = Infinity;
  let tMax = -Infinity;
  for (let i = 0; i < hourly.tdb.length; i++) {
    if (hourly.tdb[i] < tMin) tMin = hourly.tdb[i];
    if (hourly.tdb[i] > tMax) tMax = hourly.tdb[i];
  }
  const X = { min: Math.min(Math.floor((tMin - 3) / 5) * 5, 0), max: Math.max(Math.ceil((tMax + 3) / 5) * 5, 40) };
  const Y = { min: 0, max: 30 };
  const mapX = (t: number) => M.l + ((t - X.min) / (X.max - X.min)) * plotW;
  const mapY = (w: number) => M.t + plotH - ((w - Y.min) / (Y.max - Y.min)) * plotH;
  const dispT = (t: number) => (unit === "F" ? cToF(t) : t);

  ctx.clearRect(0, 0, size.w, size.h);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(M.l, M.t, plotW, plotH);

  // grid + axes
  ctx.font = "11px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (let w = 0; w <= Y.max; w += 5) {
    const y = mapY(w);
    ctx.strokeStyle = "#eef0f2";
    ctx.beginPath();
    ctx.moveTo(M.l, y);
    ctx.lineTo(M.l + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.fillText(String(w), M.l - 8, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let t = Math.ceil(X.min / 5) * 5; t <= X.max; t += 5) {
    const x = mapX(t);
    ctx.strokeStyle = "#f4f5f6";
    ctx.beginPath();
    ctx.moveTo(x, M.t);
    ctx.lineTo(x, M.t + plotH);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.fillText(String(Math.round(dispT(t))), x, M.t + plotH + 8);
  }
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px ui-sans-serif, system-ui";
  ctx.fillText(`Dry-bulb temperature (°${unit})`, M.l + plotW / 2, M.t + plotH + 24);
  ctx.save();
  ctx.translate(14, M.t + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Humidity ratio (g/kg dry air)", 0, 0);
  ctx.restore();

  // RH curves + saturation (sea-level convention)
  const wAt = (t: number, rh: number) => humidityRatio(t, rh, P_STD) * 1000;
  ctx.lineWidth = 1;
  for (const rh of [10, 20, 30, 40, 50, 60, 70, 80, 90]) {
    ctx.strokeStyle = "#d1d5db";
    ctx.beginPath();
    let started = false;
    for (let t = X.min; t <= X.max; t += 0.5) {
      const w = wAt(t, rh);
      if (w > Y.max + 2) break;
      const x = mapX(t);
      const y = mapY(w);
      started ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (started = true));
    }
    ctx.stroke();
  }
  // saturation (100%)
  ctx.strokeStyle = "#9ca3af";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let s = false;
  for (let t = X.min; t <= X.max; t += 0.5) {
    const w = (satPressurePa(t) > 0 ? humidityRatio(t, 100, P_STD) * 1000 : 0);
    if (w > Y.max + 4) break;
    const x = mapX(t);
    const y = mapY(w);
    s ? ctx.lineTo(x, y) : (ctx.moveTo(x, y), (s = true));
  }
  ctx.stroke();

  // data cloud
  ctx.fillStyle = "rgba(17,17,19,0.16)";
  for (let i = 0; i < hourly.tdb.length; i++) {
    const t = hourly.tdb[i];
    const w = pointsW[i];
    if (t < X.min || t > X.max || w < Y.min || w > Y.max) continue;
    ctx.fillRect(mapX(t) - 1.1, mapY(w) - 1.1, 2.2, 2.2);
  }

  // envelopes
  for (const k of AIR_CLASS_ORDER) {
    if (!on[k]) continue;
    const cls = AIR_CLASSES[k];
    const poly = envelopePolygon(cls, P_STD);
    ctx.beginPath();
    poly.forEach((pt, i) => {
      const x = mapX(pt.tdbC);
      const y = mapY(Math.min(pt.w * 1000, Y.max));
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.closePath();
    const c = CLASS_COLOR[k];
    ctx.fillStyle = hexA(c, 0.08);
    ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.font = "600 11px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(cls.label, mapX(cls.tMinC) + 4, mapY(Math.min(highLabelW(cls), Y.max)) - 3);
  }

  ctx.strokeStyle = "#e5e7eb";
  ctx.strokeRect(M.l, M.t, plotW, plotH);

  // watermark
  ctx.save();
  ctx.font = "600 13px ui-sans-serif, system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "rgba(17,17,19,0.14)";
  ctx.fillText("drybulb.com", M.l + plotW - 8, M.t + plotH - 7);
  ctx.restore();
}

function highLabelW(cls: (typeof AIR_CLASSES)[AirClassKey]): number {
  const poly = envelopePolygon(cls, P_STD, 1);
  return (poly[0]?.w ?? 0) * 1000;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
