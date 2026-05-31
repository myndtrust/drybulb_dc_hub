import { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { constructMetadata } from "@/lib/metadata";

export const metadata: Metadata = constructMetadata({
  title: "About",
  description:
    "Drybulb is a resource hub covering AI factory engineering — power, cooling, networking, reliability, and sustainability. Rigorous technical writing for the engineers, owners, and investors building AI infrastructure.",
  canonicalPath: "/about",
});

const scopeAreas = [
  {
    category: "Power Systems",
    items: [
      "MV/HV utility intake and substation design",
      "Distribution, transformation, and redundancy strategy",
      "UPS architecture and BESS integration",
      "Grid-constraint planning and demand response",
    ],
  },
  {
    category: "Cooling & Thermal",
    items: [
      "Direct-to-chip liquid cooling (cold plate / CDU)",
      "Immersion cooling (single-phase and two-phase)",
      "Facility water systems and cooling towers",
      "PUE / WUE optimization and heat reuse",
    ],
  },
  {
    category: "AI Infrastructure",
    items: [
      "AI factory and hyperscale campus design",
      "High-density GPU cluster layout and planning",
      "Scale-up and scale-out network fabrics",
      "Rack power density strategy and roadmapping",
    ],
  },
  {
    category: "Reliability & Sustainability",
    items: [
      "Redundancy tiers and concurrent maintainability",
      "Commissioning planning and execution",
      "Life-cycle carbon and embodied-energy analysis",
      "Water stewardship and waste-heat recovery",
    ],
  },
];

const audiences = [
  {
    title: "Owners & Developers",
    description:
      "Building or expanding data center capacity and navigating the engineering decisions that determine whether a facility delivers what the program requires — from cooling strategy to power redundancy to phasing logic.",
  },
  {
    title: "Investors & Lenders",
    description:
      "Evaluating data center and AI infrastructure assets and need to close the gap between claimed capacity and deliverable capacity before committing capital.",
  },
  {
    title: "Engineering & Design Teams",
    description:
      "Working across power, cooling, and MEP disciplines on high-density AI facilities and looking for independent technical depth on the coordination problems that cross disciplinary boundaries.",
  },
  {
    title: "Program & Operations Leaders",
    description:
      "Planning early-stage AI clusters or hyperscale campuses and need to get site criteria, utility intake, density assumptions, and phasing logic right before design begins.",
  },
];

export default function AboutPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      {/* Eyebrow */}
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
        About
      </p>

      {/* Headline */}
      <h1 className="text-4xl font-bold tracking-tight leading-tight mb-8">
        Rigorous engineering knowledge for the people building AI
        infrastructure.
      </h1>

      {/* Mission */}
      <div className="space-y-5 text-lg text-muted-foreground leading-relaxed mb-16">
        <p>
          Drybulb is a resource hub that publishes deep technical writing on
          the engineering of AI factories and mission-critical data centers. The
          site exists because the best knowledge in this field is still locked
          inside organizations, shared only in conference hallways and
          vendor-filtered whitepapers. We think it should be public.
        </p>
        <p>
          Every article on Drybulb is grounded in public-domain knowledge and
          first-principles engineering. We cover the full infrastructure stack
          — power, cooling, networking, reliability, and sustainability — with
          the rigor that practitioners expect and the depth that marketing
          collateral can&apos;t provide. Alongside the writing, we&apos;re
          building a growing library of free, open tools for the engineers who
          design and operate these facilities.
        </p>
      </div>

      {/* Who it's for */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          Who this is for
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          {audiences.map(({ title, description }) => (
            <div key={title}>
              <h3 className="text-sm font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <Separator className="mb-16" />

      {/* Editorial standards */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          Editorial standards
        </h2>
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-semibold mb-2">
              Technically rigorous
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every hard figure is verified against manufacturer specs, industry
              standards, or first-principles calculation. We show our reasoning.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">
              Public-domain knowledge only
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Nothing on Drybulb requires insider access, NDA-protected data, or
              proprietary information. Every claim can be independently verified
              by the reader.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold mb-2">
              Independent and unsponsored
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Drybulb does not accept sponsored content. Equipment and
              technologies are evaluated on engineering merit, not commercial
              relationships.
            </p>
          </div>
        </div>
      </section>

      <Separator className="mb-16" />

      {/* Scope */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          What we cover
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
          {scopeAreas.map(({ category, items }) => (
            <div key={category}>
              <h3 className="text-sm font-semibold mb-3">{category}</h3>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="text-foreground/30 mt-0.5 shrink-0">
                      &mdash;
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Separator className="mb-16" />

      {/* Editor note */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
          About the editor
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Drybulb was started by an independent engineer — a licensed
          Professional Engineer (PE) and Doctor of Design — with 25+ years of
          experience across the full data center infrastructure stack. The
          motivation was simple: the best engineering knowledge in this industry
          is hard to find unless you already know the right people. This site is
          an attempt to change that, one article and one tool at a time.
        </p>
      </section>

      {/* CTA */}
      <div className="rounded-lg bg-muted/40 border border-border/60 px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <p className="font-semibold mb-1">Start with the cornerstone article.</p>
          <p className="text-sm text-muted-foreground">
            A deep engineering overview of how AI factories differ from
            traditional data centers.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href="/writing/ai-factory-design">Read the overview</Link>
        </Button>
      </div>
    </div>
  );
}
