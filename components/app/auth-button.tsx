"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createClient,
  getSessionSafe,
  isSupabaseConfigured,
  signInWithGoogle,
  signOut,
} from "@/lib/supabase/client";

export function AuthButton() {
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const supabase = createClient();
    getSessionSafe().then(({ session }) => {
      setEmail(session?.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Hide entirely when auth isn't configured or before the session is known.
  if (!isSupabaseConfigured || !ready) return null;

  if (email) {
    return (
      <div className="flex items-center gap-3">
        <span className="hidden text-xs text-muted-foreground sm:inline">{email}</span>
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <Button size="sm" onClick={() => signInWithGoogle()}>
      Sign in with Google
    </Button>
  );
}
