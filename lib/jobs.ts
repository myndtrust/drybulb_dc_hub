import { promises as fs } from "node:fs";
import path from "node:path";
import { jobSlug } from "./job-slug";
import { sanitizeJobHtml } from "./sanitize";

/**
 * Datacenter jobs feed loader.
 *
 * The feed is produced by the Python scraper in `scrapers/` and published to a
 * public GCS bucket. The browser-facing site reads it through this server-side
 * loader so the page can be statically generated / ISR-revalidated.
 *
 * Resolution order (resilient by design — the page must render even before the
 * GCS bucket exists):
 *   1. If `NEXT_PUBLIC_JOBS_FEED_URL` is an absolute URL, fetch it (ISR-cached).
 *   2. Otherwise — or if that fetch fails — fall back to the local
 *      `public/data/datacenter_jobs_seed.json` written by a local scraper run.
 *   3. If neither is available, return an empty list (page shows empty state).
 */

export type JobCategory =
  | "Facilities/Ops"
  | "Engineering/Design"
  | "Construction/Cx"
  | "Network/Hardware"
  | "Other";

export type AtsSource = "greenhouse" | "lever" | "workday";

export interface Job {
  job_id: string;
  title: string;
  company: string;
  ats_source: AtsSource;
  original_url: string;
  raw_location: string;
  normalized_market: string;
  category: JobCategory;
  description_snippet: string;
  /** Full description as sanitized, formatting-only HTML (safe to render). */
  description_html: string;
  scraped_at: string;
}

/** DC-relevant categories sort ahead of "Other". */
const CATEGORY_RANK: Record<JobCategory, number> = {
  "Facilities/Ops": 0,
  "Engineering/Design": 1,
  "Construction/Cx": 2,
  "Network/Hardware": 3,
  Other: 4,
};

const LOCAL_PATH = path.join(process.cwd(), "public", "data", "datacenter_jobs_seed.json");

// Revalidate the feed at most every 5 minutes (matches the GCS object cache-control).
const REVALIDATE_SECONDS = 300;

function isAbsoluteUrl(value: string | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

async function fromUrl(url: string): Promise<Job[] | null> {
  try {
    const res = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!res.ok) return null;
    return (await res.json()) as Job[];
  } catch {
    return null;
  }
}

async function fromLocalFile(): Promise<Job[] | null> {
  try {
    const raw = await fs.readFile(LOCAL_PATH, "utf-8");
    return JSON.parse(raw) as Job[];
  } catch {
    return null;
  }
}

/** Load and sort the jobs feed. Never throws; returns [] when nothing is available. */
export async function getJobs(): Promise<Job[]> {
  const url = process.env.NEXT_PUBLIC_JOBS_FEED_URL;
  const jobs = (isAbsoluteUrl(url) ? await fromUrl(url) : null) ?? (await fromLocalFile()) ?? [];

  // Re-sanitize the description HTML at render time — never trust the feed alone.
  for (const job of jobs) job.description_html = sanitizeJobHtml(job.description_html ?? "");

  return jobs.slice().sort((a, b) => {
    const rank = CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
    if (rank !== 0) return rank;
    const company = a.company.localeCompare(b.company);
    if (company !== 0) return company;
    return a.title.localeCompare(b.title);
  });
}

/** Look up a single job by its slug (`${ats_source}-${job_id}`). */
export async function getJob(slug: string): Promise<Job | null> {
  const jobs = await getJobs();
  return jobs.find((job) => jobSlug(job) === slug) ?? null;
}
