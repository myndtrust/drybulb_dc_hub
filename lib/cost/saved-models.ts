import { createClient } from "@/lib/supabase/client";
import type { CostInputs } from "@/lib/cost/types";

// What we persist per model: the full portfolio inputs plus the display unit.
// The portfolio includes each service's full 8,760-hour demand vector, so custom
// CSV schedules round-trip losslessly.
export type SavedCostInputs = CostInputs & { tempUnit?: "C" | "F" };

export interface SavedCostModel {
  id: string;
  name: string;
  inputs: SavedCostInputs;
  created_at: string;
  updated_at: string;
}

const SELECT = "id, name, inputs, created_at, updated_at";

// All queries run from the browser with the user's session; Row-Level Security in
// Postgres restricts every row to its owner, so no server/API layer is needed.
export async function listModels(): Promise<SavedCostModel[]> {
  const { data, error } = await createClient()
    .from("cost_models")
    .select(SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedCostModel[];
}

export async function saveModel(
  name: string,
  inputs: SavedCostInputs,
): Promise<SavedCostModel> {
  // user_id is filled by the column default (auth.uid()) and checked by RLS.
  const { data, error } = await createClient()
    .from("cost_models")
    .insert({ name, inputs })
    .select(SELECT)
    .single();
  if (error) throw error;
  return data as SavedCostModel;
}

export async function updateModel(
  id: string,
  name: string,
  inputs: SavedCostInputs,
): Promise<SavedCostModel> {
  // RLS restricts the update to the owner's row.
  const { data, error } = await createClient()
    .from("cost_models")
    .update({ name, inputs, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(SELECT)
    .single();
  if (error) throw error;
  return data as SavedCostModel;
}

export async function deleteModel(id: string): Promise<void> {
  const { error } = await createClient().from("cost_models").delete().eq("id", id);
  if (error) throw error;
}
