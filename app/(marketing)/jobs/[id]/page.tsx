import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { constructMetadata, siteConfig } from "@/lib/metadata";
import { getJob, getJobs, type Job, type JobCategory } from "@/lib/jobs";
import { jobSlug } from "@/lib/job-slug";
import { JsonLd } from "@/components/shared/json-ld";

// ISR: regenerate detail pages at most every 5 minutes alongside the feed.
export const revalidate = 300;

// Pre-render a page for every job in the current feed. On hosts where the feed
// isn't available at build time, this returns [] and pages render on-demand (ISR).
export async function generateStaticParams() {
  const jobs = await getJobs();
  return jobs.map((job) => ({ id: jobSlug(job) }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return constructMetadata({ title: "Job not found", noIndex: true });
  return constructMetadata({
    title: `${job.title} — ${job.company}`,
    description:
      job.description_snippet ||
      `${job.title} at ${job.company}${job.raw_location ? ` · ${job.raw_location}` : ""}.`,
    canonicalPath: `/jobs/${id}`,
  });
}

const CATEGORY_BADGE: Record<JobCategory, string> = {
  "Facilities/Ops": "border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "Engineering/Design": "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Construction/Cx": "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "Network/Hardware": "border-transparent bg-violet-500/15 text-violet-600 dark:text-violet-400",
  Other: "border-border/60 bg-transparent text-muted-foreground",
};

// Tailwind child-selector styling for the sanitized description HTML (no typography plugin).
const PROSE = cn(
  "text-sm text-muted-foreground",
  "[&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-8 [&_h2]:mb-2",
  "[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-6 [&_h3]:mb-2",
  "[&_h4]:font-semibold [&_h4]:text-foreground [&_h4]:mt-4 [&_h4]:mb-1",
  "[&_p]:leading-relaxed [&_p]:mb-4",
  "[&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul]:space-y-1.5",
  "[&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:mb-4 [&_ol]:space-y-1.5",
  "[&_li]:leading-relaxed",
  "[&_strong]:font-semibold [&_strong]:text-foreground/90 [&_b]:font-semibold",
  "[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-foreground/70",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:italic",
);

// JobPosting structured data (Google for Jobs + AI ingestion). These are
// third-party aggregated listings, represented honestly with a link to the
// original ATS posting. Location is best-effort from the raw location string.
function jobPostingLd(job: Job, id: string): Record<string, unknown> {
  const loc = job.raw_location?.trim();
  const remote = loc ? /remote|anywhere|distributed/i.test(loc) : false;
  const location = remote
    ? {
        jobLocationType: "TELECOMMUTE",
        applicantLocationRequirements: { "@type": "Country", name: "United States" },
      }
    : {
        jobLocation: {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            ...(loc ? { addressLocality: loc } : {}),
            addressCountry: "US",
          },
        },
      };

  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: job.description_html || job.description_snippet || `${job.title} at ${job.company}.`,
    datePosted: job.scraped_at,
    hiringOrganization: { "@type": "Organization", name: job.company },
    directApply: false,
    url: `${siteConfig.url}/jobs/${id}`,
    ...location,
  };
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();

  const applyButton = (
    <Button asChild size="lg">
      <a href={job.original_url} target="_blank" rel="noopener noreferrer">
        View original posting ↗
      </a>
    </Button>
  );

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <JsonLd data={jobPostingLd(job, id)} />
      <Link
        href="/jobs"
        className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
      >
        ← All jobs
      </Link>

      {/* Header */}
      <div className="mt-6 mb-8">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Badge className={cn("text-xs font-mono", CATEGORY_BADGE[job.category])}>
            {job.category}
          </Badge>
          {job.normalized_market !== "Other" && (
            <Badge variant="outline" className="text-xs font-mono">
              {job.normalized_market}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs font-mono capitalize">
            {job.ats_source}
          </Badge>
        </div>

        <h1 className="text-3xl font-bold tracking-tight mb-3">{job.title}</h1>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground font-mono">
          <span className="text-foreground/80">{job.company}</span>
          {job.raw_location && (
            <>
              <span>&middot;</span>
              <span>{job.raw_location}</span>
            </>
          )}
        </div>
      </div>

      {/* Primary apply CTA */}
      <div className="mb-10">{applyButton}</div>

      {/* Full listing */}
      <article>
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-4">
          Job description
        </h2>
        {job.description_html ? (
          // Sanitized at scrape time (formatting-only allowlist) — safe to render.
          <div className={PROSE} dangerouslySetInnerHTML={{ __html: job.description_html }} />
        ) : (
          <p className="text-sm text-muted-foreground">
            No description was captured for this role. Use the link below to view the full
            posting on {job.company}&apos;s site.
          </p>
        )}
      </article>

      {/* Footer apply CTA + provenance */}
      <div className="mt-12 pt-8 border-t border-border/60 flex flex-col gap-4">
        {applyButton}
        <p className="text-xs text-muted-foreground font-mono">
          Aggregated from {job.company}&apos;s public {job.ats_source} board · last refreshed{" "}
          {new Date(job.scraped_at).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
    </div>
  );
}
