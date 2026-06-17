"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { SavedModels } from "@/components/cost/saved-models";
import type { SavedCostInputs, SavedCostModel } from "@/lib/cost/saved-models";

// A "Saved models" button that opens a collapsible left side-drawer, keeping the
// panel out of the main content body until the user wants it.
export function SavedModelsDrawer({
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
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Hidden entirely when auth isn't configured, so the tool is unaffected.
  if (!isSupabaseConfigured) return null;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Saved models
      </Button>

      {open && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          {/* Drawer */}
          <aside
            role="dialog"
            aria-label="Saved models"
            className="absolute inset-y-0 left-0 flex w-80 max-w-[85vw] flex-col border-r border-border/60 bg-background shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
              <h2 className="text-sm font-semibold">Saved models</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <SavedModels
                currentInputs={currentInputs}
                loadedId={loadedId}
                loadedName={loadedName}
                onLoad={(model) => {
                  onLoad(model);
                  setOpen(false);
                }}
                onSaved={onSaved}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
