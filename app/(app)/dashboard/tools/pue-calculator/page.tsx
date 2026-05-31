"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function PueCalculatorPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <nav className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-10">
        <Link href="/tools" className="hover:text-foreground transition-colors">
          Tools
        </Link>
        <span>/</span>
        <span className="text-foreground/60">PUE Calculator</span>
      </nav>

      <h1 className="text-3xl font-bold tracking-tight mb-4">
        PUE Calculator
      </h1>
      <p className="text-muted-foreground mb-8">
        Estimate your facility&apos;s Power Usage Effectiveness from IT load,
        cooling overhead, and electrical losses. Compare results against
        industry benchmarks for traditional and AI-dense data centers.
      </p>

      <div className="rounded-lg border border-dashed border-border/60 p-12 text-center">
        <p className="text-sm text-muted-foreground mb-4">
          Interactive calculator coming soon.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/tools">&larr; Back to tools</Link>
        </Button>
      </div>
    </div>
  );
}
