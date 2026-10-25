"use client";

/**
 * (app) route group layout — client boundary.
 * Wraps all authenticated/interactive routes with shared client state.
 * SPA feel: use next/link everywhere, loading.tsx per route for skeleton UI.
 * Full-bleed workspaces (Rackline) get the whole window below the nav: no page
 * padding, and the tool's root fills the remaining height as a flex child.
 */

import { usePathname } from "next/navigation";
import { AccountGate } from "@/components/app/account-gate";
import { AppNav } from "@/components/app/app-nav";

const FULL_BLEED = ["/dashboard/tools/rackline"];

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const fullBleed = FULL_BLEED.some((p) => pathname.startsWith(p));
  return (
    <div className={fullBleed ? "flex h-dvh flex-col" : "flex min-h-screen flex-col"}>
      <AppNav />
      <main className={fullBleed ? "flex min-h-0 flex-1 flex-col" : "flex-1 container mx-auto px-4 py-8"}>
        <AccountGate>{children}</AccountGate>
      </main>
    </div>
  );
}
