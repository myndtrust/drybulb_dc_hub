import { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { constructMetadata } from "@/lib/metadata";

export const metadata: Metadata = constructMetadata({
  title: "About",
  description:
    "Drybulb is an independent engineering consultancy bringing PE-licensed rigor and design-systems thinking to AI infrastructure, data center power, and liquid cooling challenges.",
  canonicalPath: "/about",
});

const differentiators = [
  {
    title: "Technical authority with professional accountability",
    description:
      "Drybulb associates hold Professional Engineer licenses — which means every analysis, review, and recommendation carries professional accountability. In a field where design errors have eight- and nine-figure consequences, that matters. The founding engineer holds a Doctor of Design in Architecture, bringing systems-level thinking to problems that most engineering firms treat as isolated components.",
  },
  {
    title: "25+ years across the full infrastructure stack",
    description:
      "The practice was built on deep, direct experience — from utility intake to the rack, across power, cooling, controls, and MEP coordination. That breadth means Drybulb catches the coordination failures that specialists miss: the cooling strategy that's incompatible with the power redundancy model, the busway routing that kills maintainability, the density assumption that breaks the thermal plant.",
  },
  {
    title: "Genuinely independent",
    description:
      "Drybulb does not sell equipment, hold construction contracts, or carry vendor relationships that could compromise a recommendation. That independence is structural, not a policy. Clients get the answer that's right for the project — not the answer that's right for a supplier.",
  },
];

const engagements = [
  {
    title: "Owner's Engineer",
    description:
      "Representing owners through design, procurement, and construction. Drybulb acts as the technical counterweight to EPC teams and equipment vendors — scrutinizing drawings, catching coordination failures before concrete is poured, and keeping the project honest against program requirements.",
  },
  {
    title: "Design QA & Peer Review",
    description:
      "Independent review of MEP and infrastructure designs across power systems, cooling plant, controls, and life safety. The practice focuses on what design teams are too close to see: single points of failure, code compliance gaps, constructability issues, and missed efficiency opportunities.",
  },
  {
    title: "Technical Due Diligence",
    description:
      "Pre-acquisition and pre-investment infrastructure review for data centers and AI campuses. Drybulb closes the gap between claimed capacity and deliverable capacity — giving investors and operators a clear technical picture before they commit.",
  },
  {
    title: "Concept & Feasibility",
    description:
      "Early-stage planning for AI clusters and hyperscale campuses: site criteria, utility intake sizing, cooling strategy, rack density, and phasing logic. Getting the constraints right at the whiteboard is far cheaper than discovering them in construction.",
  },
];

const expertiseDomains = [
  {
    category: "AI Infrastructure",
    items: [
      "AI factory and hyperscale campus design",
      "High-density GPU cluster layout and planning",
      "Scale-up and scale-out network infrastructure",
      "Rack power density strategy and roadmapping",
    ],
  },
  {
    category: "Power Systems",
    items: [
      "MV/HV utility intake and substation design",
      "MV distribution and transformation",
      "UPS architecture and BESS integration",
      "Redundancy strategy (N, N+1, 2N, 2N+1)",
      "Grid-constraint planning and demand response",
    ],
  },
  {
    category: "Cooling & Thermal",
    items: [
      "Direct-to-chip liquid cooling (cold plate / CDU)",
      "Rear-door heat exchangers and in-row cooling",
      "Immersion cooling (single-phase and two-phase)",
      "Facility water systems and cooling towers",
      "PUE / WUE optimization and heat reuse",
    ],
  },
  {
    category: "Program & Delivery",
    items: [
      "MEP coordination and systems integration",
      "Reliability tiers and concurrent maintainability",
      "Commissioning planning and execution oversight",
      "Speed-to-power strategy and utility engagement",
      "Design standards and basis-of-design authorship",
    ],
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
        Independent engineering expertise for the hardest infrastructure problems in AI.
      </h1>

      {/* Company pitch */}
      <div className="space-y-5 text-lg text-muted-foreground leading-relaxed mb-16">
        <p>
          Drybulb is an independent engineering consultancy that works at the intersection
          of AI compute, power infrastructure, and thermal systems. The practice serves
          owners, developers, and investors who need engineering judgment that is technically
          deep, professionally accountable, and free from the conflicts that come with
          design-build or equipment sales.
        </p>
        <p>
          The scale of work spans hundreds of megawatts of capacity designed, reviewed, and
          commissioned — across hyperscale campuses, wholesale colocation, and purpose-built
          AI training facilities. What distinguishes the practice is not just the breadth of
          that experience, but the ability to hold the whole system in view: to see how a
          power redundancy decision affects cooling strategy, how a density assumption
          propagates through the thermal plant, and how early-stage design choices set the
          ceiling for every operational decision that follows.
        </p>
      </div>

      {/* Differentiators */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          What sets Drybulb apart
        </h2>
        <div className="space-y-10">
          {differentiators.map(({ title, description }) => (
            <div key={title}>
              <h3 className="text-base font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <Separator className="mb-16" />

      {/* Engagements */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          How we work with clients
        </h2>
        <div className="space-y-10">
          {engagements.map(({ title, description }) => (
            <div key={title}>
              <h3 className="text-base font-semibold mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <Separator className="mb-16" />

      {/* Expertise domains */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          Areas of expertise
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
          {expertiseDomains.map(({ category, items }) => (
            <div key={category}>
              <h3 className="text-sm font-semibold mb-3">{category}</h3>
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-2 text-sm text-muted-foreground"
                  >
                    <span className="text-foreground/30 mt-0.5 shrink-0">—</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <Separator className="mb-16" />

      {/* Who we work with */}
      <section className="mb-16">
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
          Who we work with
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Drybulb works with owners and developers building or acquiring data center
          capacity, investors conducting technical due diligence on infrastructure assets,
          and engineering teams that need an independent second opinion on a critical design
          decision. Engagements range from a focused two-week peer review to multi-year
          Owner&apos;s Engineer roles on large campuses.
        </p>
      </section>

      {/* CTA */}
      <div className="rounded-lg bg-muted/40 border border-border/60 px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <p className="font-semibold mb-1">Ready to work together?</p>
          <p className="text-sm text-muted-foreground">
            Reach out with a brief description of your project or question.
          </p>
        </div>
        <Button asChild size="lg" className="shrink-0">
          <Link href="/consulting">See consulting services</Link>
        </Button>
      </div>
    </div>
  );
}
