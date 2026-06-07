import { createClient } from "@/lib/supabase/client";
import type { PUEInputs } from "@/lib/pue/types";

// What we persist per model: the full calculator inputs plus the display unit.
export type SavedModelInputs = PUEInputs & { tempUnit: "C" | "F" };

export interface SavedModel {
  id: string;
  name: string;
  inputs: SavedModelInputs;
  created_at: string;
  updated_at: string;
}

const SELECT = "id, name, inputs, created_at, updated_at";

// All queries run from the browser with the user's session; Row-Level Security
// in Postgres restricts every row to its owner, so no server/API layer is needed.
export async function listModels(): Promise<SavedModel[]> {
  const { data, error } = await createClient()
    .from("pue_models")
    .select(SELECT)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedModel[];
}

export async function saveModel(
  name: string,
  inputs: SavedModelInputs,
): Promise<SavedModel> {
  // user_id is filled by the column default (auth.uid()) and checked by RLS.
  const { data, error } = await createClient()
    .from("pue_models")
    .insert({ name, inputs })
    .select(SELECT)
    .single();
  if (error) throw error;
  return data as SavedModel;
}

export async function deleteModel(id: string): Promise<void> {
  const { error } = await createClient().from("pue_models").delete().eq("id", id);
  if (error) throw error;
}
