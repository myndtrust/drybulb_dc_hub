import { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { constructMetadata } from "@/lib/metadata";
import { articles } from "@/.velite";

export const metadata: Metadata = constructMetadata({
  title: "Drybulb — AI Factory Engineering, by the Engineers Who Build Them",
  description:
    "Deep technical writing on AI factory design, data center power systems, liquid cooling, and high-density infrastructure — plus practical tools for the engineers who build them.",
  canonicalPath: "/",
});

export default function HomePage() {
  const published = articles
    .filter((a) => !a.draft)
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

  const cornerstone = published.find((a) => a.slug === "ai-factory-design");
  const latestPosts = published.slice(0, 4);

  return (
    <>
      {/* Hero */}
      <section className="container mx-auto max-w-5xl px-4 py-24 md:py-32">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 mb-8 flex-wrap">
            <Badge variant="outline" className="text-xs font-mono">
              Power systems
            </Badge>
            <Badge variant="outline" className="text-xs font-mono">
              Liquid cooling
            </Badge>
            <Badge variant="outline" className="text-xs font-mono">
              AI factory design
            </Badge>
            <Badge variant="outline" className="text-xs font-mono">
              Open tools
            </Badge>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
            AI factory engineering, by the engineers who build them.
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed mb-10 max-w-2xl">
            Drybulb publishes rigorous technical writing on AI infrastructure
            — power systems, liquid cooling, networking, reliability, and
            sustainability — alongside a growing library of practical
            engineering tools. Written for the owners, investors, and
            engineering teams making high-stakes infrastructure decisions.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button asChild size="lg">
              <Link href="/writing">Read the latest</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/tools">Explore tools</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Latest posts */}
      <section className="border-t border-border/60 py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <h2 className="text-2xl font-bold">Latest articles</h2>
            <Link
              href="/writing"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              All articles →
            </Link>
          </div>
          <div className="divide-y divide-border/60">
            {latestPosts.map((article) => (
              <Link
                key={article.slug}
                href={article.url}
                className="group block py-6 first:pt-0"
              >
                <div className="flex flex-wrap gap-2 mb-2">
                  {article.tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="text-xs font-mono text-muted-foreground border border-border/60 rounded px-2 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <h3 className="text-lg font-semibold mb-1 group-hover:text-foreground/80 transition-colors">
                  {article.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
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
                      <span>&middot;</span>
                      <span>{article.readingTime} min read</span>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured cornerstone article */}
      {cornerstone && (
        <section className="border-t border-border/60 py-16">
          <div className="container mx-auto max-w-5xl px-4">
            <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-6">
              Cornerstone article
            </h2>
            <Link href={cornerstone.url} className="group block">
              <div className="rounded-lg border border-border/60 p-8 hover:border-border transition-colors">
                <div className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-widest">
                  Engineering overview
                </div>
                <h3 className="text-xl font-semibold mb-3 group-hover:text-foreground/80 transition-colors">
                  {cornerstone.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">
                  {cornerstone.description}
                </p>
              </div>
            </Link>
          </div>
        </section>
      )}

      {/* Tools teaser */}
      <section className="border-t border-border/60 py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold mb-2">Engineering tools</h2>
              <p className="text-sm text-muted-foreground max-w-xl">
                Free, open tools for data center and AI infrastructure
                engineers. Starting with a PUE calculator — more on the way.
              </p>
            </div>
            <Link
              href="/tools"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Browse all tools →
            </Link>
          </div>
          <div className="rounded-lg border border-border/60 p-6">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-base font-semibold">PUE Calculator</h3>
              <Badge variant="outline" className="text-xs font-mono">
                Beta
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Estimate Power Usage Effectiveness from IT load, cooling, and
              overhead inputs. Compare against industry benchmarks for
              traditional and AI-dense facilities.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
