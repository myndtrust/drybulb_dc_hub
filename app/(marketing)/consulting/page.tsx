import { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { constructMetadata } from "@/lib/metadata";
import { JsonLd } from "@/components/shared/json-ld";

export const metadata: Metadata = constructMetadata({
  title: "Consulting",
  description:
    "Drybulb provides Owner's Engineer, design QA, technical due diligence, and feasibility services for data center and AI infrastructure projects. Independent. PE-licensed. No vendor conflicts.",
  canonicalPath: "/consulting",
});

const servicesJsonLd = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: "Drybulb",
  url: "https://drybulb.com",
  hasOfferCatalog: {
    "@type": "OfferCatalog",
    name: "Engineering Consulting Services",
    itemListElement: [
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Owner's Engineer" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Design QA & Peer Review" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Technical Due Diligence" } },
      { "@type": "Offer", itemOffered: { "@type": "Service", name: "Concept & Feasibility" } },
    ],
  },
};

const services = [
  {
    id: "owners-engineer",
    title: "Owner's Engineer",
    when: "Design through construction on new builds, expansions, or retrofits.",
    description:
      "Large infrastructure projects accumulate risk quietly. EPC teams optimize for their schedule and margin. Equipment vendors optimize for their product. The owner's interests — program requirements, operational flexibility, lifecycle cost — need a dedicated technical advocate on the other side of the table.",
    bullets: [
      "Basis-of-design review and program alignment from day one",
      "Drawing and specification review at each design milestone",
      "MEP coordination audit across disciplines and trades",
      "Equipment submittal review and vendor RFI management",
      "Construction observation and systems integration oversight",
      "Commissioning plan review and witness testing",
    ],
    outcome:
      "A facility that delivers what the program required — not what was easiest for the contractor to build.",
  },
  {
    id: "design-qa",
    title: "Design QA & Peer Review",
    when: "Before a design is issued for construction, or when something doesn't feel right.",
    description:
      "Design teams are too close to their own work to catch everything. A second set of eyes with cross-disciplinary depth finds what internal reviews miss — the single point of failure buried in a redundancy scheme, the density assumption that breaks the cooling plant, the code provision that was misapplied three sheets ago.",
    bullets: [
      "Full MEP drawing and specification review",
      "Redundancy and reliability analysis against stated availability targets",
      "Power chain review: utility intake through rack",
      "Cooling system review: thermal plant through rack-level heat rejection",
      "Life safety and code compliance assessment",
      "Written findings report with prioritized recommendations",
    ],
    outcome:
      "A clear, prioritized findings report — actionable before the design is locked.",
  },
  {
    id: "due-diligence",
    title: "Technical Due Diligence",
    when: "Pre-acquisition, pre-investment, or pre-lease on existing or under-construction facilities.",
    description:
      "Claimed capacity is not delivered capacity. Drybulb closes that gap — assessing the physical infrastructure, design documentation, permitting status, and operational records to produce an objective technical picture of what an asset actually is and what it would cost to make it what you need it to be.",
    bullets: [
      "Physical infrastructure condition assessment",
      "Design documentation review and as-built verification",
      "Power and cooling capacity analysis",
      "Redundancy and concurrent maintainability evaluation",
      "Permitting, utility contracts, and interconnection review",
      "Capital requirements and remediation cost framing",
    ],
    outcome:
      "A technical basis for pricing, structuring, or walking away from a transaction.",
  },
  {
    id: "feasibility",
    title: "Concept & Feasibility",
    when: "Before design begins — when the questions are still about whether and how.",
    description:
      "The decisions made in the first few weeks of a project set the ceiling for everything that follows. Site selection, cooling strategy, power configuration, density assumptions, and phasing logic all compound forward. Drybulb brings the systems-level experience to make those decisions with full visibility of their downstream consequences.",
    bullets: [
      "Site selection criteria development and evaluation support",
      "Utility intake and grid interconnection feasibility",
      "Cooling strategy selection and technology comparison",
      "Rack density and compute cluster planning",
      "Campus phasing and scalability analysis",
      "Basis-of-design documentation for design team handoff",
    ],
    outcome:
      "A technically grounded program that the design team can execute — and that won't require restructuring mid-construction.",
  },
];

const clientTypes = [
  {
    type: "Owners & Developers",
    description:
      "Building new capacity or expanding existing facilities and need independent technical oversight throughout the process.",
  },
  {
    type: "Investors & Lenders",
    description:
      "Evaluating data center or AI infrastructure assets and need a credible technical read before committing capital.",
  },
  {
    type: "Hyperscalers & Operators",
    description:
      "Running fast on large campuses and need a peer review or Owner's Engineer function that can match the pace.",
  },
  {
    type: "Engineering Teams",
    description:
      "Looking for a technically deep, independent second opinion on a critical design decision or system configuration.",
  },
];

export default function ConsultingPage() {
  return (
    <>
      <JsonLd data={servicesJsonLd} />
      <div className="container mx-auto max-w-3xl px-4 py-16">
        {/* Eyebrow */}
        <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
          Consulting
        </p>

        {/* Headline */}
        <h1 className="text-4xl font-bold tracking-tight leading-tight mb-8">
          Engineering judgment, without the conflicts.
        </h1>

        {/* Positioning */}
        <div className="space-y-5 text-lg text-muted-foreground leading-relaxed mb-16">
          <p>
            Drybulb provides independent engineering consulting for data center and AI
            infrastructure — from concept through commissioning. The practice serves owners,
            developers, and investors who need a technically authoritative counterpart that
            isn&apos;t selling equipment, managing construction, or optimizing for its own scope.
          </p>
          <p>
            Engagements are scoped to the problem: a two-week peer review, a full Owner&apos;s
            Engineer mandate on a multi-year campus, or anything in between. The common thread
            is that Drybulb&apos;s interests are aligned with the client&apos;s — not with a
            vendor, a contractor, or a design-build fee structure.
          </p>
        </div>

        {/* Services */}
        <section className="mb-16">
          <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-10">
            Services
          </h2>
          <div className="space-y-16">
            {services.map(({ id, title, when, description, bullets, outcome }) => (
              <div key={id}>
                <h3 className="text-xl font-semibold mb-1">{title}</h3>
                <p className="text-xs font-mono text-muted-foreground mb-5">
                  When to engage — {when}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                  {description}
                </p>
                <ul className="space-y-2 mb-6">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <span className="text-foreground/30 mt-0.5 shrink-0">—</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-md border-l-2 border-foreground/20 pl-4">
                  <p className="text-sm text-foreground/70 italic">{outcome}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <Separator className="mb-16" />

        {/* Who we work with */}
        <section className="mb-16">
          <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
            Who we work with
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {clientTypes.map(({ type, description }) => (
              <div key={type}>
                <h3 className="text-sm font-semibold mb-2">{type}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>

        <Separator className="mb-16" />

        {/* How to start */}
        <section className="mb-16">
          <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
            How to start
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Most engagements begin with a brief conversation about the project — what it is,
            where it stands, and what the key technical questions are. From there, Drybulb
            will scope a proposal that matches the problem. There is no standard retainer
            requirement and no minimum engagement size. If the project is a fit, the
            conversation will make that clear quickly.
          </p>
        </section>

        {/* CTA */}
        <div className="rounded-lg bg-muted/40 border border-border/60 px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <p className="font-semibold mb-1">Start a conversation.</p>
            <p className="text-sm text-muted-foreground">
              Describe your project and Drybulb will respond promptly.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link href="/contact">Get in touch</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
