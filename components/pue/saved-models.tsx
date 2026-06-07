"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createClient,
  isSupabaseConfigured,
  signInWithGoogle,
} from "@/lib/supabase/client";
import {
  listModels,
  saveModel,
  deleteModel,
  type SavedModel,
  type SavedModelInputs,
} from "@/lib/pue/saved-models";

const inputClass =
  "flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2";

export function SavedModels({
  currentInputs,
  onLoad,
}: {
  currentInputs: SavedModelInputs;
  onLoad: (inputs: SavedModelInputs) => void;
}) {
  const [signedIn, setSignedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [models, setModels] = useState<SavedModel[]>([]);
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

  // Hide the panel entirely if auth isn't configured (calculator stays usable).
  if (!isSupabaseConfigured || !ready) return null;

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveModel(name.trim(), currentInputs);
      setName("");
      await refresh();
    } catch {
      setError("Couldn't save. Please try again.");
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Save your model</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Sign in to save this configuration and reload it any time.
          </p>
          <Button size="sm" onClick={() => signInWithGoogle()}>
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your saved models</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSave} className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this model"
            aria-label="Model name"
            maxLength={120}
            className={inputClass}
          />
          <Button type="submit" size="sm" disabled={busy || !name.trim()} className="shrink-0">
            {busy ? "Saving…" : "Save"}
          </Button>
        </form>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved models yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {models.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                <span className="truncate text-sm">{m.name}</span>
                <span className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => onLoad(m.inputs)}>
                    Load
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
