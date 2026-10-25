"use client";

// Invite inbox: open Rackline invites addressed to the signed-in user's email
// (rackline_my_invites), each with Accept / Decline — no link needed. Shown on the
// dashboard, at the top of Rackline and in its Projects drawer. Instances stay in
// sync through a window event, so accepting in one place clears the others.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { acceptInvite, declineInvite, listMyInvites, type MyInvite } from "@/lib/rackline/saved-projects";

const CHANGED = "rackline:invites-changed";
const roleText = { owner: "own", editor: "edit", copier: "view & duplicate", viewer: "view" } as const;

export function PendingInvites({
  variant = "banner",
  onAccepted,
}: {
  variant?: "banner" | "list";
  /** Open the project in place (Rackline); default navigates to it. */
  onAccepted?: (projectId: string) => void;
}) {
  const router = useRouter();
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setInvites(await listMyInvites()); } catch { setInvites([]); }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const refresh = () => { void load(); };
    refresh();
    const { data: sub } = createClient().auth.onAuthStateChange((e) => {
      if (e === "SIGNED_OUT") setInvites([]);
      else if (e === "SIGNED_IN") refresh();
    });
    window.addEventListener(CHANGED, refresh);
    return () => { sub.subscription.unsubscribe(); window.removeEventListener(CHANGED, refresh); };
  }, [load]);

  if (invites.length === 0) return null;

  const act = async (inv: MyInvite, accept: boolean) => {
    setBusy(inv.token);
    setError(null);
    try {
      if (accept) {
        const projectId = await acceptInvite(inv.token);
        window.dispatchEvent(new Event(CHANGED));
        if (onAccepted) onAccepted(projectId);
        else router.push(`/dashboard/tools/rackline?project=${projectId}`);
      } else {
        await declineInvite(inv.token);
        window.dispatchEvent(new Event(CHANGED));
      }
    } catch (e) {
      setError((e as Error).message || "That didn't work. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const banner = variant === "banner";
  return (
    <div className={banner ? "space-y-1 border-b bg-primary/5 px-3 py-2" : "space-y-2"}>
      {!banner && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Shared with you</h3>}
      <ul className={banner ? "space-y-1" : "divide-y divide-border/60"}>
        {invites.map((inv) => (
          <li key={inv.token} className={`flex flex-wrap items-center justify-between gap-2 text-sm ${banner ? "" : "py-2"}`}>
            <span className="min-w-0">
              {inv.invited_by} shared <span className="font-medium">{inv.project_name}</span> with you
              <span className="text-muted-foreground"> · can {roleText[inv.role]}</span>
            </span>
            <span className="flex shrink-0 gap-1">
              <Button size="sm" disabled={busy !== null} onClick={() => act(inv, true)}>{busy === inv.token ? "Opening…" : "Accept"}</Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(inv, false)}>Decline</Button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[11px] text-muted-foreground">Shared designs are confidential to the project owner. Accepting adds it to your projects.</p>
    </div>
  );
}
