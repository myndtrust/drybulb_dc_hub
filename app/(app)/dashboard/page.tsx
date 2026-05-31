import { Metadata } from "next";
import { constructMetadata } from "@/lib/metadata";

export const metadata: Metadata = constructMetadata({
  title: "Dashboard",
  noIndex: true,
});

/**
 * Protected dashboard — Phase 2 placeholder.
 * TODO: wire auth check in middleware.ts before enabling.
 */
export default function DashboardPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 text-center">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground max-w-md">
          Client tools and resources coming in Phase 2. Authentication and
          interactive features are under development.
        </p>
      </div>
      <div className="rounded-lg border border-dashed border-muted-foreground/30 px-8 py-6 text-sm text-muted-foreground">
        Coming soon — check back soon.
      </div>
    </div>
  );
}
