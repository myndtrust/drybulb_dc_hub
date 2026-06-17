"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  createClient,
  isSupabaseConfigured,
  signInWithGoogle,
} from "@/lib/supabase/client";
import {
  listModels,
  saveModel,
  updateModel,
  deleteModel,
  type SavedCostModel,
  type SavedCostInputs,
} from "@/lib/cost/saved-models";

const inputClass =
  "flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2";

// Content-only panel (no outer card) — designed to live inside the drawer.
export function SavedModels({
  currentInputs,
  loadedId,
  loadedName,
  onLoad,
  onSaved,
}: {
  currentInputs: SavedCostInputs;
  loadedId: string | null;
  loadedName: string | null;
  onLoad: (model: SavedCostModel) => void;
  onSaved: (model: SavedCostModel) => void;
}) {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<SavedCostModel[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setModels(await listModels());
    } catch {
      setError("Couldn't load your saved models.");
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const isIn = Boolean(data.session);
      setSignedIn(isIn);
      setReady(true);
      if (isIn) refresh();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const isIn = Boolean(session);
      setSignedIn(isIn);
      if (isIn) refresh();
      else setModels([]);
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  if (!isSupabaseConfigured || !ready) return null;

  // Save the current configuration as a brand-new model.
  async function handleSaveNew(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const model = await saveModel(name.trim(), currentInputs);
      setName("");
      onSaved(model);
      await refresh();
    } catch {
      setError("Couldn't save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  // Overwrite the currently-loaded model with the current edits.
  async function handleUpdate() {
    if (!loadedId) return;
    setBusy(true);
    setError(null);
    try {
      const model = await updateModel(loadedId, loadedName?.trim() || "Untitled", currentInputs);
      onSaved(model);
      await refresh();
    } catch {
      setError("Couldn't save changes. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await deleteModel(id);
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setError("Couldn't delete. Please try again.");
    }
  }

  if (!signedIn) {
    return (
      <div>
        <p className="mb-3 text-sm text-muted-foreground">
          Sign in to save this cost model and reload it any time.
        </p>
        <Button size="sm" onClick={() => signInWithGoogle()}>
          Sign in with Google
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Save changes to the loaded model (overwrite) */}
      {loadedId && (
        <div className="rounded-md border bg-muted/40 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Editing <span className="font-medium text-foreground">{loadedName}</span>
          </p>
          <Button size="sm" className="w-full" disabled={busy} onClick={handleUpdate}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}

      {/* Save as a new model */}
      <form onSubmit={handleSaveNew} className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {loadedId ? "Save as a new model" : "Save this model"}
        </label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this model"
            aria-label="Model name"
            maxLength={120}
            className={inputClass}
          />
          <Button type="submit" size="sm" disabled={busy || !name.trim()} className="shrink-0">
            {busy ? "Saving…" : loadedId ? "Save as new" : "Save"}
          </Button>
        </div>
      </form>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {models.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved models yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {models.map((m) => {
            const isLoaded = m.id === loadedId;
            return (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  {isLoaded && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                  <span className={`truncate text-sm ${isLoaded ? "font-medium" : ""}`} title={m.name}>
                    {m.name}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => onLoad(m)}>
                    Load
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}>
                    Delete
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
