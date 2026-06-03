import { constructMetadata } from "@/lib/metadata";
import { getJobs } from "@/lib/jobs";
import { JobsBoard } from "@/components/marketing/jobs-board";

export const metadata = constructMetadata({
  title: "Jobs",
  description:
    "Live datacenter and AI-infrastructure job listings — facilities, engineering, commissioning, and network roles aggregated from hyperscalers, neoclouds, and colocation operators.",
  canonicalPath: "/jobs",
});

// ISR: regenerate the page at most every 5 minutes to pick up fresh scraper runs.
export const revalidate = 300;

export default async function JobsPage() {
  const jobs = await getJobs();

  return (
    <div className="container mx-auto max-w-5xl px-4 py-16">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
        Jobs
      </p>
      <h1 className="text-4xl font-bold tracking-tight mb-4">Datacenter jobs</h1>
      <p className="text-lg text-muted-foreground leading-relaxed mb-12 max-w-2xl">
        Open roles across critical facilities, infrastructure engineering, construction
        &amp; commissioning, and network deployment — aggregated directly from operators&apos;
        public career boards and refreshed regularly.
      </p>

      <JobsBoard jobs={jobs} />
    </div>
  );
}
