import { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { constructMetadata } from "@/lib/metadata";
import { JsonLd } from "@/components/shared/json-ld";

export const metadata: Metadata = constructMetadata({
  title: "Drybulb — Data Center & AI Infrastructure Engineering",
  description:
    "Independent mechanical engineering consulting for AI factory design, mission-critical infrastructure, and high-density liquid-cooled data centers.",
  canonicalPath: "/",
});

const brandJsonLd = {
  "@context": "https://schema.org",
  "@type": "ProfessionalService",
  name: "Drybulb",
  description:
    "Independent mechanical engineering consulting for AI infrastructure and mission-critical data center design.",
  url: "https://drybulb.com",
  serviceType: [
    "Data Center Engineering",
    "AI Infrastructure Consulting",
    "Owner's Engineer Services",
    "Technical Due Diligence",
  ],
  areaServed: "US",
};

export default function HomePage() {
  return (
    <>
      <JsonLd data={brandJsonLd} />
      <section className="container mx-auto max-w-5xl px-4 py-24 md:py-32">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 mb-8">
            <Badge variant="outline" className="text-xs font-mono">Cooling Systems Engineering</Badge>
            <Badge variant="outline" className="text-xs font-mono">Grid Interactive Energy and Power</Badge>
            <Badge variant="outline" className="text-xs font-mono">PUE Optimizations</Badge>
             <Badge variant="outline" className="text-xs font-mono">Cluster Planning and Layouts</Badge>
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
            Engineering clarity for the AI infrastructure era.
          </h1>
          <p className="text-xl text-muted-foreground leading-relaxed mb-10 max-w-2xl">
            Drybulb is the AI Factory builder's cross-disciplinary engineering consultant. 
            Our team has operated, designed and reviewed mission-critical
            data center infrastructure — from MV/HV power systems and BESS to
            direct-liquid-cooled AI compute at scale. We help owners, developers, and
            investors get the engineering right to maximize data center performance and mitigate risks.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Button asChild size="lg">
              <Link href="/writing/ai-factory-design">
                Read: AI Factory Design Overview →
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/consulting">Work with me</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Expertise strip */}
      <section className="border-t border-border/60 py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <h2 className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-8">
            Areas of expertise
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-8 gap-y-4 text-sm">
            {[
              "AI Factory & Hyperscale Design",
              "Energy Modeling for Code Compliance",
              "MV/HV Power Systems",
              "Battery Energy Storage (BESS)",
              "Direct Liquid Cooling / CDU",
              "MEP Coordination",
              "Owner's Engineer / Technical QA",
              "Design & Construction Review",
              "Thermal & Fluid Analysis",
              "Reliability & Commissioning",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2 text-muted-foreground">
                <span className="text-foreground/40 mt-0.5">—</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flagship article teaser */}
      <section className="border-t border-border/60 py-16">
        <div className="container mx-auto max-w-5xl px-4">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <h2 className="text-2xl font-bold">Featured article</h2>
            <Link href="/writing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              All writing →
            </Link>
          </div>
          <Link href="/writing/ai-factory-design" className="group block">
            <div className="rounded-lg border border-border/60 p-8 hover:border-border transition-colors">
              <div className="text-xs font-mono text-muted-foreground mb-3 uppercase tracking-widest">
                Engineering overview
              </div>
              <h3 className="text-xl font-semibold mb-3 group-hover:text-foreground/80 transition-colors">
                An Engineering Overview of AI Factory Design
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed max-w-2xl">
                How AI factories differ from traditional data centers — token throughput as the
                design product, GPU rack density, rail-optimized networks, bulk-synchronous power behavior, and
                direct-liquid cooling at scale.
              </p>
            </div>
          </Link>
        </div>
      </section>
    </>
  );
}
