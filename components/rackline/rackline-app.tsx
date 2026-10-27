"use client";

// Rackline DCIM — white-space design workbench: rack layout over a scaled
// background drawing, row elevations, PDU striping, cable pathways, cooling
// sizing, the room single line, and side-by-side scenario comparison.
//
// State is one RacklineProject. Every edit is a `commit` (clone → mutate the
// clone → re-stripe invalid racks → push undo), so committed state is never
// mutated in place. Drags use `live` edits and land as one undo step.
//
// Customer designs live only in access-controlled saved projects (RLS). The
// browser draft of a saved project is tied to the account that opened it and is
// dropped on sign-out or when a different account signs in.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { analyze } from "@/lib/rackline/analysis";
import { migrateProject } from "@/lib/rackline/migrate";
import { blankProject, clone, libIndex, restripeInvalid, uid } from "@/lib/rackline/model";
import { TOOL_NAME } from "@/lib/rackline/constants";
import { fileSafe } from "@/lib/rackline/format";
import { applyChanges, diffChanges, sameDesign, type Change } from "@/lib/rackline/changes";
import type { RacklineProject } from "@/lib/rackline/types";
import {
  SaveConflict, canDuplicate, canEdit, dismissNotice, listNotices, type Notice, canShare, canWrite, createProject, getMyRole, resolveChange, getProject, getProjectVersion, isStaff,
  listChangeRequests, openChangeCopy, proposeChange, updateProject, withdrawChange,
  type ChangeRequest, type ProjectRole, type SavedProject, type SavedProjectMeta,
} from "@/lib/rackline/saved-projects";
import type { Session } from "@supabase/supabase-js";
import { createClient, getSessionSafe, isSupabaseConfigured } from "@/lib/supabase/client";
import { getMyProfile } from "@/lib/supabase/profile";
import { restoreBackground } from "./background";
import { CablesTab } from "./cables-tab";
import { CompareTab } from "./compare-tab";
import { CoolingTab } from "./cooling-tab";
import { ElectricalTab } from "./electrical-tab";
import { ElevationsTab } from "./elevations-tab";
import { LayoutTab, type View } from "./layout-tab";
import { PowerTab } from "./power-tab";
import { NetworkTab } from "./network-tab";
import { ProjectsDrawer, type Loaded } from "./projects-drawer";
import { DrybulbMark } from "@/components/app/drybulb-mark";
import { PendingInvites } from "./pending-invites";
import { NOTICES_CHANGED, ProjectNotices } from "./project-notices";
import { ShareDialog } from "./share-dialog";
import { TABS, type BgView, type Mutator, type TabKey, type TabProps } from "./shared";
import { BarBtn, Btn, IconBtn, Menu, MenuItem, TextField, TitleField } from "./ui";
import { ChevronDown, Copy, Download, FilePlus, FileText, Layers, MoreHorizontal, Redo2, Trash2, Undo2, Upload, Users } from "lucide-react";
import Link from "next/link";
import { AccountMenu } from "@/components/app/account-menu";

const DRAFT_KEY = "rackline.draft";
const HISTORY = 60;
const AUTOSAVE_MS = 1500;
const RECHECK_MS = 30_000;

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString();
};

interface Draft { project: RacklineProject; loaded: Loaded | null; savedJson: string | null; uid?: string | null }

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return { ...d, project: migrateProject(d.project) };
  } catch {
    return null;
  }
}

const noop = () => () => {};
/** The workbench reads localStorage on first render, so it only mounts client-side. */
export function RacklineApp() {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) {
    return (
      <div className="rackline flex min-h-0 flex-1 items-center justify-center">
        <h1 className="flex items-center gap-2 text-sm text-muted-foreground"><DrybulbMark size={20} />{TOOL_NAME}</h1>
      </div>
    );
  }
  return <Workbench />;
}

function Workbench() {
  const [init] = useState(() => readDraft());
  // A cached saved project is held back until the session proves it belongs to this account.
  const pending = useRef(init?.loaded ? init : null);
  const [project, setProject] = useState<RacklineProject>(() => (init && !init.loaded ? init.project : blankProject()));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [savedJson, setSavedJson] = useState<string | null>(init && !init.loaded ? init.savedJson : null);
  const [uidNow, setUidNow] = useState<string | null>(null);
  const [staff, setStaff] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>("layout");
  const [selRack, setSelRack] = useState<string | null>(null);
  const [bg, setBg] = useState<BgView>({});
  const [view, setView] = useState<View>({ tx: 120, ty: 160, z: 42 });
  const [fitted, setFitted] = useState(false);
  const [toastMsg, setToastMsg] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [scnArm, setScnArm] = useState(false);
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  // One copy per project: the Supabase row. Only the owner (or staff) writes it,
  // with autosave; every open copy follows it (Realtime + a recheck on focus /
  // every 30 s). A save that lands while you have unsaved edits raises `conflict`
  // instead of being merged. Editors' edits autosave to their OWN copy (created on
  // the first edit); from it they send a change request that the owner previews
  // and accepts or rejects explicitly.
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const ownSaves = useRef(new Set<string>());
  const [incoming, setIncoming] = useState<ChangeRequest[]>([]); // owner: open requests on this project
  const [mine, setMine] = useState<ChangeRequest | null>(null);   // my latest request on the original
  const [srcRole, setSrcRole] = useState<{ id: string; role: ProjectRole | null } | null>(null);
  const [preview, setPreview] = useState<ChangeRequest | null>(null);
  const previewRef = useRef<{ req: ChangeRequest; back: RacklineProject } | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busyReq, setBusyReq] = useState(false);
  const forking = useRef(false);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);
  const liveSnap = useRef<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const importIn = useRef<HTMLInputElement>(null);
  // Edits read the latest project from here, not from a state updater, so a
  // StrictMode double-invoke can never push two undo entries.
  const projRef = useRef(project);
  const put = (p: RacklineProject) => { projRef.current = p; setProject(p); };

  const scenario = project.scenarios.find((s) => s.id === project.active) ?? project.scenarios[0];
  const lib = useMemo(() => libIndex(project.lib), [project.lib]);
  const an = useMemo(() => analyze(scenario, { lib, elec: project.elec }), [scenario, lib, project.elec]);
  const json = useMemo(() => JSON.stringify(project), [project]);
  const dirty = savedJson !== json;

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastMsg(""), 3500);
  }, []);

  const uidRef = useRef<string | null>(null);
  const loadedRef = useRef(loaded);
  useEffect(() => { loadedRef.current = loaded; }, [loaded]);
  const savedJsonRef = useRef(savedJson);
  useEffect(() => { savedJsonRef.current = savedJson; }, [savedJson]);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Autosave a local draft so a refresh never loses work (cloud save is explicit).
  useEffect(() => {
    if (pending.current || previewRef.current) return; // held-back draft / previewing someone's changes
    const t = setTimeout(() => {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ project, loaded, savedJson, uid: uidNow })); } catch { /* quota / private mode */ }
    }, 800);
    return () => clearTimeout(t);
  }, [project, loaded, savedJson, uidNow]);

  // Fetch the stored background whenever the project's drawing changes.
  const bgPath = project.bg?.path;
  useEffect(() => {
    let cancel = false;
    if (project.bg && bgPath && !bg.img && !bg.dxf) restoreBackground(project.bg).then((v) => { if (!cancel) setBg(v); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgPath]);

  const stamp = useCallback(() => setHist({ undo: undoRef.current.length, redo: redoRef.current.length }), []);
  const pushUndo = useCallback((snap: string) => {
    undoRef.current.push(snap);
    if (undoRef.current.length > HISTORY) undoRef.current.shift();
    redoRef.current = [];
    stamp();
  }, [stamp]);

  const apply = useCallback((base: RacklineProject, fn: Mutator) => {
    const d = clone(base);
    const s = d.scenarios.find((x) => x.id === d.active) ?? d.scenarios[0];
    fn(d, s);
    const active = d.scenarios.find((x) => x.id === d.active) ?? d.scenarios[0];
    restripeInvalid(active, libIndex(d.lib));
    return d;
  }, []);

  const commit = useCallback((fn: Mutator) => {
    const cur = projRef.current;
    pushUndo(JSON.stringify(cur));
    put(apply(cur, fn));
  }, [apply, pushUndo]);
  const beginLive = useCallback(() => { liveSnap.current = JSON.stringify(projRef.current); }, []);
  const live = useCallback((fn: Mutator) => put(apply(projRef.current, fn)), [apply]);
  const endLive = useCallback((changed: boolean) => {
    if (changed && liveSnap.current) pushUndo(liveSnap.current);
    liveSnap.current = null;
  }, [pushUndo]);

  const undo = useCallback(() => {
    if (previewRef.current) return;
    const s = undoRef.current.pop();
    if (!s) return;
    redoRef.current.push(JSON.stringify(projRef.current));
    put(JSON.parse(s));
    stamp();
  }, [stamp]);
  const redo = useCallback(() => {
    if (previewRef.current) return;
    const s = redoRef.current.pop();
    if (!s) return;
    undoRef.current.push(JSON.stringify(projRef.current));
    put(JSON.parse(s));
    stamp();
  }, [stamp]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /** Replace the whole project (open / new / import): history and view reset. */
  const replaceProject = (p: RacklineProject, l: Loaded | null, saved: string | null) => {
    undoRef.current = [];
    redoRef.current = [];
    stamp();
    put(p);
    setLoaded(l);
    setSavedJson(saved);
    setSelRack(null);
    setBg({});
    setFitted(false);
    setTab("layout");
  };

  const openSaved = (sp: SavedProject) => {
    setConflict(false);
    previewRef.current = null;
    setPreview(null);
    replaceProject(sp.doc, { id: sp.id, updatedAt: sp.updated_at, role: sp.role, sourceId: sp.source_id, sourceDoc: sp.source_doc }, JSON.stringify(sp.doc));
  };
  /** Start a new project. Signed in, it is saved straight away (you own it) so autosave takes over. */
  const newProject = async (name = "New project") => {
    const doc = blankProject(name);
    setConflict(false);
    previewRef.current = null;
    setPreview(null);
    if (!signedIn) { replaceProject(doc, null, null); return; }
    const m = await createProject(doc);
    ownSaves.current.add(m.updated_at);
    replaceProject(doc, { id: m.id, updatedAt: m.updated_at, role: "owner" }, JSON.stringify(doc));
    toast(`Created ${name}`);
  };
  const editable = (!loaded || canEdit(loaded.role)) && !preview;

  /** The open project was deleted or unshared: close it and say why. */
  const [gone, setGone] = useState<{ name: string; deleted: boolean; by: string | null } | null>(null);
  /** `restoring`: from a cached draft that never opened, so nothing is loaded yet. */
  const closeGone = useCallback(async (id: string, notice?: Notice, restoring?: { name: string }) => {
    const isOpen = () => restoring || loadedRef.current?.id === id;
    if (!isOpen()) return;
    let n = notice;
    if (!n) n = (await listNotices().catch(() => [] as Notice[])).find((x) => x.project_id === id);
    if (!isOpen()) return;
    setGone({ name: n?.project_name ?? restoring?.name ?? projRef.current.name, deleted: Boolean(n), by: n?.actor_email ?? null });
    previewRef.current = null;
    setPreview(null);
    setConflict(false);
    replaceProject(blankProject(), null, null);
    // This banner replaces the notice in the list.
    if (n) { await dismissNotice(n.id).catch(() => {}); window.dispatchEvent(new Event(NOTICES_CHANGED)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Take the latest saved version in place: keeps the tab, view and selection. */
  const applyRemote = useCallback((sp: SavedProject) => {
    const bgChanged = sp.doc.bg?.path !== projRef.current.bg?.path;
    undoRef.current = [];
    redoRef.current = [];
    stamp();
    put(sp.doc);
    setLoaded({ id: sp.id, updatedAt: sp.updated_at, role: sp.role, sourceId: sp.source_id, sourceDoc: sp.source_doc });
    setSavedJson(JSON.stringify(sp.doc));
    if (bgChanged) setBg({});
    setConflict(false);
  }, [stamp]);

  /** Compare with the server copy; follow it, or flag a conflict if we have unsaved edits. */
  const syncFromServer = useCallback(async () => {
    const l = loadedRef.current;
    if (!l || savingRef.current || previewRef.current) return;
    let v: string | null, role: ProjectRole | null;
    try { [v, role] = await Promise.all([getProjectVersion(l.id), getMyRole(l.id)]); } catch { return; } // offline: try again later
    const now = loadedRef.current;
    if (!now || now.id !== l.id || savingRef.current) return;
    if (v === null) { closeGone(l.id); return; }
    // The owner may have changed our access while this copy was open.
    if (role && role !== now.role) {
      setLoaded({ ...now, role });
      loadedRef.current = { ...now, role };
      toast(role === "editor" ? "You can now edit: your changes save to your own copy" : canWrite(role) ? "You can now edit this project" : "Your access changed to view only");
    }
    if (v === now.updatedAt || ownSaves.current.has(v)) return;
    if (dirtyRef.current) { setConflict(true); return; }
    try { applyRemote(await getProject(l.id)); toast("Updated to the latest version"); } catch { /* next check retries */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRemote, toast]);

  /** Write this copy to the project row (owners / staff only). */
  const saveNow = useCallback(async () => {
    const l = loadedRef.current;
    if (!l || !canWrite(l.role) || savingRef.current) return;
    const doc = projRef.current;
    const snap = JSON.stringify(doc);
    savingRef.current = true;
    setSaving(true);
    try {
      const m = await updateProject(l.id, doc, l.updatedAt, l.role);
      ownSaves.current.add(m.updated_at);
      setLoaded({ ...l, updatedAt: m.updated_at });
      setSavedJson(snap);
    } catch (e) {
      if (e instanceof SaveConflict) setConflict(true);
      else toast("Couldn't save. Changes are kept here and will retry.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [toast]);

  /** Editors / copiers: save the current design as their own copy, linked to the shared original. */
  const saveAsMyCopy = useCallback(async () => {
    const l = loadedRef.current;
    if (!l || forking.current || !canDuplicate(l.role)) return;
    forking.current = true;
    const doc = clone(projRef.current);
    // Name the copy after its owner: their profile name, else their account email.
    const who = await getMyProfile().then((p) => p?.full_name?.trim(), () => undefined)
      || (await getSessionSafe()).session?.user.email
      || "my copy";
    doc.name = `${doc.name} (${who})`;
    // The original as last saved (not this browser's edits): what changes are measured against.
    const sourceDoc = savedJsonRef.current ? (JSON.parse(savedJsonRef.current) as RacklineProject) : null;
    try {
      const m = await createProject(doc, l.id, sourceDoc);
      put(doc);
      setLoaded({ id: m.id, updatedAt: m.updated_at, role: "owner", sourceId: l.id, sourceDoc });
      setSavedJson(JSON.stringify(doc));
      setConflict(false);
      toast(l.role === "copier" ? "Duplicated to your projects." : "Saved to your own copy. The owner's project is unchanged.");
    } catch {
      toast("Couldn't save your copy. Try again.");
    } finally {
      forking.current = false;
    }
  }, [toast]);

  // Autosave shortly after edits stop: owners to the project, editors to a new copy of their own.
  useEffect(() => {
    if (!loaded || !dirty || conflict || preview) return;
    if (loaded.role === "editor" && savedJson && sameDesign(project, JSON.parse(savedJson) as RacklineProject)) return;
    const write = canWrite(loaded.role) ? saveNow : loaded.role === "editor" ? saveAsMyCopy : null;
    if (!write) return;
    const t = setTimeout(() => { void write(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, loaded, dirty, conflict, preview, saveNow, saveAsMyCopy]);

  // Change requests. Owners see open requests on this project; in their own copy,
  // editors see the request they sent to the original.
  const loadedId = loaded?.id;
  const loadedSource = loaded?.sourceId ?? null;
  useEffect(() => {
    let alive = true;
    if (loadedSource) getMyRole(loadedSource).then((role) => { if (alive) setSrcRole({ id: loadedSource, role }); }, () => {});
    return () => { alive = false; };
  }, [loadedSource]);
  const target = loadedSource && srcRole?.id === loadedSource && srcRole.role === "editor" ? loadedSource : null;
  const mineRef = useRef(mine);
  useEffect(() => { mineRef.current = mine; }, [mine]);
  const refreshRequests = useCallback(async () => {
    const l = loadedRef.current;
    const me = uidRef.current;
    if (!l || !me) { setIncoming([]); setMine(null); return; }
    try {
      setIncoming(canWrite(l.role) ? (await listChangeRequests(l.id)).filter((r) => r.status === "open" && r.author_id !== me) : []);
      const t = l.sourceId;
      const latest = t ? (await listChangeRequests(t)).find((r) => r.author_id === me) ?? null : null;
      const prev = mineRef.current;
      if (prev && latest && prev.id === latest.id && prev.status === "open" && latest.status !== "open") {
        toast(latest.status === "accepted" ? "The owner accepted your changes"
          : latest.status === "partial" ? "The owner accepted some of your changes" : "The owner declined your changes");
      }
      setMine(latest);
    } catch { /* table not set up yet, or offline: try again later */ }
  }, [toast]);
  useEffect(() => {
    void refreshRequests();
  }, [loadedId, loaded?.role, target, refreshRequests]);

  const sendToOwner = async () => {
    const l = loadedRef.current;
    if (!l || !target) return;
    setBusyReq(true);
    try {
      const base = await getProjectVersion(target);
      if (!base) { toast("The original project is no longer shared with you."); return; }
      await proposeChange(target, projRef.current, base, l.id, l.sourceDoc ?? null);
      toast("Sent to the owner for approval");
      await refreshRequests();
    } catch (e) {
      toast((e as Error).message || "Couldn't send. Try again.");
    } finally { setBusyReq(false); }
  };
  const withdraw = async () => {
    if (!mine) return;
    try { await withdrawChange(mine.id); setMine(null); toast("Request withdrawn"); } catch { toast("Couldn't withdraw. Try again."); }
  };

  /** The canvas during review: the owner's version with the ticked changes applied. */
  const showMerged = (back: RacklineProject, r: ChangeRequest, keys: Set<string>) => {
    const merged = applyChanges(r.base_doc, r.doc, back, keys);
    if (merged.bg?.path !== projRef.current.bg?.path) setBg({});
    put(merged);
  };
  /** Owner: review a request change by change; the canvas shows the result, the project is untouched. */
  const startPreview = async (r: ChangeRequest) => {
    if (dirtyRef.current) await saveNow();
    const back = previewRef.current?.back ?? projRef.current;
    previewRef.current = { req: r, back };
    const list = diffChanges(r.base_doc, r.doc, back);
    const keys = new Set(list.filter((c) => !c.blocked).map((c) => c.key));
    setChanges(list);
    setPicked(keys);
    showMerged(back, r, keys);
    setPreview(r);
  };
  const toggle = (key: string) => {
    const pv = previewRef.current;
    if (!pv) return;
    const next = new Set(picked);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPicked(next);
    showMerged(pv.back, pv.req, next);
  };
  const pickAll = (on: boolean) => {
    const pv = previewRef.current;
    if (!pv) return;
    const next = new Set(on ? changes.filter((c) => !c.blocked).map((c) => c.key) : []);
    setPicked(next);
    showMerged(pv.back, pv.req, next);
  };
  const endPreview = () => {
    const pv = previewRef.current;
    previewRef.current = null;
    setPreview(null);
    if (!pv) return;
    if (pv.back.bg?.path !== projRef.current.bg?.path) setBg({});
    put(pv.back);
  };
  /** Owner: leave the project alone and open the editor's own copy (view-only, live). */
  const openTheirCopy = async (r: ChangeRequest) => {
    setBusyReq(true);
    try {
      const id = await openChangeCopy(r.id);
      if (previewRef.current) endPreview();
      openSaved(await getProject(id));
      toast(`Opened ${r.author_email}'s copy. Your project is unchanged.`);
    } catch (e) {
      toast((e as Error).message || "Couldn't open their copy.");
    } finally { setBusyReq(false); }
  };
  /**
   * Owner: apply the chosen changes onto the current version (an ordinary owner
   * save) and close the request. `keys` null = every change that can apply.
   */
  const decide = async (r: ChangeRequest, keys: Set<string> | null) => {
    const l = loadedRef.current;
    if (!l) return;
    setBusyReq(true);
    try {
      if (dirtyRef.current && !previewRef.current) await saveNow();
      const current = (await getProject(l.id)).doc; // always merge onto the saved version
      const all = diffChanges(r.base_doc, r.doc, current);
      const chosen = keys ?? new Set(all.filter((c) => !c.blocked).map((c) => c.key));
      const applicable = all.filter((c) => !c.blocked);
      const n = applicable.filter((c) => chosen.has(c.key)).length;
      if (previewRef.current) { previewRef.current = null; setPreview(null); }
      if (n > 0) {
        const merged = applyChanges(r.base_doc, r.doc, current, chosen);
        const now = loadedRef.current ?? l;
        const m = await updateProject(l.id, merged, now.updatedAt, l.role);
        ownSaves.current.add(m.updated_at);
        undoRef.current = [];
        redoRef.current = [];
        stamp();
        if (merged.bg?.path !== projRef.current.bg?.path) setBg({});
        put(merged);
        setLoaded({ ...now, updatedAt: m.updated_at });
        setSavedJson(JSON.stringify(merged));
      } else {
        put(current);
      }
      await resolveChange(r.id, n === 0 ? "rejected" : n === applicable.length ? "accepted" : "partial");
      toast(n === 0 ? "Changes declined. Your project is unchanged."
        : n === applicable.length ? `Accepted all changes from ${r.author_email}` : `Accepted ${n} of ${applicable.length} changes`);
      await refreshRequests();
    } catch (e) {
      if (e instanceof SaveConflict) { toast("Your project changed elsewhere. Reload and review again."); void syncFromServer(); }
      else toast((e as Error).message || "That didn't work. Try again.");
    } finally { setBusyReq(false); }
  };

  // Follow other members' saves: Realtime, plus a recheck on focus and every 30 s.
  useEffect(() => {
    if (!loadedId || !isSupabaseConfigured) return;
    const sb = createClient();
    const reqs = () => { void refreshRequests(); };
    let ch = sb.channel(`rackline-project-${loadedId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rackline_projects", filter: `id=eq.${loadedId}` }, () => { void syncFromServer(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "rackline_project_members", filter: `project_id=eq.${loadedId}` }, () => { void syncFromServer(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "rackline_change_requests", filter: `project_id=eq.${loadedId}` }, reqs);
    if (target) ch = ch.on("postgres_changes", { event: "*", schema: "public", table: "rackline_change_requests", filter: `project_id=eq.${target}` }, reqs);
    ch.subscribe();
    const check = () => { if (document.visibilityState === "visible") { void syncFromServer(); reqs(); } };
    const iv = setInterval(check, RECHECK_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      void sb.removeChannel(ch);
      clearInterval(iv);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [loadedId, target, syncFromServer, refreshRequests]);

  const keepMine = async () => {
    const l = loadedRef.current;
    if (!l) return;
    try {
      const v = await getProjectVersion(l.id);
      if (!v) return;
      setLoaded({ ...l, updatedAt: v }); // autosave then overwrites with this copy
      setConflict(false);
    } catch { toast("Couldn't reach the server. Try again."); }
  };
  const takeTheirs = async () => {
    const l = loadedRef.current;
    if (!l) return;
    try { applyRemote(await getProject(l.id)); toast("Loaded the latest version"); } catch { toast("Couldn't reach the server. Try again."); }
  };

  // Session: saved projects, sharing, bucket storage and Cloud Run calls.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    const onSession = async (s: Session | null) => {
      setSignedIn(Boolean(s));
      setUidNow(s?.user.id ?? null);
      uidRef.current = s?.user.id ?? null;
      setStaff(s ? await isStaff().catch(() => false) : false);
    };
    getSessionSafe().then(async ({ session }) => {
      if (!alive) return;
      await onSession(session);
      const d = pending.current;
      pending.current = null;
      if (d && session && d.uid === session.user.id && d.loaded) {
        // The server row is the project; the local draft only carries unsaved edits.
        try {
          const [v, role] = await Promise.all([getProjectVersion(d.loaded.id), getMyRole(d.loaded.id)]);
          const draftDirty = d.savedJson !== JSON.stringify(d.project);
          // The draft's role can be stale (the owner may have changed it since): use the current one.
          const current = { ...d.loaded, role: role ?? d.loaded.role };
          if (v === null) await closeGone(d.loaded.id, undefined, { name: d.project.name });
          else if (v === d.loaded.updatedAt) replaceProject(d.project, current, d.savedJson);
          else if (!draftDirty) openSaved(await getProject(d.loaded.id));
          else { replaceProject(d.project, current, d.savedJson); setConflict(true); }
        } catch {
          replaceProject(d.project, d.loaded, d.savedJson); // offline: keep working locally; sync resumes later
        }
      }
      // Deep link from an invite or a shared URL: /dashboard/tools/rackline?project=<id>
      const want = new URLSearchParams(window.location.search).get("project");
      if (want && session) {
        try { openSaved(await getProject(want)); } catch { toast("That project isn't available to this account."); }
        window.history.replaceState(null, "", window.location.pathname);
      }
    });
    const { data: sub } = createClient().auth.onAuthStateChange((e, s) => {
      onSession(s);
      if (e === "SIGNED_OUT") {
        try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
        if (loadedRef.current) replaceProject(blankProject(), null, null);
      }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = (name: string, data: string, type: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const exportSvg = () => {
    const s = document.getElementById("rl-layout-svg");
    if (!s) { toast("Open the Layout tab first"); return; }
    const cs = getComputedStyle(s);
    let x = s.outerHTML.replace(/var\((--[\w-]+)\)/g, (m, v) => cs.getPropertyValue(v).trim() || m);
    x = x.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${s.clientWidth}" height="${s.clientHeight}" style="background:${cs.getPropertyValue("--rl-canvas")}" `);
    download(`${fileSafe(scenario.name)}_layout.svg`, x, "image/svg+xml");
  };
  const importJson = async (f: File) => {
    try {
      const p = migrateProject(JSON.parse(await f.text()));
      replaceProject(p, null, null);
      toast(p.bg ? "Project imported. Reload its background drawing." : "Project imported");
    } catch (e) {
      toast((e as Error).message || "That file is not a project export from this tool");
    }
  };

  const props: TabProps = {
    project, scenario, an, lib, commit, live, beginLive, endLive, toast,
    goTab: setTab, selRack, setSelRack, bg, setBg,
  };

  const status = toastMsg || (preview ? "Previewing proposed changes" : loaded
    ? (!editable ? "View only · live" : conflict ? "Not saved: newer version exists"
      : loaded.role === "editor" ? (dirty ? "Saving to your copy…" : "Shared · edits go to your copy")
      : saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved")
    : signedIn ? "Not saved to your account" : "Draft in this browser");
  const mineChanged = mine?.status === "open" && !sameDesign(mine.doc, project);
  const applicable = changes.filter((c) => !c.blocked);
  const groups = [...new Set(changes.map((c) => c.group))];

  return (
    <div className="rackline flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      {gone && (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {gone.deleted
              ? <><span className="font-medium">{gone.name}</span> was deleted{gone.by ? ` by ${gone.by}` : " by its owner"} and is no longer available. Any copy you saved of your own is kept.</>
              : <><span className="font-medium">{gone.name}</span> is no longer shared with you.</>}
          </span>
          <Btn onClick={() => setGone(null)}>Dismiss</Btn>
        </div>
      )}
      <ProjectNotices onNotice={(n) => { void closeGone(n.project_id, n); }} />
      <PendingInvites onAccepted={async (id) => {
        try { const sp = await getProject(id); openSaved(sp); toast(`Opened ${sp.name}`); } catch { toast("That project isn't available to this account."); }
      }} />
      {conflict && loaded && (canWrite(loaded.role) ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">Someone else saved this project while you had unsaved changes. Pick which version to keep. There is only one copy.</span>
          <Btn onClick={takeTheirs}>Load latest version</Btn>
          <Btn tone="danger" onClick={keepMine}>Keep mine (overwrite)</Btn>
        </div>
      ) : (
        <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">The owner saved a newer version while you had unsaved edits.</span>
          <Btn onClick={takeTheirs}>Load latest (discard my edits)</Btn>
          {loaded.role === "editor" && <Btn tone="primary" onClick={() => void saveAsMyCopy()}>Save mine as my copy</Btn>}
        </div>
      ))}
      {preview && (
        <div role="alert" className="border-b border-[var(--rl-accent)] bg-[var(--rl-accent-soft)] px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1">
              Reviewing changes from <span className="font-medium">{preview.author_email}</span> ({ago(preview.created_at)}).
              The canvas shows your project with the ticked changes; nothing is saved until you accept.
            </span>
            <Btn tone="primary" disabled={busyReq || picked.size === 0} onClick={() => decide(preview, picked)}>
              {picked.size === applicable.length ? "Accept all" : `Accept ${picked.size} of ${applicable.length}`}
            </Btn>
            <Btn disabled={busyReq} onClick={() => decide(preview, new Set())}>Decline all</Btn>
            {preview.copy_id && <Btn disabled={busyReq} onClick={() => openTheirCopy(preview)}>Open their copy instead</Btn>}
            <Btn onClick={endPreview}>Back to my version</Btn>
          </div>
          {changes.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">Everything in this request is already in your project. Accept or decline to close it.</p>
          ) : (
            <div className="mt-2 max-h-52 overflow-y-auto rounded-md border bg-background p-2 text-xs">
              <div className="mb-1 flex gap-3 text-muted-foreground">
                <button type="button" className="hover:text-foreground hover:underline" onClick={() => pickAll(true)}>Tick all</button>
                <button type="button" className="hover:text-foreground hover:underline" onClick={() => pickAll(false)}>Untick all</button>
                {preview.base_doc === null && <span>Sent before change tracking: every difference from your version is listed.</span>}
              </div>
              {groups.map((g) => (
                <div key={g} className="mb-1">
                  <div className="font-semibold text-muted-foreground">{g}</div>
                  {changes.filter((c) => c.group === g).map((c) => (
                    <label key={c.key} className={`flex items-center gap-2 py-0.5 ${c.blocked ? "opacity-50" : "cursor-pointer"}`}>
                      <input type="checkbox" disabled={c.blocked} checked={picked.has(c.key)} onChange={() => toggle(c.key)} />
                      <span className={c.kind === "removed" ? "text-destructive" : c.kind === "added" ? "text-[var(--rl-accent)]" : ""}>{c.label}</span>
                      {c.conflict && <span className="rounded border border-destructive/40 px-1 text-[10px] text-destructive" title="You changed this too since they started; accepting replaces your edit">you changed this too</span>}
                      {c.blocked && <span className="text-[10px] text-muted-foreground">(its scenario was deleted)</span>}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!preview && incoming.length > 0 && (
        <div className="space-y-1 border-b bg-primary/5 px-3 py-2 text-sm">
          {incoming.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1"><span className="font-medium">{r.author_email}</span> sent changes to this project for your approval · {ago(r.created_at)}{r.note ? ` · “${r.note}”` : ""}</span>
              <Btn tone="primary" disabled={busyReq} onClick={() => startPreview(r)}>Review changes</Btn>
              <Btn disabled={busyReq} onClick={() => decide(r, null)}>Accept all</Btn>
              <Btn disabled={busyReq} onClick={() => decide(r, new Set())}>Decline</Btn>
              {r.copy_id && <Btn disabled={busyReq} onClick={() => openTheirCopy(r)}>Open their copy</Btn>}
            </div>
          ))}
        </div>
      )}
      {loaded && loadedSource && !target && srcRole?.id === loadedSource && canWrite(srcRole.role) && !canWrite(loaded.role) && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">You&apos;re viewing a member&apos;s own copy of your project (view only, live). Your project is unchanged.</span>
          <Btn onClick={async () => { try { openSaved(await getProject(loadedSource)); } catch { toast("Couldn't open your project."); } }}>Back to my project</Btn>
        </div>
      )}
      {loaded?.role === "copier" && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">You can view this project and save your own duplicate to work on. The original stays as it is.</span>
          <Btn tone="primary" onClick={() => void saveAsMyCopy()}>Duplicate to my projects</Btn>
        </div>
      )}
      {loaded && target && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            This is your copy of a shared project. Edits here don&apos;t change the original.{" "}
            {mine?.status === "open" ? <span className="text-muted-foreground">Sent for approval {ago(mine.created_at)}{mineChanged ? " · you've changed it since" : " · waiting for the owner"}.</span>
              : mine?.status === "accepted" ? <span className="text-muted-foreground">The owner accepted your last changes.</span>
              : mine?.status === "partial" ? <span className="text-muted-foreground">The owner accepted some of your last changes.</span>
              : mine?.status === "rejected" ? <span className="text-muted-foreground">The owner declined your last changes.</span> : null}
          </span>
          {(mine?.status !== "open" || mineChanged) && <Btn tone="primary" disabled={busyReq || dirty} onClick={sendToOwner}>{mine?.status === "open" ? "Send updated changes" : "Send changes to the owner"}</Btn>}
          {mine?.status === "open" && <Btn disabled={busyReq} onClick={withdraw}>Withdraw</Btn>}
          <Btn onClick={async () => { try { openSaved(await getProject(target)); } catch { toast("The original isn't available to this account."); } }}>Open original</Btn>
        </div>
      )}
      <header className="relative z-30 flex h-12 shrink-0 items-center gap-1 border-b bg-background px-2 sm:px-3">
        <h1 className="sr-only">{TOOL_NAME}</h1>
        <Link href="/tools" title="All tools" className="flex shrink-0 items-center gap-2 rounded-md p-1 transition-colors hover:bg-accent">
          <DrybulbMark size={22} />
          <span className="hidden whitespace-nowrap text-sm font-semibold tracking-tight 2xl:inline">AI Factory Infrastructure Design</span>
        </Link>
        <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <ProjectsDrawer
          project={project} loaded={loaded} dirty={dirty} signedIn={signedIn}
          onOpen={(sp) => { openSaved(sp); toast(`Opened ${sp.name}`); }}
          onSaved={(m: SavedProjectMeta) => {
            ownSaves.current.add(m.updated_at);
            setConflict(false);
            const same = m.id === loaded?.id;
            setLoaded({ id: m.id, updatedAt: m.updated_at, role: m.role, sourceId: same ? loaded.sourceId : null, sourceDoc: same ? loaded.sourceDoc : null });
            setSavedJson(json);
            toast("Saved");
          }}
          onSaveCopy={saveAsMyCopy}
          onNew={newProject}
          onRenameCurrent={(name) => commit((p) => { p.name = name; })}
        />
        <TitleField
          label={loaded && !canWrite(loaded.role) ? "Project name (only the owner can rename it)" : "Project name: click to rename"}
          value={project.name} disabled={!editable || (!!loaded && !canWrite(loaded.role))}
          onChange={(v) => commit((p) => { p.name = v; })}
        />
        {loaded && !editable && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">View only</span>}
        {loaded && canShare(loaded.role) && (
          <BarBtn onClick={() => setShareOpen(true)} title="Share this project"><Users className="h-4 w-4" aria-hidden="true" /><span className="hidden lg:inline">Share</span></BarBtn>
        )}

        <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <div className="flex shrink-0 items-center gap-0.5">
          <Layers className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <select
            aria-label="Scenario" title="Scenario" value={scenario.id}
            onChange={(e) => { const id = e.target.value; commit((p) => { p.active = id; }); setSelRack(null); }}
            className="h-8 max-w-52 cursor-pointer truncate rounded-md border border-transparent bg-transparent pl-1.5 pr-6 text-sm font-medium text-foreground hover:border-input focus:border-input focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {project.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Menu label="Scenario actions" align="left" width="w-64" trigger={<MoreHorizontal className="h-4 w-4" aria-hidden="true" />}>
            {(close) => (
              <>
                <div className="px-2 pb-1 pt-1.5">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground" htmlFor="rl-scn-name">Scenario name</label>
                  <TextField id="rl-scn-name" width="w-full" value={scenario.name} onChange={(v) => commit((_p, s) => { s.name = v; })} />
                </div>
                <div className="my-1 border-t" />
                <MenuItem onClick={() => { commit((p, s) => { const c = clone(s); c.id = uid(); c.name = s.name + " (copy)"; p.scenarios.push(c); p.active = c.id; }); close(); }}>
                  <Copy className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Duplicate scenario
                </MenuItem>
                <MenuItem danger disabled={project.scenarios.length < 2} onClick={() => {
                  if (!scnArm) { setScnArm(true); setTimeout(() => setScnArm(false), 3000); return; }
                  setScnArm(false);
                  commit((p, s) => { p.scenarios = p.scenarios.filter((x) => x.id !== s.id); p.active = p.scenarios[0].id; });
                  close();
                }}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />{scnArm ? "Click again to delete" : "Delete scenario"}
                </MenuItem>
              </>
            )}
          </Menu>
        </div>

        <div className="min-w-2 flex-1" />

        <span role="status" title={status} className="flex shrink-0 items-center gap-1.5 rounded-full px-2 text-xs text-muted-foreground">
          <span className={`h-2 w-2 shrink-0 rounded-full ${conflict ? "bg-[var(--rl-bad)]" : saving || dirty ? "bg-[var(--rl-warn)]" : loaded ? "bg-[var(--rl-ok)]" : "bg-muted-foreground/50"}`} aria-hidden="true" />
          <span className="hidden max-w-56 truncate xl:inline">{status}</span>
        </span>
        <div className="flex shrink-0 items-center">
          <IconBtn label="Undo (Ctrl+Z)" disabled={!hist.undo || !!preview} onClick={undo}><Undo2 className="h-4 w-4" /></IconBtn>
          <IconBtn label="Redo (Ctrl+Y)" disabled={!hist.redo || !!preview} onClick={redo}><Redo2 className="h-4 w-4" /></IconBtn>
        </div>
        <div className="flex h-8 shrink-0 items-center rounded-md bg-muted p-0.5" role="group" aria-label="Units">
          {(["ft", "m"] as const).map((u) => (
            <button key={u} type="button" aria-pressed={project.units === u} onClick={() => commit((p) => { p.units = u; })}
              className={`h-7 rounded px-2 text-xs font-medium transition-colors ${project.units === u ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{u}</button>
          ))}
        </div>
        <Menu label="File" trigger={<><FileText className="h-4 w-4" aria-hidden="true" /><span className="hidden lg:inline">File</span><ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /></>}>
          {(close) => (
            <>
              <MenuItem onClick={() => { close(); newProject().catch(() => toast("Couldn't create the project. Try again.")); }}><FilePlus className="h-4 w-4 text-muted-foreground" aria-hidden="true" />New project</MenuItem>
              <MenuItem onClick={() => { close(); importIn.current?.click(); }}><Upload className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Import project JSON…</MenuItem>
              <div className="my-1 border-t" />
              {editable && <MenuItem onClick={() => { close(); download(`${fileSafe(project.name)}.rackline.json`, JSON.stringify(project, null, 1), "application/json"); }}><Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Export project JSON</MenuItem>}
              <MenuItem onClick={() => { close(); exportSvg(); }}><Download className="h-4 w-4 text-muted-foreground" aria-hidden="true" />Export layout SVG</MenuItem>
            </>
          )}
        </Menu>
        <input ref={importIn} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} />
        <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <AccountMenu />
      </header>
      <nav className="flex overflow-x-auto border-b px-2" aria-label="Sections">
        {TABS.map(([k, l]) => (
          <button
            key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3.5 py-2 text-sm ${tab === k ? "border-[var(--rl-accent)] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >{l}</button>
        ))}
      </nav>
      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        {tab === "layout" && <LayoutTab {...props} view={view} setView={setView} fitOnMount={!fitted} onFitted={() => setFitted(true)} signedIn={signedIn} projectId={loaded?.id ?? null} editable={editable} />}
        {tab === "elev" && <ElevationsTab {...props} />}
        {tab === "power" && <PowerTab {...props} />}
        {tab === "cables" && <CablesTab {...props} download={download} onDrawTrays={() => setTab("layout")} />}
        {tab === "network" && <NetworkTab {...props} download={download} />}
        {tab === "cooling" && <CoolingTab {...props} />}
        {tab === "sld" && <ElectricalTab {...props} />}
        {tab === "compare" && <CompareTab {...props} signedIn={signedIn} />}
      </main>
      {shareOpen && loaded && (
        <ShareDialog
          projectId={loaded.id} projectName={project.name} myRole={loaded.role} staff={staff} onClose={() => setShareOpen(false)}
          onOwnershipChanged={() => { if (!staff) setShareOpen(false); void syncFromServer(); }}
        />
      )}
    </div>
  );
}
