import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { TOOL_NAME } from "@/lib/rackline/constants";
import { checkRateLimit } from "@/lib/rate-limit";

// Create a Rackline project invite and email the link (Resend, same as /api/contact).
// The caller's own Supabase session does the insert, so RLS decides who may invite
// (project owners and Drybulb staff; only staff may invite an owner). This route
// holds no privileged key. If email isn't configured, the link is returned for the
// inviter to send themselves.
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["owner", "editor", "copier", "viewer"] as const;
const ROLE_VERB = { owner: "own", editor: "work on", copier: "view and duplicate", viewer: "view" } as const;

function siteOrigin(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-host");
  if (process.env.NODE_ENV !== "development" && fwd) return `https://${fwd}`;
  return new URL(request.url).origin;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: "Accounts are not configured." }, { status: 503 });
  if (!token) return NextResponse.json({ error: "Sign in to invite people." }, { status: 401 });

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: who } = await sb.auth.getUser(token);
  if (!who.user) return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  if (!(await checkRateLimit(`rackline-invite:${who.user.id}`)))
    return NextResponse.json({ error: "Too many invites. Please wait a minute." }, { status: 429 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const role = ROLES.find((r) => r === body.role);
  if (!projectId || !role) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  const { data: inv, error } = await sb
    .from("rackline_invites")
    .insert({ project_id: projectId, email, role })
    .select("token")
    .single();
  if (error || !inv) {
    // RLS refusal surfaces as a policy violation: the caller may not share this project.
    const denied = error?.code === "42501";
    return NextResponse.json(
      { error: denied ? (role === "owner" ? "Only Drybulb staff can invite an owner." : "Only the project owner or Drybulb staff can invite people.") : "Couldn't create the invite." },
      { status: denied ? 403 : 500 },
    );
  }

  const link = `${siteOrigin(request)}/invite/${inv.token}`;
  const [{ data: proj }, { data: prof }] = await Promise.all([
    sb.from("rackline_projects").select("name").eq("id", projectId).single(),
    sb.from("member_profiles").select("full_name").eq("user_id", who.user.id).maybeSingle(),
  ]);
  const projectName = (proj?.name as string | undefined) ?? "a project";
  const inviter = (prof?.full_name as string | undefined) || who.user.email || "Drybulb";

  const apiKey = process.env.RESEND_API_KEY, from = process.env.CONTACT_FROM_EMAIL;
  let emailed = false;
  if (apiKey && from) {
    const subject = `${inviter} shared "${projectName}" with you on Drybulb`.replace(/[\r\n]+/g, " ");
    const text = [
      `${inviter} invited you to ${ROLE_VERB[role]} the project "${projectName}" in ${TOOL_NAME} on drybulb.com.`,
      "",
      `Open the invite: ${link}`,
      "",
      `Sign in as ${email} (with Google, or with a code we email you). New to Drybulb? Signing in creates your account. The project will be waiting under Shared with you.`,
      "The link expires in 14 days. If you weren't expecting this, you can ignore it.",
    ].join("\n");
    const html = `<p>${esc(inviter)} invited you to ${ROLE_VERB[role]} the project <b>${esc(projectName)}</b> in ${TOOL_NAME} on drybulb.com.</p>
<p><a href="${esc(link)}">Open the invite</a></p>
<p>Sign in as ${esc(email)} (with Google, or with a code we email you). New to Drybulb? Signing in creates your account. The project will be waiting under <i>Shared with you</i>.</p>
<p style="color:#666">The link expires in 14 days. If you weren't expecting this, you can ignore it.</p>`;
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: email, subject, text, html }),
      });
      emailed = res.ok;
      if (!res.ok) console.error("[rackline-invite] Resend error:", res.status, await res.text().catch(() => ""));
    } catch (err) {
      console.error("[rackline-invite] Resend request failed:", err);
    }
  }
  return NextResponse.json({ link, emailed });
}
