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

// Engineer-drawn diagrams from the articles, surfaced on the landing page as a
// proof-of-rigor showcase. Each links to its source article.
type Figure = {
  src: string;
  alt: string;
  caption: string;
  href: string;
  articleTitle: string;
};

const flagshipFigure: Figure = {
  src: "/images/800vdc/fig-1-conversion-stages.svg",
  alt: "Legacy AC versus 800VDC data center power chains from grid to GPU, comparing the number of conversion stages.",
  caption: "Legacy AC vs. 800VDC power chains — grid to GPU",
  href: "/writing/800vdc-power-architecture",
  articleTitle: "The 800VDC Rollout",
};

const selectedFigures: Figure[] = [
  {
    src: "/images/800vdc/fig-2-rack-topologies.svg",
    alt: "Three data center rack power topologies compared — legacy 54V, OCP bipolar ±400V, and NVIDIA monopolar 800V.",
    caption: "Three rack power topologies, one voltage class",
    href: "/writing/800vdc-power-architecture",
    articleTitle: "The 800VDC Rollout",
  },
  {
    src: "/images/bess-project-specific-testing/fig-1-assurance-layers.svg",
    alt: "Three layers of BESS assurance — product certification, vendor self-qualification, and project-specific testing — and the integration gap.",
    caption: "Three layers of BESS assurance — and the gap",
    href: "/writing/bess-project-specific-testing",
    articleTitle: "Project-Specific BESS Testing",
  },
];

function FigureCard({ figure }: { figure: Figure }) {
  return (
    <Link
      href={figure.href}
      className="group block overflow-hidden rounded-lg border border-border/60 hover:border-border transition-colors"
    >
      {/* Fixed light surface so the cream/ink diagrams stay crisp in any theme */}
      <div className="bg-[#fbf8f0] p-4 sm:p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={figure.src} alt={figure.alt} loading="lazy" className="block h-auto w-full" />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
        <p className="text-sm text-muted-foreground">{figure.caption}</p>
        <span className="shrink-0 font-mono text-xs text-muted-foreground group-hover:text-foreground transition-colors">
          {figure.articleTitle} &rarr;
        </span>
      </div>
    </Link>
  );
}

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

      {/* Selected figures — engineer-drawn diagrams from the writing */}
      <section className="border-t border-border/60 py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
                From the writing
              </h2>
              <p className="text-lg text-muted-foreground max-w-2xl">
                Every article is built on first-principles diagrams — drawn, not stock.
              </p>
            </div>
            <Link
              href="/writing"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Read the articles &rarr;
            </Link>
          </div>

          <FigureCard figure={flagshipFigure} />

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {selectedFigures.map((figure) => (
              <FigureCard key={figure.src} figure={figure} />
            ))}
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
                engineers — a climate-based PUE calculator and a build-cost
                model, with more on the way.
              </p>
            </div>
            <Link
              href="/tools"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              Browse all tools →
            </Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Link
              href="/dashboard/tools/pue-calculator"
              className="block rounded-lg border border-border/60 p-6 hover:border-border transition-colors"
            >
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
            </Link>
            <Link
              href="/dashboard/tools/cost-model"
              className="block rounded-lg border border-border/60 p-6 hover:border-border transition-colors"
            >
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-base font-semibold">Data Center Cost Model</h3>
                <Badge variant="outline" className="text-xs font-mono">
                  Beta
                </Badge>
                <Badge variant="outline" className="text-xs font-mono">
                  Members
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Model the all-in cost to build and run AI-factory capacity —
                facility capex by discipline, grid vs. on-site gas, annual opex,
                and levelized $/MWh.
              </p>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
