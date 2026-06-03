"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Job, JobCategory } from "@/lib/jobs";

// Quick-filter categories. "Other" is excluded at the scraper level, so it never
// appears here.
const CATEGORIES: JobCategory[] = [
  "Facilities/Ops",
  "Engineering/Design",
  "Construction/Cx",
  "Network/Hardware",
];

// Per-category badge accent. DC categories get color; "Other" stays muted.
const CATEGORY_BADGE: Record<JobCategory, string> = {
  "Facilities/Ops": "border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "Engineering/Design": "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Construction/Cx": "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "Network/Hardware": "border-transparent bg-violet-500/15 text-violet-600 dark:text-violet-400",
  Other: "border-border/60 bg-transparent text-muted-foreground",
};

const selectClass =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const ALL = "All";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function JobsBoard({ jobs }: { jobs: Job[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<JobCategory | typeof ALL>(ALL);
  const [market, setMarket] = useState<string>(ALL);
  const [company, setCompany] = useState<string>(ALL);

  const markets = useMemo(() => uniqueSorted(jobs.map((j) => j.normalized_market)), [jobs]);
  const companies = useMemo(() => uniqueSorted(jobs.map((j) => j.company)), [jobs]);

  // Count per category for the quick-filter chips (over the full dataset).
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of jobs) counts.set(j.category, (counts.get(j.category) ?? 0) + 1);
    return counts;
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (category !== ALL && j.category !== category) return false;
      if (market !== ALL && j.normalized_market !== market) return false;
      if (company !== ALL && j.company !== company) return false;
      if (q) {
        const haystack = `${j.title} ${j.company} ${j.raw_location}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [jobs, query, category, market, company]);

  const hasActiveFilters = query !== "" || category !== ALL || market !== ALL || company !== ALL;

  function reset() {
    setQuery("");
    setCategory(ALL);
    setMarket(ALL);
    setCompany(ALL);
  }

  return (
    <div>
      {/* Category quick-filter chips */}
      <div className="flex flex-wrap gap-2 mb-6">
        <CategoryChip
          label={`All (${jobs.length})`}
          active={category === ALL}
          onClick={() => setCategory(ALL)}
        />
        {CATEGORIES.map((c) => (
          <CategoryChip
            key={c}
            label={`${c} (${categoryCounts.get(c) ?? 0})`}
            active={category === c}
            onClick={() => setCategory(c)}
          />
        ))}
      </div>

      {/* Search + facet selects */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, company, location…"
          aria-label="Search jobs"
          className={cn(selectClass, "flex-1 min-w-0")}
        />
        <label className="sr-only" htmlFor="market-filter">
          Filter by market
        </label>
        <select
          id="market-filter"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          className={selectClass}
        >
          <option value={ALL}>All markets</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="company-filter">
          Filter by company
        </label>
        <select
          id="company-filter"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className={selectClass}
        >
          <option value={ALL}>All companies</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Result count + reset */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
          {filtered.length} {filtered.length === 1 ? "role" : "roles"}
        </p>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={reset}>
            Reset filters
          </Button>
        )}
      </div>

      {/* Listings */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {jobs.length === 0
              ? "No jobs published yet. Run the scraper to populate the feed."
              : "No roles match your filters."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {filtered.map((job) => (
            <li key={`${job.ats_source}-${job.job_id}`}>
              {/* Links to the on-site detail page. Slug built inline so this client
                  component doesn't import lib/jobs (which pulls node:fs). */}
              <Link
                href={`/jobs/${job.ats_source}-${job.job_id}`}
                className="group block py-5"
              >
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <Badge className={cn("text-xs font-mono", CATEGORY_BADGE[job.category])}>
                    {job.category}
                  </Badge>
                  {job.normalized_market !== "Other" && (
                    <Badge variant="outline" className="text-xs font-mono">
                      {job.normalized_market}
                    </Badge>
                  )}
                </div>
                <h3 className="text-base font-semibold group-hover:text-foreground/80 transition-colors">
                  {job.title}
                </h3>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground font-mono mt-1">
                  <span className="text-foreground/80">{job.company}</span>
                  {job.raw_location && (
                    <>
                      <span>&middot;</span>
                      <span>{job.raw_location}</span>
                    </>
                  )}
                  <span>&middot;</span>
                  <span className="capitalize">{job.ats_source}</span>
                </div>
                {job.description_snippet && (
                  <p className="text-sm text-muted-foreground leading-relaxed mt-2 line-clamp-2">
                    {job.description_snippet}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-mono transition-colors",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border/60 text-muted-foreground hover:text-foreground hover:border-border",
      )}
    >
      {label}
    </button>
  );
}
