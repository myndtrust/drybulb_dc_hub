"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { SignInOptions } from "@/components/app/sign-in";
import { PendingInvites } from "./pending-invites";
import { ProjectNotices } from "./project-notices";
import {
  SaveConflict, canShare, canWrite, createProject, deleteProject, getProject, listProjects, updateProject,
  type ProjectRole, type SavedProject, type SavedProjectMeta,
} from "@/lib/rackline/saved-projects";
import { Chip } from "./ui";
import type { RacklineProject } from "@/lib/rackline/types";

export interface Loaded {
  id: string;
  updatedAt: string;
  role: ProjectRole;
  /** Set on a member's own copy: the shared project it came from… */
  sourceId?: string | null;
  /** …and its design when the copy was made (base for the owner's change-by-change review). */
  sourceDoc?: RacklineProject | null;
}

const LINK = "font-medium text-foreground/80 hover:text-foreground hover:underline disabled:opacity-50";
const ROLE_CHIP: Record<ProjectRole, string> = { owner: "owner", editor: "editor", copier: "view & duplicate", viewer: "view only", staff: "staff" };

// "Projects" button + left drawer, matching the Cost Model's saved-models drawer.
// Saves are optimistic-concurrency checked: if the row changed since it was
// opened (another tab), the user chooses Reload or Overwrite. Only projects the
// user is a member of are listed (every project, for Drybulb staff).
export function ProjectsDrawer({
  project, loaded, dirty, signedIn, onOpen, onSaved, onSaveCopy, onRenameCurrent,
}: {
  project: RacklineProject;
  loaded: Loaded | null;
  dirty: boolean;
  signedIn: boolean;
  onOpen: (p: SavedProject) => void;
  onSaved: (meta: SavedProjectMeta) => void;
  /** Editors: save the current design as their own copy of the shared project. */
  onSaveCopy: () => Promise<void>;
  /** Rename the project open in the workbench (it autosaves like any edit). */
  onRenameCurrent: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<SavedProjectMeta[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [armDel, setArmDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    try { setList(await listProjects()); } catch { setError("Couldn't load your projects."); }
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (signedIn) refresh();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, signedIn, refresh]);

  if (!isSupabaseConfigured) return null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) {
      if (e instanceof SaveConflict) setConflict(true);
      else setError("Couldn't complete that. Please try again.");
    } finally { setBusy(false); }
  };
  const save = (force = false) => run(async () => {
    let meta: SavedProjectMeta;
    if (loaded) {
      // Overwrite: re-read the row's current timestamp so the match succeeds.
      const expected = force ? (await listProjects()).find((m) => m.id === loaded.id)?.updated_at ?? loaded.updatedAt : loaded.updatedAt;
      meta = await updateProject(loaded.id, project, expected, loaded.role);
    } else meta = await createProject(project);
    setConflict(false);
    onSaved(meta);
    await refresh();
  });
  const saveAsNew = () => run(async () => { onSaved(await createProject(project)); await refresh(); });
  const rename = (id: string, raw: string) => run(async () => {
    const name = raw.trim();
    setRenaming(null);
    if (!name) return;
    if (id === loaded?.id) onRenameCurrent(name);
    else {
      // Not open here: rename the stored doc directly (owners only; RLS enforces it).
      const sp = await getProject(id);
      if (name !== sp.name) await updateProject(id, { ...sp.doc, name }, sp.updated_at, sp.role);
    }
    setList((l) => l.map((m) => (m.id === id ? { ...m, name } : m)));
  });
  const openOne = (id: string) => run(async () => { onOpen(await getProject(id)); setOpen(false); setConflict(false); });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Projects{dirty && signedIn ? " •" : ""}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside role="dialog" aria-label="Projects" className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-border/60 bg-background shadow-xl">
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <h2 className="text-sm font-semibold">Projects</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">✕</button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {!signedIn ? (
                <div>
                  <p className="mb-3 text-sm text-muted-foreground">Sign in to save projects and their background drawings to your account.</p>
                  <SignInOptions size="sm" align="start" />
                </div>
              ) : (
                <>
                  <div className="rounded-md border bg-muted/40 p-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      {loaded ? <>Editing <span className="font-medium text-foreground">{project.name}</span> <Chip tone="mute">{ROLE_CHIP[loaded.role]}</Chip>{dirty ? " · unsaved changes" : " · saved"}</> : <>Not saved yet: <span className="font-medium text-foreground">{project.name}</span></>}
                    </p>
                    {loaded?.role === "viewer" && <p className="mb-2 text-xs text-muted-foreground">You can view this project. Ask the owner for edit access to make changes.</p>}
                    {loaded?.role === "editor" && <p className="mb-2 text-xs text-muted-foreground">Your edits save to your own copy. From there you can send them to the owner, who accepts or declines each change.</p>}
                    {loaded?.role === "copier" && <p className="mb-2 text-xs text-muted-foreground">You can view this project and save your own duplicate to work on.</p>}
                    <div className="flex gap-2">
                      {loaded?.role === "editor" || loaded?.role === "copier"
                        ? <Button size="sm" className="h-8 flex-1 text-xs" disabled={busy} onClick={() => run(async () => { await onSaveCopy(); await refresh(); })}>{loaded.role === "copier" ? "Duplicate to my projects" : "Save as my copy"}</Button>
                        : <Button size="sm" className="h-8 flex-1 text-xs" disabled={busy || (!!loaded && !canWrite(loaded.role))} onClick={() => save()}>{busy ? "Saving…" : loaded ? "Save changes" : "Save as my project"}</Button>}
                      {loaded && canShare(loaded.role) && <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={saveAsNew}>Save as new</Button>}
                    </div>
                    {conflict && loaded && (
                      <div className="mt-3 space-y-2 rounded-md border border-destructive/40 p-2 text-xs">
                        <p>This project was changed in another tab or session since you opened it.</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openOne(loaded.id)}>Reload theirs</Button>
                          <Button size="sm" variant="destructive" onClick={() => save(true)}>Overwrite</Button>
                        </div>
                      </div>
                    )}
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <ProjectNotices variant="list" />
                  <PendingInvites variant="list" onAccepted={openOne} />
                  {list.length === 0 ? <p className="text-sm text-muted-foreground">No saved projects yet.</p> : (
                    <ul className="divide-y divide-border/60">
                      {list.map((m) => (
                        <li key={m.id} className="py-2">
                          <div className="flex items-start gap-2">
                            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${m.id === loaded?.id ? "bg-primary" : "bg-transparent"}`} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              {renaming?.id === m.id ? (
                                <input
                                  autoFocus aria-label="New project name" value={renaming.name}
                                  onChange={(e) => setRenaming({ id: m.id, name: e.target.value })}
                                  onBlur={() => rename(m.id, renaming.name)}
                                  onKeyDown={(e) => { if (e.key === "Enter") rename(m.id, renaming.name); else if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                                  className="w-full rounded-md border border-input bg-background px-2 py-0.5 text-sm"
                                />
                              ) : (
                                <button type="button" disabled={busy} onClick={() => openOne(m.id)} title={`Open ${m.name}`}
                                  className={`block w-full break-words text-left text-sm hover:underline ${m.id === loaded?.id ? "font-medium" : ""}`}>{m.name}</button>
                              )}
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                                <Chip tone="mute">{ROLE_CHIP[m.role]}</Chip>
                                <span>{new Date(m.updated_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}</span>
                                <span className="ml-auto flex gap-2">
                                  <button type="button" className={LINK} disabled={busy} onClick={() => openOne(m.id)}>Open</button>
                                  {canWrite(m.role) && <button type="button" className={LINK} disabled={busy} onClick={() => setRenaming({ id: m.id, name: m.name })}>Rename</button>}
                                  {canShare(m.role) && <button type="button" className={`${LINK} ${armDel === m.id ? "text-destructive" : ""}`} disabled={busy} onClick={() => {
                                    if (armDel !== m.id) { setArmDel(m.id); setTimeout(() => setArmDel(null), 3000); return; }
                                    run(async () => { await deleteProject(m.id); setList((l) => l.filter((x) => x.id !== m.id)); });
                                  }}>{armDel === m.id ? "Delete for everyone?" : "Delete"}</button>}
                                </span>
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
