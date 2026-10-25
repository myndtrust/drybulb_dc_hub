"use client";

// Shared sign-in: Google, or a one-time code sent by email (any address — Yahoo,
// corporate, …). Signing in creates the account for new people either way.
// Every signed-in surface listens to onAuthStateChange, so after a code is
// verified the page updates in place; `onSignedIn` is for pages that must move on.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionSafe, isSupabaseConfigured, sendEmailCode, signInWithGoogle, verifyEmailCode } from "@/lib/supabase/client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SignInOptions({
  next,
  size = "default",
  align = "center",
  onSignedIn,
}: {
  /** Where to land after Google / the email link. Default: the current page. */
  next?: string;
  size?: "default" | "sm";
  align?: "center" | "start";
  onSignedIn?: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "email" | "code">("choose");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrap = `flex flex-col gap-2 ${align === "center" ? "items-center" : "items-start"}`;

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) { setError("Enter a valid email address."); return; }
    setBusy(true);
    setError(null);
    const { error: msg } = await sendEmailCode(addr, next);
    setBusy(false);
    if (!msg) {
      setEmail(addr);
      setCode("");
      setMode("code");
      return;
    }
    // Supabase limits: one email per address per ~60 s ("…after N seconds"), and a
    // project-wide hourly cap on auth emails (Auth → Rate Limits).
    const wait = msg.match(/after (\d+) seconds?/i)?.[1];
    setError(
      wait ? `A code was just sent to this address. You can request another in ${wait} seconds.`
        : /rate limit|too many/i.test(msg) ? "We've sent too many sign-in emails in the last hour. Please try again later, or continue with Google."
        : "We couldn't send the email. Please try again.",
    );
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: msg } = await verifyEmailCode(email, code.trim());
    if (!msg) { onSignedIn?.(); return; }
    setBusy(false);
    // Each new email replaces the previous code, so only the latest one works.
    setError(/expired|invalid/i.test(msg)
      ? "That code is wrong or has expired. Use the code from the most recent email, or send a new one."
      : `Sign-in failed: ${msg}`);
  };

  if (mode === "choose") {
    return (
      <div className={wrap}>
        <Button size={size} onClick={() => signInWithGoogle(next)}>Continue with Google</Button>
        <button type="button" onClick={() => setMode("email")} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          or continue with email
        </button>
      </div>
    );
  }

  if (mode === "email") {
    return (
      <form onSubmit={send} className={`${wrap} w-full max-w-xs`}>
        <input type="email" autoComplete="email" autoFocus required placeholder="you@company.com" aria-label="Email address"
          value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        <Button type="submit" size={size} className="w-full" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in code"}</Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <button type="button" onClick={() => { setMode("choose"); setError(null); }} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Back to Google
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className={`${wrap} w-full max-w-xs`}>
      <p className={`text-xs text-muted-foreground ${align === "center" ? "text-center" : ""}`}>
        We sent a code to <span className="font-mono text-foreground">{email}</span>. Enter it below, or open the link in the email.
      </p>
      <input inputMode="numeric" autoComplete="one-time-code" autoFocus required placeholder="123456" aria-label="Sign-in code"
        pattern="[0-9]{6,10}" maxLength={10} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className={`${field} text-center font-mono tracking-[0.3em]`} />
      <Button type="submit" size={size} className="w-full" disabled={busy || code.length < 6}>{busy ? "Signing in…" : "Sign in"}</Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <span className="flex gap-3 text-xs text-muted-foreground">
        <button type="button" disabled={busy} onClick={() => send()} className="underline-offset-4 hover:text-foreground hover:underline">Send a new code</button>
        <button type="button" onClick={() => { setMode("email"); setError(null); }} className="underline-offset-4 hover:text-foreground hover:underline">Use a different email</button>
      </span>
    </form>
  );
}

/** Full-page sign-in (/signin). Moves on to `next` once signed in, or if already signed in. */
export function SignInCard({ next }: { next: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    getSessionSafe().then(({ session }) => { if (session) router.replace(next); });
  }, [next, router]);

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardContent className="space-y-5 py-8 text-center">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Sign in to Drybulb</h1>
            <p className="text-sm text-muted-foreground">New here? Signing in creates your free member account.</p>
          </div>
          <SignInOptions next={next} onSignedIn={() => router.replace(next)} />
        </CardContent>
      </Card>
    </div>
  );
}
