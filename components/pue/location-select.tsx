"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { TmyStation } from "@/lib/pue/types";

// Searchable city picker over the TMY3 station index, with data-center markets
// pinned at the top. Shared by the PUE calculator and the cost model.
export function LocationSelect({
  value,
  onChange,
  stations,
}: {
  value: string;
  onChange: (usaf: string) => void;
  stations: TmyStation[];
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = stations.find((s) => s.usaf === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? stations.filter((s) => `${s.name} ${s.state}`.toLowerCase().includes(q))
      : stations;
  }, [query, stations]);

  // Featured "Data center markets" group is pinned at the top (no query only).
  const grouped = useMemo(() => {
    const map = new Map<string, TmyStation[]>();
    if (!query) {
      const featured = filtered.filter((s) => s.dcMarket);
      if (featured.length) map.set("Data center markets", featured);
    }
    const rest = query ? filtered : filtered.filter((s) => !s.dcMarket);
    const sorted = [...rest].sort(
      (a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name),
    );
    for (const s of sorted) {
      const key = query ? "Results" : s.state;
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [filtered, query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={wrapperRef} className="relative">
      <label className="block text-sm font-medium mb-1.5">Location</label>
      <div
        className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 cursor-pointer"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {!open && selected ? (
          <span className="text-sm">
            {selected.name}, {selected.state}
            {selected.dcMarket && (
              <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary/60 bg-primary/5 px-1.5 py-0.5 rounded">
                DC Market
              </span>
            )}
          </span>
        ) : (
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="Search city, state, or abbreviation..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        )}
        <svg className="h-4 w-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-border bg-popover shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              No locations found
            </div>
          ) : (
            Array.from(grouped.entries()).map(([state, stations]) => (
              <div key={state}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 sticky top-0">
                  {state}
                </div>
                {stations.map((s) => (
                  <button
                    key={s.usaf}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center justify-between ${
                      s.usaf === value ? "bg-accent/50 font-medium" : ""
                    }`}
                    onClick={() => {
                      onChange(s.usaf);
                      setQuery("");
                      setOpen(false);
                    }}
                  >
                    <span>{s.name}, {s.state}</span>
                    {s.dcMarket && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-primary/50">
                        DC Market
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
