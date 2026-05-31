import { Metadata } from "next";
import Link from "next/link";
import { articles } from "@/.velite";
import { constructMetadata } from "@/lib/metadata";

export const metadata: Metadata = constructMetadata({
  title: "Writing",
  description:
    "Technical writing on AI factory design, data center engineering, power systems, and liquid cooling.",
  canonicalPath: "/writing",
});

export default function WritingIndexPage() {
  const published = articles
    .filter((a) => !a.draft)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
        Writing
      </p>
      <h1 className="text-4xl font-bold tracking-tight mb-12">Technical articles</h1>
      <div className="divide-y divide-border/60">
        {published.map((article) => (
          <Link key={article.slug} href={article.url} className="group block py-8 first:pt-0">
            <div className="flex flex-wrap gap-2 mb-3">
              {article.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-xs font-mono text-muted-foreground border border-border/60 rounded px-2 py-0.5"
                >
                  {tag}
                </span>
              ))}
            </div>
            <h2 className="text-xl font-semibold mb-2 group-hover:text-foreground/80 transition-colors">
              {article.title}
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed mb-3">
              {article.description}
            </p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
              <time dateTime={article.publishedAt}>
                {new Date(article.publishedAt).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
              {article.readingTime && (
                <>
                  <span>·</span>
                  <span>{article.readingTime} min read</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
