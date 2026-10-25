"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getSessionSafe } from "@/lib/supabase/client";
import {
  listInvites, listMembers, removeMember, revokeInvite, setMemberRole, transferOwnership,
  type Invite, type Member, type MemberRole, type ProjectRole,
} from "@/lib/rackline/saved-projects";
import { Chip, inputCls } from "./ui";

const ROLE_LABEL: Record<MemberRole, string> = { owner: "Owner", editor: "Can edit (you approve)", copier: "Can view & duplicate", viewer: "Can view" };

// Members + invites for one project. Only owners and Drybulb staff open this;
// every action is re-checked by RLS server-side.
export function ShareDialog({
  projectId, projectName, myRole, staff, onClose, onOwnershipChanged,
}: {
  projectId: string; projectName: string; myRole: ProjectRole; staff: boolean; onClose: () => void;
  /** Ownership moved: the caller's own role may have changed. */
  onOwnershipChanged: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [armOwner, setArmOwner] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([listMembers(projectId), listInvites(projectId)]);
      setMembers(m);
      setInvites(i);
    } catch { setMsg({ tone: "bad", text: "Couldn't load sharing for this project." }); }
  }, [projectId]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); await refresh(); } catch { setMsg({ tone: "bad", text: fail }); } finally { setBusy(false); }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const { session } = await getSessionSafe();
    if (!session) { setMsg({ tone: "bad", text: "Sign in again to invite people." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/rackline/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ projectId, email, role }),
      });
      const data = (await res.json()) as { link?: string; emailed?: boolean; error?: string };
      if (!res.ok || !data.link) throw new Error(data.error || "Couldn't create the invite.");
      setLastLink(data.link);
      setMsg({ tone: "ok", text: data.emailed ? `Invite emailed to ${email}.` : `Invite created. Email isn't configured here, so copy the link below and send it to ${email}.` });
      setEmail("");
      await refresh();
    } catch (err) {
      setMsg({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => setMsg({ tone: "ok", text: "Link copied." }));
  const linkFor = (tok: string) => `${window.location.origin}/invite/${tok}`;
  // Inviting an owner is a staff hand-over: accepting it transfers ownership.
  const roles: MemberRole[] = staff ? ["viewer", "copier", "editor", "owner"] : ["viewer", "copier", "editor"];
  const memberRoles: MemberRole[] = ["viewer", "copier", "editor"];
  const canTransfer = myRole === "owner" || myRole === "staff" || staff;
  const transfer = (m: Member) => act(async () => {
    await transferOwnership(projectId, m.user_id);
    setArmOwner(null);
    setMsg({ tone: "ok", text: `${m.email} is now the owner.` });
    onOwnershipChanged();
  }, "Couldn't transfer ownership.");
  const pending = invites.filter((i) => !i.accepted_at);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-16">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label={`Share ${projectName}`} className="relative w-full max-w-xl space-y-5 rounded-lg border bg-background p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Share “{projectName}”</h2>
            <p className="text-xs text-muted-foreground">Only the people listed here{staff || myRole === "staff" ? "" : " and Drybulb staff"} can open this project and its drawings.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent">✕</button>
        </div>

        <form onSubmit={invite} className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="rl-inv-email">Invite by email</label>
          <div className="flex flex-wrap gap-2">
            <input id="rl-inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" className={inputCls + " min-w-0 flex-1 py-2"} />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)} className={inputCls}>
              {roles.map((r) => <option key={r} value={r}>{r === "owner" ? "Owner (transfers ownership)" : ROLE_LABEL[r]}</option>)}
            </select>
            <Button type="submit" size="sm" disabled={busy || !email}>{busy ? "Sending…" : "Send invite"}</Button>
          </div>
          <p className="text-xs text-muted-foreground">They&apos;ll see it in their projects as soon as they sign in with that address; people without a Drybulb account create one from the emailed link. The invite works only for that email address and expires in 14 days. “View & duplicate” lets them save their own copy to work on. Editors work in their own copy and send you changes; you accept or decline each change, and nothing changes in your project until you do.</p>
        </form>

        {msg && <p className={`text-sm ${msg.tone === "bad" ? "text-destructive" : ""}`}>{msg.text}</p>}
        {lastLink && (
          <div className="flex gap-2">
            <input readOnly value={lastLink} aria-label="Invite link" className={inputCls + " min-w-0 flex-1 font-mono text-xs"} onFocus={(e) => e.target.select()} />
            <Button size="sm" variant="outline" onClick={() => copy(lastLink)}>Copy</Button>
          </div>
        )}

        <div className="space-y-1">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">People with access</h3>
          {armOwner && <p className="text-xs text-destructive">A project has exactly one owner. Transferring makes them the owner and you an editor: your edits will then go to your own copy for their approval. Click Confirm to transfer.</p>}
          <ul className="divide-y divide-border/60">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 truncate font-mono text-xs">{m.email}</span>
                {m.role === "owner" ? (
                  <Chip tone="mute">Owner</Chip>
                ) : (
                  <span className="flex shrink-0 items-center gap-1">
                    <select
                      aria-label={`Role for ${m.email}`} value={m.role} disabled={busy}
                      onChange={(e) => act(() => setMemberRole(projectId, m.user_id, e.target.value as MemberRole), "Couldn't change that role.")}
                      className={inputCls}
                    >
                      {memberRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    {canTransfer && (armOwner === m.user_id
                      ? <Button size="sm" variant="destructive" disabled={busy} onClick={() => transfer(m)}>Confirm</Button>
                      : <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setArmOwner(m.user_id); setTimeout(() => setArmOwner(null), 5000); }}>Make owner</Button>)}
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => removeMember(projectId, m.user_id), "Couldn't remove them.")}>Remove</Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>

        {pending.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pending invites</h3>
            <ul className="divide-y divide-border/60">
              {pending.map((i) => {
                const expired = new Date(i.expires_at) < new Date();
                return (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="min-w-0 truncate font-mono text-xs">{i.email}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Chip tone={expired || i.declined_at ? "bad" : "mute"}>{i.declined_at ? "declined" : expired ? "expired" : ROLE_LABEL[i.role]}</Chip>
                      {!expired && <Button size="sm" variant="outline" onClick={() => copy(linkFor(i.token))}>Copy link</Button>}
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => revokeInvite(i.id), "Couldn't revoke that invite.")}>Revoke</Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
