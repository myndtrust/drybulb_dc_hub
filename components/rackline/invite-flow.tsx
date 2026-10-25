"use client";

// Invite landing page: preview → sign in (new people then create their account
// once, via AccountGate in the app layout) → Accept / Decline → open the project.
// The same invite also waits in the user's Rackline inbox (PendingInvites), so the
// link is a convenience, not a requirement. rackline_accept_invite() re-checks
// everything in Postgres: right email, not expired, not used, account created.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient, getSessionSafe, isSupabaseConfigured, signOut } from "@/lib/supabase/client";
import { SignInOptions } from "@/components/app/sign-in";
import { acceptInvite, declineInvite, previewInvite, type InvitePreview } from "@/lib/rackline/saved-projects";

type Step = "loading" | "invalid" | "signin" | "join" | "declined" | "error";
const roleText = { owner: "own and manage", editor: "work on", copier: "view and duplicate", viewer: "view" } as const;

/** Does the signed-in email fit the invite's masked hint (first letter + domain, e.g. e•••@drybulb.com)? */
const fitsHint = (email: string, hint: string) =>
  `${email[0]}•••${email.slice(email.indexOf("@"))}`.toLowerCase() === hint.toLowerCase();

export function InviteFlow({ token }: { token: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [inv, setInv] = useState<InvitePreview | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!isSupabaseConfigured) { setStep("invalid"); return; }
      try {
        const p = await previewInvite(token);
        if (!alive) return;
        setInv(p);
        if (!p || p.status !== "open") { setStep("invalid"); return; }
        const { session } = await getSessionSafe();
        if (!alive) return;
        if (!session) { setStep("signin"); return; }
        setEmail(session.user.email ?? "");
        setStep("join");
      } catch {
        if (alive) { setError("We couldn't load this invite. Please try again."); setStep("error"); }
      }
    })();
    const { data: sub } = isSupabaseConfigured ? createClient().auth.onAuthStateChange((e) => { if (e === "SIGNED_OUT") setStep("signin"); }) : { data: null };
    return () => { alive = false; sub?.subscription.unsubscribe(); };
  }, [token]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const projectId = await acceptInvite(token);
      router.push(`/dashboard/tools/rackline?project=${projectId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    setError(null);
    try {
      await declineInvite(token);
      setStep("declined");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const wrongAccount = step === "join" && !!email && !!inv && !fitsHint(email, inv.email_hint);
  // Signing out flips the page back to the sign-in step (onAuthStateChange above).
  const switchAccount = () => signOut();

  return (
    <div className="mx-auto max-w-lg py-12">
      <Card>
        <CardContent className="space-y-5 py-8">
          <div className="space-y-2 text-center">
            <Badge variant="outline" className="font-mono text-xs">Project invite</Badge>
            <h1 className="text-2xl font-bold tracking-tight">{inv?.project_name ?? "Shared project"}</h1>
            {inv && step !== "invalid" && (
              <p className="text-sm text-muted-foreground">
                {inv.invited_by} invited you to {roleText[inv.role]} this project in Drybulb AI Factory Infrastructure Design. Sent to <span className="font-mono">{inv.email_hint}</span>.
              </p>
            )}
          </div>

          {step === "loading" && <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />}

          {step === "invalid" && (
            <p className="text-center text-sm text-muted-foreground">
              {!inv ? "This invite link isn't valid." : inv.status === "expired" ? "This invite has expired. Ask the project owner for a new one." : "This invite has already been used. Sign in and open it from your projects."}
            </p>
          )}

          {step === "signin" && (
            <div className="space-y-3 text-center">
              <p className="text-sm">Sign in as <span className="font-mono">{inv?.email_hint}</span>, with Google or with a code sent to that address. New to Drybulb? Signing in creates your account.</p>
              <SignInOptions next={`/invite/${token}`} onSignedIn={() => window.location.reload()} />
            </div>
          )}

          {wrongAccount && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-center">
              <p className="text-sm">You&apos;re signed in as <span className="font-mono">{email}</span>, but this invite was sent to <span className="font-mono">{inv?.email_hint}</span>.</p>
              <Button variant="outline" size="sm" onClick={switchAccount}>Switch account</Button>
            </div>
          )}

          {step === "join" && !wrongAccount && (
            <div className="space-y-3 text-center">
              <p className="text-sm">Signed in as <span className="font-mono">{email}</span></p>
              <div className="flex justify-center gap-2">
                <Button onClick={join} disabled={busy}>{busy ? "Opening…" : "Accept and open project"}</Button>
                <Button variant="ghost" onClick={decline} disabled={busy}>Decline</Button>
              </div>
              <p className="text-xs text-muted-foreground">Shared designs are confidential to the project owner.</p>
            </div>
          )}

          {step === "declined" && (
            <p className="text-center text-sm text-muted-foreground">
              Invite declined. If that was a mistake, ask {inv?.invited_by ?? "the project owner"} to share it again.
            </p>
          )}

          {error && (
            <div className="space-y-2 text-center">
              <p className="text-sm text-destructive">{error}</p>
              {/different email/i.test(error) && <Button variant="outline" size="sm" onClick={switchAccount}>Switch account</Button>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
