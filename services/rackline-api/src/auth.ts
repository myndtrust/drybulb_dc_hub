// Caller identity and project access. The browser sends its Supabase access
// token as a Bearer token. We never trust the client about roles: the caller's
// role on a project comes from Postgres (rackline_role(), evaluated as the
// caller), the same function the database's RLS policies use.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? "";
const TTL_MS = 60_000;
const users = new Map<string, { uid: string; exp: number }>();
const roles = new Map<string, { role: Role | null; exp: number }>();

export type Role = "owner" | "editor" | "copier" | "viewer" | "staff";
export class AuthError extends Error {}
export class AccessError extends Error {}

export interface Caller { uid: string; token: string }

function bearer(h: string | undefined): string {
  const token = h?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AuthError("Sign in required.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY not configured");
  return token;
}

const sweep = <V extends { exp: number }>(m: Map<string, V>) => {
  if (m.size > 5000) for (const [k, v] of m) if (v.exp < Date.now()) m.delete(k);
};

export async function callerFromRequest(authHeader: string | undefined): Promise<Caller> {
  const token = bearer(authHeader);
  const hit = users.get(token);
  if (hit && hit.exp > Date.now()) return { uid: hit.uid, token };
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY } });
  const user = res.ok ? ((await res.json()) as { id?: string }) : {};
  if (!user.id) throw new AuthError("Session expired. Sign in again.");
  users.set(token, { uid: user.id, exp: Date.now() + TTL_MS });
  sweep(users);
  return { uid: user.id, token };
}

/** The caller's role on a project, from Postgres; null = no access. */
export async function projectRole(c: Caller, projectId: string): Promise<Role | null> {
  const key = c.token + ":" + projectId;
  const hit = roles.get(key);
  if (hit && hit.exp > Date.now()) return hit.role;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rackline_role`, {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p: projectId }),
  });
  if (!res.ok) throw new AccessError("Couldn't check project access.");
  const role = ((await res.json()) as Role | null) ?? null;
  roles.set(key, { role, exp: Date.now() + TTL_MS });
  sweep(roles);
  return role;
}

export async function requireRole(c: Caller, projectId: string, write: boolean): Promise<Role> {
  const role = await projectRole(c, projectId);
  if (!role) throw new AccessError("You don't have access to this project.");
  if (write && (role === "viewer" || role === "copier")) throw new AccessError("View-only access: ask the owner for edit access.");
  return role;
}
