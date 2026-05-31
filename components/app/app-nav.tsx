"use client";

import Link from "next/link";
import { useAppStore } from "@/lib/store";

export function AppNav() {
  const user = useAppStore((s) => s.user);

  return (
    <header className="border-b border-border/60 bg-background">
      <div className="container mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-sm font-semibold">
          ← Public site
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {user ? (
            <span>{user.name}</span>
          ) : (
            <span>Not signed in</span>
          )}
        </div>
      </div>
    </header>
  );
}
