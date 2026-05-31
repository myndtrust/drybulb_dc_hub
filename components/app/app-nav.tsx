"use client";

import Link from "next/link";

export function AppNav() {

  return (
    <header className="border-b border-border/60 bg-background">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold">
          ← Home
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/tools" className="hover:text-foreground transition-colors">
            Tools
          </Link>
        </div>
      </div>
    </header>
  );
}
