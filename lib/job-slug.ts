import type { Job } from "./jobs";

/**
 * Stable URL slug for a job detail page: `${ats_source}-${job_id}`.
 *
 * Kept in its own module (with only a type-only import of `Job`, which is erased at
 * build time) so it can be imported by both the server loader and the client board
 * without pulling `node:fs` from `lib/jobs.ts` into the client bundle.
 */
export function jobSlug(job: Pick<Job, "ats_source" | "job_id">): string {
  return `${job.ats_source}-${job.job_id}`;
}
