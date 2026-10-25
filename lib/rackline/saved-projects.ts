import { createClient } from "@/lib/supabase/client";
import { migrateProject } from "./migrate";
import type { RacklineProject } from "./types";

// Rackline projects persist as one jsonb document per row in `rackline_projects`
// (docs/rackline/rackline-projects.sql). A project is visible only to its members
// (owner / editor / viewer) and to Drybulb staff — enforced by RLS in Postgres,
// so these browser calls can never see another customer's design. Background
// drawings are NOT in the doc: they live in the private GCS bucket under
// projects/<id>/ behind the rackline-api Cloud Run service.

/** copier = may view and save their own duplicate, never change the original. */
export type ProjectRole = "owner" | "editor" | "copier" | "viewer" | "staff";
export type MemberRole = Exclude<ProjectRole, "staff">;

export interface SavedProjectMeta {
  id: string;
  name: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
  role: ProjectRole;
}

export interface SavedProject extends SavedProjectMeta {
  doc: RacklineProject;
  /** For a member's own copy: the shared project it was copied from… */
  source_id: string | null;
  /** …and that project's design at the time (the base for change-by-change review). */
  source_doc: RacklineProject | null;
}

export interface Member {
  user_id: string;
  email: string;
  role: MemberRole;
  created_at: string;
}

export interface Invite {
  id: string;
  email: string;
  role: MemberRole;
  token: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  declined_at: string | null;
}

/** May change the design in this browser (editors' changes go to their copy or to the owner for approval). */
export const canEdit = (r: ProjectRole | null | undefined) => r === "owner" || r === "editor" || r === "staff";
/** May save their own duplicate of the project. */
export const canDuplicate = (r: ProjectRole | null | undefined) => r === "copier" || canEdit(r);
/** May write the project itself. Only owners and staff; editors propose instead. */
export const canWrite = (r: ProjectRole | null | undefined) => r === "owner" || r === "staff";
export const canShare = (r: ProjectRole | null | undefined) => r === "owner" || r === "staff";

const META = "id, name, schema_version, created_at, updated_at";

/** The save lost a race: someone saved this project since it was loaded. */
export class SaveConflict extends Error {}

export async function listProjects(): Promise<SavedProjectMeta[]> {
  const { data, error } = await createClient().rpc("rackline_my_projects");
  if (error) throw error;
  return (data ?? []) as SavedProjectMeta[];
}

export async function getProject(id: string): Promise<SavedProject> {
  const sb = createClient();
  const [{ data, error }, role] = await Promise.all([
    sb.from("rackline_projects").select(`${META}, doc, source_id, source_doc`).eq("id", id).single(),
    sb.rpc("rackline_role", { p: id }),
  ]);
  if (error) throw error;
  return {
    ...(data as Omit<SavedProjectMeta, "role">),
    source_id: (data as { source_id: string | null }).source_id ?? null,
    source_doc: (data as { source_doc: unknown }).source_doc ? migrateProject((data as { source_doc: unknown }).source_doc) : null,
    role: (role.data as ProjectRole | null) ?? "viewer",
    doc: migrateProject((data as { doc: unknown }).doc),
  };
}

/** Cheap version check: the row's updated_at, or null if it's gone / no longer shared with the caller. */
export async function getProjectVersion(id: string): Promise<string | null> {
  const { data, error } = await createClient().from("rackline_projects").select("updated_at").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as { updated_at: string } | null)?.updated_at ?? null;
}

/** The caller's current role on a project (owners can change it at any time), or null if none. */
export async function getMyRole(id: string): Promise<ProjectRole | null> {
  const { data, error } = await createClient().rpc("rackline_role", { p: id });
  if (error) throw error;
  return (data as ProjectRole | null) ?? null;
}

export async function createProject(
  doc: RacklineProject, sourceId: string | null = null, sourceDoc: RacklineProject | null = null,
): Promise<SavedProjectMeta> {
  // user_id defaults to auth.uid(); a trigger makes the creator the owner.
  const { data, error } = await createClient()
    .from("rackline_projects")
    .insert({ name: doc.name, doc, schema_version: doc.schemaVersion, source_id: sourceId, source_doc: sourceDoc })
    .select(META)
    .single();
  if (error) throw error;
  return { ...(data as Omit<SavedProjectMeta, "role">), role: "owner" };
}

/**
 * Overwrite a project, but only if it is unchanged since `expectedUpdatedAt`
 * (optimistic concurrency). Zero rows matched ⇒ SaveConflict. Editors and
 * viewers are refused by RLS (also zero rows), which the UI prevents up front.
 */
export async function updateProject(
  id: string,
  doc: RacklineProject,
  expectedUpdatedAt: string,
  role: ProjectRole,
): Promise<SavedProjectMeta> {
  const { data, error } = await createClient()
    .from("rackline_projects")
    .update({ name: doc.name, doc, schema_version: doc.schemaVersion, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select(META);
  if (error) throw error;
  if (!data || data.length === 0) throw new SaveConflict("This project was changed elsewhere since you opened it.");
  return { ...(data[0] as Omit<SavedProjectMeta, "role">), role };
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await createClient().from("rackline_projects").delete().eq("id", id);
  if (error) throw error;
}

// ── Sharing ──────────────────────────────────────────────────────────────────

export async function listMembers(projectId: string): Promise<Member[]> {
  const { data, error } = await createClient()
    .from("rackline_project_members")
    .select("user_id, email, role, created_at")
    .eq("project_id", projectId)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as Member[];
}

export async function setMemberRole(projectId: string, userId: string, role: MemberRole): Promise<void> {
  const { error } = await createClient().from("rackline_project_members").update({ role }).eq("project_id", projectId).eq("user_id", userId);
  if (error) throw error;
}

/** Make another member the project's one owner; the caller (previous owner) becomes `keepAs`. */
export async function transferOwnership(projectId: string, userId: string, keepAs: Exclude<MemberRole, "owner"> = "editor"): Promise<void> {
  const { error } = await createClient().rpc("rackline_transfer_ownership", { p: projectId, to_user: userId, keep_as: keepAs });
  if (error) throw new Error(error.message);
}

export async function removeMember(projectId: string, userId: string): Promise<void> {
  const { error } = await createClient().from("rackline_project_members").delete().eq("project_id", projectId).eq("user_id", userId);
  if (error) throw error;
}

export async function listInvites(projectId: string): Promise<Invite[]> {
  const { data, error } = await createClient()
    .from("rackline_invites")
    .select("id, email, role, token, created_at, expires_at, accepted_at, declined_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Invite[];
}

export async function revokeInvite(id: string): Promise<void> {
  const { error } = await createClient().from("rackline_invites").delete().eq("id", id);
  if (error) throw error;
}

export async function isStaff(): Promise<boolean> {
  const { data } = await createClient().rpc("is_drybulb_staff");
  return data === true;
}

// ── Invite acceptance ─────────────────────────────────────────

export interface InvitePreview {
  project_name: string;
  invited_by: string;
  email_hint: string;
  role: MemberRole;
  status: "open" | "accepted" | "expired";
}

export async function previewInvite(token: string): Promise<InvitePreview | null> {
  const { data, error } = await createClient().rpc("rackline_invite_preview", { t: token });
  if (error) throw error;
  return ((data ?? []) as InvitePreview[])[0] ?? null;
}

export async function acceptInvite(token: string): Promise<string> {
  const { data, error } = await createClient().rpc("rackline_accept_invite", { t: token });
  if (error) throw new Error(error.message);
  return data as string;
}

/** An open invite addressed to the signed-in user's email (their invite inbox). */
export interface MyInvite {
  token: string;
  project_id: string;
  project_name: string;
  invited_by: string;
  role: MemberRole;
  created_at: string;
  expires_at: string;
}

export async function listMyInvites(): Promise<MyInvite[]> {
  const { data, error } = await createClient().rpc("rackline_my_invites");
  if (error) throw error;
  return (data ?? []) as MyInvite[];
}

export async function declineInvite(token: string): Promise<void> {
  const { error } = await createClient().rpc("rackline_decline_invite", { t: token });
  if (error) throw new Error(error.message);
}

// ── Notices ──────────────────────────────────────────────────────────────────
// Written by a database trigger when an owner deletes a project shared with you.

export interface Notice {
  id: string;
  kind: "deleted";
  project_id: string;
  project_name: string;
  actor_email: string | null;
  created_at: string;
}

export async function listNotices(): Promise<Notice[]> {
  const { data, error } = await createClient()
    .from("rackline_notices")
    .select("id, kind, project_id, project_name, actor_email, created_at")
    .is("seen_at", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as Notice[];
}

export async function dismissNotice(id: string): Promise<void> {
  const { error } = await createClient().from("rackline_notices").update({ seen_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ── Change requests ──────────────────────────────────────────────────────────
// Editors don't overwrite the owner's project: they send their version and the
// owner accepts (replacing the design) or rejects it. One open request per editor.

export interface ChangeRequest {
  id: string;
  project_id: string;
  author_id: string;
  author_email: string;
  doc: RacklineProject;
  /** The original's design the editor started from; null for requests sent before it was recorded. */
  base_doc: RacklineProject | null;
  base_updated_at: string;
  note: string | null;
  status: "open" | "accepted" | "partial" | "rejected";
  /** The editor's own copy the request was sent from. */
  copy_id: string | null;
  created_at: string;
  decided_at: string | null;
}

/** Open requests on a project the caller owns, or the caller's own latest requests (any status). */
export async function listChangeRequests(projectId: string): Promise<ChangeRequest[]> {
  const { data, error } = await createClient()
    .from("rackline_change_requests")
    .select("id, project_id, author_id, author_email, doc, base_doc, base_updated_at, note, status, copy_id, created_at, decided_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return ((data ?? []) as ChangeRequest[]).map((r) => ({ ...r, doc: migrateProject(r.doc), base_doc: r.base_doc ? migrateProject(r.base_doc) : null }));
}

export async function proposeChange(
  projectId: string, doc: RacklineProject, baseUpdatedAt: string, copyId: string | null, baseDoc: RacklineProject | null, note?: string,
): Promise<string> {
  const { data, error } = await createClient().rpc("rackline_propose_change", {
    p: projectId, d: doc, base: baseUpdatedAt, msg: note ?? null, c: copyId, bd: baseDoc,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Owner: record the outcome after applying the chosen changes with an ordinary save. */
export async function resolveChange(id: string, outcome: "accepted" | "partial" | "rejected"): Promise<void> {
  const { error } = await createClient().rpc("rackline_resolve_change", { r: id, outcome });
  if (error) throw new Error(error.message);
}

/** Owner: get view-only access to the editor's copy instead of merging. Returns the copy's id. */
export async function openChangeCopy(id: string): Promise<string> {
  const { data, error } = await createClient().rpc("rackline_open_change_copy", { r: id });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function withdrawChange(id: string): Promise<void> {
  const { error } = await createClient().from("rackline_change_requests").delete().eq("id", id);
  if (error) throw error;
}
