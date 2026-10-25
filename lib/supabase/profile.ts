import { createClient } from "@/lib/supabase/client";

// Drybulb member profile (public.member_profiles, docs/rackline/rackline-projects.sql):
// the one-time "create your account" details collected after first sign-in, by
// components/app/account-gate.tsx. Rackline requires it before accepting an invite.

export interface MemberProfile {
  full_name: string;
  company: string | null;
  job_title: string | null;
}

export async function getMyProfile(): Promise<MemberProfile | null> {
  const sb = createClient();
  const uid = (await sb.auth.getSession()).data.session?.user.id;
  if (!uid) return null;
  // Filter explicitly: staff can read every profile under RLS.
  const { data, error } = await sb.from("member_profiles").select("full_name, company, job_title").eq("user_id", uid).maybeSingle();
  if (error) throw error;
  return (data as MemberProfile | null) ?? null;
}

export async function saveMyProfile(email: string, p: MemberProfile): Promise<void> {
  const { error } = await createClient().from("member_profiles").upsert({ email, ...p, updated_at: new Date().toISOString() });
  if (error) throw error;
}
