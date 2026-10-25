"use client";

// One-time "create your account" step. A signed-in user without a member profile
// (first Google or email-code sign-in) fills in name / company / title once, then
// carries on to the page they were going to. Signed-out visitors pass straight
// through, and so does everyone if the profile can't be checked — this is
// onboarding, not access control (RLS and rackline_accept_invite enforce that).

import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient, getSessionSafe, isSupabaseConfigured, signOut } from "@/lib/supabase/client";
import { getMyProfile, saveMyProfile } from "@/lib/supabase/profile";

const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Need = { email: string; name: string } | null;

export function AccountGate({ children }: { children: ReactNode }) {
  const [need, setNeed] = useState<Need>(null);
  const [form, setForm] = useState({ full_name: "", company: "", job_title: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    const check = async () => {
      const { session } = await getSessionSafe();
      if (!alive) return;
      if (!session) { setNeed(null); return; }
      try {
        const prof = await getMyProfile();
        if (!alive) return;
        if (prof) { setNeed(null); return; }
        const meta = session.user.user_metadata as { full_name?: string; name?: string };
        const name = meta.full_name || meta.name || "";
        setForm((f) => ({ ...f, full_name: f.full_name || name }));
        setNeed({ email: session.user.email ?? "", name });
      } catch {
        if (alive) setNeed(null); // can't tell — don't block the site
      }
    };
    check();
    const { data: sub } = createClient().auth.onAuthStateChange((e) => {
      if (e === "SIGNED_IN" || e === "SIGNED_OUT" || e === "USER_UPDATED") check();
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  if (!need) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.full_name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveMyProfile(need.email, {
        full_name: form.full_name.trim(),
        company: form.company.trim() || null,
        job_title: form.job_title.trim() || null,
      });
      setNeed(null);
    } catch {
      setError("We couldn't create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <Card>
        <CardContent className="py-8">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1 text-center">
              <h1 className="text-2xl font-bold tracking-tight">Create your Drybulb account</h1>
              <p className="text-sm text-muted-foreground">
                Signed in as <span className="font-mono">{need.email}</span>. Just a few details and you&apos;re in.
              </p>
            </div>
            <label className="block space-y-1 text-sm"><span>Full name</span>
              <input required autoFocus maxLength={200} autoComplete="name" value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })} className={field} /></label>
            <label className="block space-y-1 text-sm"><span>Company <span className="text-muted-foreground">(optional)</span></span>
              <input maxLength={200} autoComplete="organization" value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })} className={field} /></label>
            <label className="block space-y-1 text-sm"><span>Job title <span className="text-muted-foreground">(optional)</span></span>
              <input maxLength={200} autoComplete="organization-title" value={form.job_title}
                onChange={(e) => setForm({ ...form, job_title: e.target.value })} className={field} /></label>
            <Button type="submit" className="w-full" disabled={busy || !form.full_name.trim()}>
              {busy ? "Creating…" : "Create account"}
            </Button>
            {error && <p className="text-center text-sm text-destructive">{error}</p>}
            <p className="text-center text-xs text-muted-foreground">
              Wrong account? <button type="button" onClick={() => signOut()} className="underline underline-offset-4 hover:text-foreground">Sign out</button>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
