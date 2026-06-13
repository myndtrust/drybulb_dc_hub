import { MetadataRoute } from "next";
import { siteConfig } from "@/lib/metadata";
import { articles, authors } from "@/.velite";
import { getJobs } from "@/lib/jobs";
import { jobSlug } from "@/lib/job-slug";

// Refresh the jobs portion of the sitemap on the same cadence as the feed.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteConfig.url;
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/writing`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/consulting`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${base}/tools`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/jobs`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
  ];

  const articleRoutes: MetadataRoute.Sitemap = articles
    .filter((a) => !a.draft)
    .map((a) => ({
      url: `${base}${a.url}`,
      lastModified: new Date(a.updatedAt ?? a.publishedAt),
      changeFrequency: "monthly",
      priority: 0.8,
    }));

  const authorRoutes: MetadataRoute.Sitemap = authors.map((a) => ({
    url: `${base}/authors/${a.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  // Jobs come from a third-party feed; never let an outage break the sitemap.
  let jobRoutes: MetadataRoute.Sitemap = [];
  try {
    const jobs = await getJobs();
    jobRoutes = jobs.map((j) => ({
      url: `${base}/jobs/${jobSlug(j)}`,
      lastModified: new Date(j.scraped_at),
      changeFrequency: "weekly",
      priority: 0.5,
    }));
  } catch {
    // feed unavailable — omit job URLs this build
  }

  return [...staticRoutes, ...articleRoutes, ...authorRoutes, ...jobRoutes];
}
