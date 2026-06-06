import { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { constructMetadata } from "@/lib/metadata";

export const metadata: Metadata = constructMetadata({
  title: "Consulting",
  description:
    "Independent technical advisory for AI factories and mission-critical data centers — technical due diligence, owner's engineering, design peer review, PUE/sustainability assessment, and expert witness work, from a licensed PE and Doctor of Design.",
  canonicalPath: "/consulting",
});

const services = [
  {
    title: "Technical Due Diligence",
    audience: "For investors, lenders & acquirers",
    description:
      "Independent assessment of a data center or AI-factory asset before capital is committed — closing the gap between claimed capacity and deliverable capacity. Power chain, cooling strategy, redundancy, phasing, and the assumptions that determine whether the facility delivers what the pro forma assumes.",
    engagement: "due-diligence",
  },
  {
    title: "Owner's Engineer & Design Peer Review",
    audience: "For owners & developers",
    description:
      "An independent technical voice on your side of the table through design and construction. Review of power, cooling, and MEP coordination; redundancy-tier and concurrent-maintainability validation; commissioning planning; and the cross-disciplinary decisions that determine whether a build performs.",
    engagement: "owners-engineer",
  },
  {
    title: "PUE, Efficiency & Sustainability Assessment",
    audience: "For operators & ESG-driven owners",
    description:
      "Climate-based PUE/WUE modeling, life-cycle and embodied-carbon analysis, and heat-reuse and water-stewardship strategy — grounded in the same first-principles methods behind the Drybulb PUE tool, delivered as a defensible engineering report.",
    engagement: "sustainability",
  },
  {
    title: "Expert Witness & Litigation Support",
    audience: "For counsel",
    description:
      "Independent technical opinion, reports, and testimony on data center infrastructure disputes — design adequacy, reliability, failure analysis, and standard-of-care questions, from a licensed Professional Engineer.",
    engagement: "expert-witness",
  },
];

export default function ConsultingPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      {/* Eyebrow */}
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
        Consulting
      </p>

      {/* Headline */}
      <h1 className="text-4xl font-bold tracking-tight leading-tight mb-8">
        Independent engineering judgment for the people building and financing
        AI infrastructure.
      </h1>

      {/* Intro */}
      <div className="space-y-5 text-lg text-muted-foreground leading-relaxed mb-16">
        <p>
          The writing and tools on Drybulb are public because the underlying
          engineering should be. The same rigor is available directly when the
          stakes are specific — a deal to underwrite, a design to validate, a
          dispute to resolve.
        </p>
        <p>
          Engagements are taken on selectively and personally by a licensed
          Professional Engineer (PE) and Doctor of Design with 25+ years across
          the full data center infrastructure stack. The work is independent and
          unconflicted — no equipment lines, no vendor relationships, no
          incentive other than getting the engineering right.
        </p>
      </div>

      {/* Services */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          How I can help
        </h2>
        <div className="space-y-10">
          {services.map(({ title, audience, description, engagement }) => (
            <div key={title}>
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-2">
                <h3 className="text-base font-semibold">{title}</h3>
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider shrink-0">
                  {audience}
                </p>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                {description}
              </p>
              <Link
                href={`/contact?engagement=${engagement}`}
                className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-foreground/70 transition-colors"
                data-umami-event="cta-consulting-service"
                data-umami-event-engagement={engagement}
              >
                Discuss this engagement &rarr;
              </Link>
            </div>
          ))}
        </div>
      </section>

      <Separator className="mb-16" />

      {/* Proof */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
          The work speaks first
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          Before any conversation, the published writing and tools show the
          depth and independence you&apos;d be hiring:
        </p>
        <ul className="space-y-2 text-sm">
          <li>
            <Link
              href="/writing/ai-factory-design"
              className="text-foreground underline underline-offset-4 hover:text-foreground/70 transition-colors"
            >
              An Engineering Overview of AI Factory Design
            </Link>
          </li>
          <li>
            <Link
              href="/writing/the-whole-data-center"
              className="text-foreground underline underline-offset-4 hover:text-foreground/70 transition-colors"
            >
              The Whole Data Center: Why PUE Was Never the Whole Story
            </Link>
          </li>
          <li>
            <Link
              href="/tools/pue-calculator"
              className="text-foreground underline underline-offset-4 hover:text-foreground/70 transition-colors"
            >
              The Drybulb PUE Calculator
            </Link>
          </li>
        </ul>
      </section>

      {/* CTA */}
      <div className="rounded-lg bg-muted/40 border border-border/60 px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <p className="font-semibold mb-1">Have a specific problem in mind?</p>
          <p className="text-sm text-muted-foreground">
            Tell me about the asset, the decision, and the timeline. I&apos;ll
            tell you honestly whether I&apos;m the right engineer for it.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href="/contact?engagement=general" data-umami-event="cta-consulting-main">
            Start a conversation
          </Link>
        </Button>
      </div>
    </div>
  );
}
