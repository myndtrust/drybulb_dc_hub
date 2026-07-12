import { createClient } from "@/lib/supabase/client";
import type { GroupPayload } from "./sld";

// Account-global library of reusable single-line groups (e.g. a "GB300 pod"). All
// queries run from the browser with the user's session; Row-Level Security in
// Postgres restricts every row to its owner, so no server/API layer is needed
// (same pattern as lib/cost/saved-models.ts). Apply docs/ai-factory/single-line-groups.sql.

export interface SavedGroup {
  id: string;
  name: string;
  payload: GroupPayload;
  created_at: string;
  updated_at: string;
}

const SELECT = "id, name, payload, created_at, updated_at";

export async function listGroups(): Promise<SavedGroup[]> {
  const { data, error } = await createClient()
    .from("single_line_groups")
    .select(SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedGroup[];
}

export async function saveGroup(name: string, payload: GroupPayload): Promise<SavedGroup> {
  const sb = createClient();
  // Dedupe by NAME (no duplicate group names): if a group with this name already
  // exists, overwrite it and bump updated_at (latest wins); else insert a new row.
  // user_id is filled by the column default (auth.uid()) and scoped by RLS.
  const { data: existing } = await sb
    .from("single_line_groups")
    .select("id")
    .eq("name", name)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const { data, error } = await sb
      .from("single_line_groups")
      .update({ payload, updated_at: new Date().toISOString() })
      .eq("id", (existing as { id: string }).id)
      .select(SELECT)
      .single();
    if (error) throw error;
    return data as SavedGroup;
  }
  const { data, error } = await sb
    .from("single_line_groups")
    .insert({ name, payload })
    .select(SELECT)
    .single();
  if (error) throw error;
  return data as SavedGroup;
}

export async function deleteGroup(id: string): Promise<void> {
  const { error } = await createClient().from("single_line_groups").delete().eq("id", id);
  if (error) throw error;
}
