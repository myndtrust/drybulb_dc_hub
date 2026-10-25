"use client";

// Small presentational pieces shared by the Rackline tabs. Styling follows the
// suite (Tailwind + theme tokens); engineering colours (feeds, hot/cold, status)
// come from the --rl-* tokens in app/globals.css.

import { type ReactNode, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { pct, utilTone } from "@/lib/rackline/format";

export const inputCls =
  "rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Section({ title, children, className }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-2 border-b border-border/60 py-3 last:border-b-0", className)}>
      {title && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>}
      {children}
    </section>
  );
}

export function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: (o: boolean) => void; children: ReactNode }) {
  return (
    <details open={open} onToggle={(e) => onToggle((e.target as HTMLDetailsElement).open)} className="group border-b border-border/60 py-3 last:border-b-0">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

/** Two-column label / control grid. */
export function KV({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 text-sm">{children}</div>;
}

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="text-xs text-muted-foreground">{children}</label>;
}

export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

/**
 * Number field that commits on blur / Enter (not on every keystroke), so one
 * edit is one undo step and half-typed values never reach the model.
 */
export function NumField({
  id, value, onChange, step = "any", min, max, width = "w-24", disabled,
}: {
  id?: string; value: number; onChange: (v: number) => void; step?: number | "any";
  min?: number; max?: number; width?: string; disabled?: boolean;
}) {
  const fmt = (v: number) => String(+(+v).toFixed(4));
  const [text, setText] = useState(fmt(value));
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v) && v !== value) onChange(v);
    else setText(fmt(value));
  };
  return (
    <input
      id={id} type="number" value={text} step={step} min={min} max={max} disabled={disabled}
      onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={cn(inputCls, width, "font-mono tabular-nums")}
    />
  );
}

export function TextField({ id, value, onChange, width = "w-40", label, disabled }: { id?: string; value: string; onChange: (v: string) => void; width?: string; label?: string; disabled?: boolean }) {
  const [text, setText] = useState(value);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setText(value), [value]);
  return (
    <input
      id={id} type="text" value={text} onChange={(e) => setText(e.target.value)}
      aria-label={label} title={label} disabled={disabled}
      onBlur={() => { const t = text.trim(); if (!t) setText(value); else if (t !== value) onChange(t); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className={cn(inputCls, width)}
    />
  );
}

export function Select<T extends string>({
  id, value, onChange, options, width = "w-40",
}: { id?: string; value: T; onChange: (v: T) => void; options: [T, string][]; width?: string }) {
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={cn(inputCls, width)}>
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

/** Small toggle-style button used for tools, segments and panel actions. */
export function Btn({
  on, tone, className, ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; tone?: "primary" | "danger" }) {
  return (
    <button
      type="button"
      {...p}
      className={cn(
        "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45",
        tone === "primary" ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : on ? "border-[var(--rl-accent)] bg-[var(--rl-accent-soft)] text-foreground"
          : "border-input bg-background hover:bg-accent",
        tone === "danger" && "text-destructive",
        className,
      )}
    />
  );
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-input">
      {options.map(([k, l]) => (
        <button
          key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
          className={cn("px-2.5 py-1 text-xs", value === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}
        >{l}</button>
      ))}
    </div>
  );
}

const toneCls = {
  ok: "bg-[var(--rl-ok-soft)] text-[var(--rl-ok)]",
  warn: "bg-[var(--rl-warn-soft)] text-[var(--rl-warn)]",
  bad: "bg-[var(--rl-bad-soft)] text-[var(--rl-bad)]",
  mute: "bg-muted text-muted-foreground",
};

export function Chip({ tone, children }: { tone: keyof typeof toneCls; children: ReactNode }) {
  return <span className={cn("inline-block whitespace-nowrap rounded px-1.5 py-px font-mono text-[11px] tabular-nums", toneCls[tone])}>{children}</span>;
}

/** Utilisation chip: green ≤ 80 %, amber ≤ 100 %, red above. */
export const UtilChip = ({ u, label }: { u: number; label?: string }) => <Chip tone={utilTone(u)}>{label ?? pct(u)}</Chip>;

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="text-[11px] tracking-wide text-muted-foreground">{label}</div>
      <div className="font-mono text-xl tabular-nums">{value}</div>
      {sub && <div className="font-mono text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function Panel({ title, right, children }: { title: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

export function WarnList({ items }: { items: { sev: "bad" | "warn"; msg: string }[] }) {
  if (!items.length) return <Hint><Chip tone="ok">PASS</Chip> No issues found.</Hint>;
  return (
    <ul className="space-y-1">
      {items.map((w, i) => (
        <li key={i} className="flex items-baseline gap-2 text-xs">
          <Chip tone={w.sev}>{w.sev === "bad" ? "FAIL" : "CHECK"}</Chip>
          <span>{w.msg}</span>
        </li>
      ))}
    </ul>
  );
}

/** Data table with sticky header and numeric column alignment. */
export function Table({ head, children, numeric = [] }: { head: ReactNode[]; children: ReactNode; numeric?: number[] }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cn("sticky top-0 whitespace-nowrap border-b bg-card px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", numeric.includes(i) && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-border/50 [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top [&_td.n]:text-right [&_td.n]:font-mono [&_td.n]:tabular-nums">
          {children}
        </tbody>
      </table>
    </div>
  );
}
