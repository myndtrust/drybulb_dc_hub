"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient, getSessionSafe, isSupabaseConfigured, signOut } from "@/lib/supabase/client";

/**
 * Compact account control for full-bleed tool headers, which replace the site
 * nav: an initial avatar that opens Home, Tools and Sign out (or a Sign in link).
 */
export function AccountMenu() {
  const [email, setEmail] = useState<string | null>(null);
  // Without auth configured there is no session to wait for.
  const [ready, setReady] = useState(!isSupabaseConfigured);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    getSessionSafe().then(({ session }) => { setEmail(session?.user?.email ?? null); setReady(true); });
    const { data: sub } = createClient().auth.onAuthStateChange((_e, s) => setEmail(s?.user?.email ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  if (!ready) return <div className="h-8 w-8 shrink-0" />;
  const item = "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent";

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        aria-label={email ? `Account: ${email}` : "Account"} title={email ?? "Account"}
        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-muted text-xs font-semibold uppercase text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >{email ? email[0] : "?"}</button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-1 w-60 rounded-lg border bg-popover p-1 text-sm shadow-lg">
          {email && <div className="truncate px-2 py-1.5 text-xs text-muted-foreground">{email}</div>}
          <Link href="/tools" role="menuitem" className={item} onClick={() => setOpen(false)}>All tools</Link>
          <Link href="/" role="menuitem" className={item} onClick={() => setOpen(false)}>Drybulb home</Link>
          <div className="my-1 border-t" />
          {email
            ? <button type="button" role="menuitem" className={item} onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
            : isSupabaseConfigured && <Link href={`/signin?next=${encodeURIComponent(pathname)}`} role="menuitem" className={item}>Sign in</Link>}
        </div>
      )}
    </div>
  );
}
