import { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { constructMetadata } from "@/lib/metadata";
import { tools } from "@/.velite";
import { isPremium } from "@/lib/entitlements";

export const metadata: Metadata = constructMetadata({
  title: "Tools",
  description:
    "Free engineering tools for data center and AI infrastructure professionals — PUE calculators, sizing utilities, and more.",
  canonicalPath: "/tools",
});

const statusLabels: Record<string, { label: string; variant: "outline" | "default" }> = {
  live: { label: "Live", variant: "default" },
  beta: { label: "Beta", variant: "outline" },
  "coming-soon": { label: "Coming soon", variant: "outline" },
};

// Explicit display order for the gallery; anything unlisted falls to the end.
const TOOL_ORDER = ["pue-calculator", "cost-model", "single-line"];
const orderRank = (slug: string) => {
  const i = TOOL_ORDER.indexOf(slug);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
};

export default function ToolsIndexPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
        Tools
      </p>
      <h1 className="text-4xl font-bold tracking-tight mb-4">
        Engineering tools
      </h1>
      <p className="text-lg text-muted-foreground leading-relaxed mb-12 max-w-2xl">
        Free, open tools for data center and AI infrastructure engineers.
        Built to support the calculations and decisions covered in our
        articles.
      </p>

      <div className="space-y-4">
        {[...tools]
          .sort((a, b) => orderRank(a.slug) - orderRank(b.slug))
          .map((tool) => {
          const status = statusLabels[tool.status] ?? statusLabels["coming-soon"];
          const isClickable = !!tool.appPath;

          const content = (
            <div className="rounded-lg border border-border/60 p-6 hover:border-border transition-colors">
              <div className="flex items-center gap-3 mb-2">
                <h2 className="text-base font-semibold">{tool.title}</h2>
                <Badge variant={status.variant} className="text-xs font-mono">
                  {status.label}
                </Badge>
                {isPremium(tool.slug) && (
                  <Badge variant="outline" className="text-xs font-mono">
                    Members
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {tool.summary}
              </p>
            </div>
          );

          return isClickable ? (
            <Link key={tool.slug} href={tool.appPath!} className="block">
              {content}
            </Link>
          ) : (
            <div key={tool.slug}>{content}</div>
          );
        })}
      </div>

      {tools.length === 0 && (
        <div className="rounded-lg border border-dashed border-border/60 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Tools are on the way. Check back soon.
          </p>
        </div>
      )}
    </div>
  );
}
