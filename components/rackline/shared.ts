// Contract between the Rackline shell and its tabs.

import type { DxfDrawing } from "@/lib/rackline/dxf";
import type { LibIndex } from "@/lib/rackline/model";
import type { Analysis, RacklineProject, Scenario } from "@/lib/rackline/types";

export type TabKey = "layout" | "elev" | "power" | "cables" | "cooling" | "sld" | "compare";

export const TABS: [TabKey, string][] = [
  ["layout", "Layout"],
  ["elev", "Rack elevations"],
  ["power", "Power striping"],
  ["cables", "Cable pathways"],
  ["cooling", "Cooling"],
  ["sld", "Single line"],
  ["compare", "Compare"],
];

/** Runtime view of the background drawing (never persisted). */
export interface BgView {
  img?: string;
  dxf?: DxfDrawing;
  /** Session-only (not in the bucket), or the stored file couldn't be fetched. */
  local?: boolean;
  lost?: boolean;
}

/** An edit on a draft copy of the project; `s` is the draft's active scenario. */
export type Mutator = (p: RacklineProject, s: Scenario) => void;

export interface TabProps {
  project: RacklineProject;
  scenario: Scenario;
  an: Analysis;
  lib: LibIndex;
  /** One undoable edit. */
  commit: (fn: Mutator) => void;
  /** Transient edit while dragging; call `beginLive` first and `endLive` on release. */
  live: (fn: Mutator) => void;
  beginLive: () => void;
  endLive: (changed: boolean) => void;
  toast: (msg: string) => void;
  goTab: (t: TabKey) => void;
  selRack: string | null;
  setSelRack: (id: string | null) => void;
  bg: BgView;
  setBg: (b: BgView) => void;
}
