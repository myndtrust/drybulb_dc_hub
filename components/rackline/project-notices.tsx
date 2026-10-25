"use client";

// Notices for the signed-in user, written by a database trigger: today, "a project
// shared with you was deleted". Shown at the top of Rackline, in its Projects
// drawer and on the dashboard until dismissed. New notices arrive live (Realtime);
// `onNotice` lets the workbench close a project that was deleted while open.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient, getSessionSafe, isSupabaseConfigured } from "@/lib/supabase/client";
import { dismissNotice, listNotices, type Notice } from "@/lib/rackline/saved-projects";

export const NOTICES_CHANGED = "rackline:notices-changed";

export function ProjectNotices({
  variant = "banner",
  onNotice,
}: {
  variant?: "banner" | "list";
  /** Called once for each notice this instance sees for the first time. */
  onNotice?: (n: Notice) => void;
}) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const seen = useRef(new Set<string>());
  const onNoticeRef = useRef(onNotice);
  useEffect(() => { onNoticeRef.current = onNotice; }, [onNotice]);

  const load = useCallback(async () => {
    let list: Notice[];
    try { list = await listNotices(); } catch { setNotices([]); return; } // table not set up yet, or signed out
    for (const n of list) {
      if (seen.current.has(n.id)) continue;
      seen.current.add(n.id);
      onNoticeRef.current?.(n);
    }
    setNotices(list);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = createClient();
    let ch: ReturnType<typeof sb.channel> | null = null;
    let alive = true;
    const refresh = () => { void load(); };
    const subscribe = async () => {
      const { session } = await getSessionSafe();
      if (!alive || !session) return;
      ch = sb.channel(`rackline-notices-${session.user.id}-${variant}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "rackline_notices", filter: `user_id=eq.${session.user.id}` }, refresh)
        .subscribe();
    };
    refresh();
    void subscribe();
    const { data: sub } = sb.auth.onAuthStateChange((e) => {
      if (e === "SIGNED_OUT") setNotices([]);
      else if (e === "SIGNED_IN") refresh();
    });
    window.addEventListener(NOTICES_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      if (ch) void sb.removeChannel(ch);
      sub.subscription.unsubscribe();
      window.removeEventListener(NOTICES_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load, variant]);

  if (notices.length === 0) return null;

  const dismiss = async (id: string) => {
    setNotices((l) => l.filter((n) => n.id !== id));
    try { await dismissNotice(id); } catch { /* shows again next load */ }
    window.dispatchEvent(new Event(NOTICES_CHANGED));
  };

  const banner = variant === "banner";
  return (
    <div className={banner ? "space-y-1 border-b border-destructive/40 bg-destructive/5 px-3 py-2" : "space-y-2"}>
      {!banner && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Deleted projects</h3>}
      <ul className={banner ? "space-y-1" : "divide-y divide-border/60"}>
        {notices.map((n) => (
          <li key={n.id} className={`flex flex-wrap items-center justify-between gap-2 text-sm ${banner ? "" : "py-2"}`}>
            <span className="min-w-0">
              <span className="font-medium">{n.project_name}</span> was deleted {n.actor_email ? `by ${n.actor_email}` : "by its owner"}
              <span className="text-muted-foreground"> · {new Date(n.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
            </span>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => dismiss(n.id)}>Dismiss</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
