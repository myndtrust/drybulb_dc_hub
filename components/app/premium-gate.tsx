"use client";

import { type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  createClient,
  isSupabaseConfigured,
  signInWithGoogle,
} from "@/lib/supabase/client";
import { hasAccess, isPremium } from "@/lib/entitlements";

/**
 * Gates a premium tool behind member sign-in. Free tools (and local dev without
 * Supabase configured) render straight through. Members tier is free during
 * beta — any signed-in user passes.
 */
export function PremiumGate({
  slug,
  toolTitle,
  children,
}: {
  slug: string;
  toolTitle: string;
  children: ReactNode;
}) {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(Boolean(data.session));
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setSignedIn(Boolean(session)),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  // Auth not configured (local dev) or a free tool — never gated.
  if (!isSupabaseConfigured || !isPremium(slug)) return <>{children}</>;

  if (!ready) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-24 text-center">
        <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (hasAccess(slug, signedIn)) return <>{children}</>;

  return (
    <div className="container mx-auto max-w-2xl px-4 py-16">
      <nav className="mb-8 flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <Link href="/tools" className="transition-colors hover:text-foreground">
          Tools
        </Link>
        <span>/</span>
        <span className="text-foreground/60">{toolTitle}</span>
      </nav>

      <Card>
        <CardContent className="py-10 text-center">
          <Badge variant="outline" className="mb-4 font-mono text-xs">
            Members
          </Badge>
          <h1 className="mb-3 text-2xl font-bold tracking-tight">{toolTitle}</h1>
          <p className="mx-auto mb-6 max-w-md text-muted-foreground">
            This is a Drybulb members tool. It&apos;s{" "}
            <span className="font-medium text-foreground">free while in beta</span>{" "}
            — sign in to get instant access. No payment required today.
          </p>
          <Button onClick={() => signInWithGoogle(`/dashboard/tools/${slug}`)}>
            Sign in with Google
          </Button>
          <p className="mt-4 text-xs text-muted-foreground">
            Creating an account also lets you save and reload your models.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
