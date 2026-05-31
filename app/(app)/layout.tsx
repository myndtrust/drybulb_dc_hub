"use client";

/**
 * (app) route group layout — client boundary.
 * Wraps all authenticated/interactive routes with shared client state.
 * SPA feel: use next/link everywhere, loading.tsx per route for skeleton UI.
 */

import { AppNav } from "@/components/app/app-nav";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppNav />
      <main className="flex-1 container mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
