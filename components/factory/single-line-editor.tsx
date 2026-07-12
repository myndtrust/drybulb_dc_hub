"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, type Connection, type Edge, type Node,
  type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  seed, snap, restore, addEdge, moveEdge, removeEdge, removeNode, addNode, addBus, duplicateNode,
  findNode, findBus, applyRackSpecObj, PAL,
  groupBounds, createGroup, removeGroup, renameGroup, setGroupColor, moveGroup, extractGroup, instantiateGroup, duplicateGroup,
  type SldGraph, type OpResult,
} from "@/lib/factory/sld";
import { rollupGraph } from "@/lib/factory/project";
import { design, parseBrief } from "@/lib/factory/topology";
import { RACK_SPECS, RACK_SPEC_BY_KEY, type RackSpec } from "@/lib/factory/rack-specs.gen";
import { listGroups, saveGroup, deleteGroup, type SavedGroup } from "@/lib/factory/groups";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { NODE_TYPES } from "./nodes";
import { Inspector } from "./inspector";
import { Button } from "@/components/ui/button";

const LIBKEY = "sld.app.topologies";
const RACKKEY = "sld.rackSpecs";
const slug = (s: string) => "custom-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** The default single-line: the seed with its racks specced to GB300 NVL72, so the
 *  power/cooling interface shows immediately. Added racks still start generic. */
function seededGraph(): SldGraph {
  let g = seed();
  const gb300 = RACK_SPEC_BY_KEY["gb300-nvl72"];
  for (const n of g.nodes.filter((x) => x.type === "rack")) {
    const r = applyRackSpecObj(g, n.id, gb300);
    if (r.ok) g = r.graph;
  }
  return g;
}

function toRfNodes(g: SldGraph): Node[] {
  const frames: Node[] = (g.groups || []).map((gr) => {
    const b = groupBounds(g, gr);
    return { id: gr.id, type: "groupFrame", position: { x: b.x, y: b.y }, data: { name: gr.name, color: gr.color, w: b.w, h: b.h }, draggable: true, selectable: true, zIndex: -1 };
  });
  return [
    ...frames,
    ...g.busbars.map((b) => ({ id: b.id, type: "bus", position: { x: b.x, y: b.y }, data: { bus: b } })),
    ...g.nodes.map((n) => ({ id: n.id, type: "card", position: { x: n.x, y: n.y }, data: { node: n } })),
  ];
}
function toRfEdges(g: SldGraph): Edge[] {
  return g.edges.map((e) => ({
    id: e.id, source: e.from, target: e.to,
    sourceHandle: e.fromBreaker ?? "out", targetHandle: "in",
  }));
}
function withPos(g: SldGraph, id: string, pos: { x: number; y: number }): SldGraph {
  const ng: SldGraph = JSON.parse(JSON.stringify(g));
  const n = findNode(ng, id); if (n) { n.x = pos.x; n.y = pos.y; return ng; }
  const b = findBus(ng, id); if (b) { b.x = pos.x; b.y = pos.y; }
  return ng;
}

export function SingleLineEditor() {
  const [graph, setGraph] = useState<SldGraph>(seededGraph);
  const [selId, setSelId] = useState<string | null>(null);
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [briefMd, setBriefMd] = useState<string | null>(null);
  const [lib, setLib] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(localStorage.getItem(LIBKEY) || "{}"); } catch { return {}; }
  });
  const [customRacks, setCustomRacks] = useState<RackSpec[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(localStorage.getItem(RACKKEY) || "[]"); } catch { return []; }
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selGroup, setSelGroup] = useState<string | null>(null);
  const [savedGroups, setSavedGroups] = useState<SavedGroup[]>([]);
  const [signedIn, setSignedIn] = useState(false);
  const undoRef = useRef<string[]>([]);
  const redoRef = useRef<string[]>([]);

  // account-global group library (Supabase, owner-RLS)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = createClient();
    const load = (ok: boolean) => { setSignedIn(ok); if (ok) listGroups().then(setSavedGroups).catch((e) => console.error("listGroups", e)); else setSavedGroups([]); };
    sb.auth.getSession().then(({ data }) => load(Boolean(data.session)));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => load(Boolean(s)));
    return () => sub.subscription.unsubscribe();
  }, []);
  const refreshGroups = () => {
    if (!isSupabaseConfigured) return;
    listGroups().then(setSavedGroups).catch((e) => { console.error("listGroups", e); flash("couldn't load groups — check the SELECT (read) RLS policy"); });
  };
  const canAccount = isSupabaseConfigured ? signedIn : false;

  const nodes = useMemo(() => toRfNodes(graph), [graph]);
  const edges = useMemo(
    () => toRfEdges(graph).map((e) => {
      const ge = graph.edges.find((x) => x.id === e.id);
      const on = e.id === selEdgeId;
      return {
        ...e,
        type: "step", // orthogonal (right-angle) routing
        label: ge?.labelHidden ? undefined : ge?.size,
        selected: on,
        style: on
          ? { stroke: "#1d4ed8", strokeWidth: 2.4 }
          : ge?.color
            ? { stroke: ge.color, strokeWidth: 1.8 }
            : undefined,
      };
    }),
    [graph, selEdgeId],
  );
  const roll = useMemo(() => rollupGraph(graph), [graph]);

  // Ctrl/⌘+D duplicates the selected element.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        if (selGroup) { e.preventDefault(); dupGroup(selGroup); }
        else if (selId) { e.preventDefault(); duplicate(selId); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, selGroup, graph]);

  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 1800); };
  const pushUndo = useCallback(() => { undoRef.current.push(snap(graph)); if (undoRef.current.length > 50) undoRef.current.shift(); redoRef.current = []; }, [graph]);
  const apply = useCallback((r: OpResult) => {
    if (!r.ok) { flash(r.reason || "invalid"); return; }
    pushUndo(); setGraph(r.graph);
  }, [pushUndo]);
  const undo = () => { const s = undoRef.current.pop(); if (!s) return; redoRef.current.push(snap(graph)); setGraph(restore(s)); };
  const redo = () => { const s = redoRef.current.pop(); if (!s) return; undoRef.current.push(snap(graph)); setGraph(restore(s)); };

  // — React Flow event handlers (graph is the source of truth) —
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setGraph((g) => {
      let ng = g;
      for (const c of changes) {
        if (c.type === "position" && c.position) {
          const gr = (ng.groups || []).find((x) => x.id === c.id); // dragging a group frame moves its members
          if (gr) { const b = groupBounds(ng, gr); ng = moveGroup(ng, gr.id, c.position.x - b.x, c.position.y - b.y).graph; }
          else ng = withPos(ng, c.id, c.position);
        } else if (c.type === "remove") {
          const gr = (ng.groups || []).find((x) => x.id === c.id);
          if (gr) ng = removeGroup(ng, gr.id).graph;
          else { const r = removeNode(ng, c.id); if (r.ok) ng = r.graph; }
        }
      }
      return ng;
    });
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    for (const c of changes) if (c.type === "remove") apply(removeEdge(graph, c.id));
  }, [graph, apply]);
  const onConnect = useCallback((c: Connection) => {
    const fb = c.sourceHandle && c.sourceHandle !== "out" ? c.sourceHandle : undefined;
    apply(addEdge(graph, c.source, c.target, fb ? { fromBreaker: fb } : undefined));
  }, [graph, apply]);
  const onReconnect = useCallback((oldEdge: Edge, n: Connection) => {
    const e = graph.edges.find((x) => x.id === oldEdge.id); if (!e) return;
    if (n.source !== e.from) {
      const fb = n.sourceHandle && n.sourceHandle !== "out" ? n.sourceHandle : undefined;
      apply(moveEdge(graph, e.id, "from", n.source, fb ? { fromBreaker: fb } : undefined));
    } else {
      apply(moveEdge(graph, e.id, "to", n.target));
    }
  }, [graph, apply]);
  // Click a wire to SELECT it → opens the connector panel (delete + properties).
  const onEdgeClick = useCallback((_: unknown, edge: Edge) => { setSelEdgeId(edge.id); setSelId(null); }, []);

  // — palette / library / autobuild —
  const add = (type: string) => { const r = addNode(graph, type, 640, 360); if (r.ok) { apply(r); setSelId(r.id ?? null); } };
  const addABus = () => { const r = addBus(graph, 560, 300, "BUS"); if (r.ok) apply(r); };
  const duplicate = (id: string) => { const r = duplicateNode(graph, id); if (r.ok) { apply(r); setSelId(r.id ?? null); setSelEdgeId(null); } };
  // — groups —
  const groupSelected = () => {
    if (!selectedIds.length) return flash("box-select elements first");
    const nm = window.prompt("Group name:", "Pod"); if (!nm) return;
    const r = createGroup(graph, selectedIds, nm); if (r.ok) { apply(r); setSelGroup(r.id ?? null); }
  };
  const ungroup = (gid: string) => { apply(removeGroup(graph, gid)); if (selGroup === gid) setSelGroup(null); };
  const dupGroup = (gid: string) => { const r = duplicateGroup(graph, gid); if (r.ok) { apply(r); setSelGroup(r.id ?? null); setSelId(null); setSelEdgeId(null); } };
  const saveGroupToLib = async (gid: string) => {
    const payload = extractGroup(graph, gid); if (!payload) return;
    try { await saveGroup(payload.name, payload); refreshGroups(); flash(`saved group “${payload.name}”`); }
    catch (err) { console.error(err); flash("save failed — apply docs/ai-factory/single-line-groups.sql in Supabase"); }
  };
  const importGroup = (id: string) => {
    const sg = savedGroups.find((x) => x.id === id); if (!sg) return;
    const r = instantiateGroup(graph, sg.payload); if (r.ok) { apply(r); setSelGroup(r.id ?? null); }
  };
  const removeSavedGroup = async (id: string) => { try { await deleteGroup(id); refreshGroups(); } catch { flash("delete failed"); } };
  const autoBuild = () => { pushUndo(); setGraph(seededGraph()); setSelId(null); };
  const reset = () => { pushUndo(); setGraph({ nodes: [], edges: [], busbars: [], uid: 0 }); setSelId(null); };
  const writeLib = (l: Record<string, string>) => { setLib(l); localStorage.setItem(LIBKEY, JSON.stringify(l)); };
  const save = () => { const nm = name.trim(); if (!nm) return flash("name the topology"); writeLib({ ...lib, [nm]: snap(graph) }); flash(`saved “${nm}”`); };
  const load = (nm: string) => { if (!lib[nm]) return; pushUndo(); setGraph(restore(lib[nm])); setSelId(null); setName(nm); };

  // — power expert agent: a natural-language brief → sized, validated single-line —
  const designFromPrompt = (text?: string) => {
    const t = (text ?? prompt).trim();
    if (!t) return flash("describe your facility");
    if (text) setPrompt(text);
    const d = design(parseBrief(t)); // parse → size → build → self-validate
    if (!d.ok) return flash("could not generate a valid design"); // never load an invalid graph
    pushUndo(); setGraph(d.graph); setSelId(null); setSelEdgeId(null);
    setBriefMd(d.brief); setName(d.sizing.spec.name);
    flash(`designed ${d.sizing.facilityMW} MW · ${d.sizing.racks} racks · ${d.sizing.gpus.toLocaleString()} GPUs`);
  };
  const EXAMPLES = [
    "48 MW GB300 campus, Tier III, N+1 generation, distributed 4-to-make-3 UPS, 2N to the rack",
    "10 MW pilot, GB200, 2N UPS, liquid-cooled",
    "100 MW facility, PUE 1.25, catcher UPS, Tier IV",
  ];

  // — custom AI-rack library (localStorage, merged with the built-in specs) —
  const allRacks = useMemo(() => [...RACK_SPECS, ...customRacks], [customRacks]);
  const writeRacks = (rs: RackSpec[]) => { setCustomRacks(rs); localStorage.setItem(RACKKEY, JSON.stringify(rs)); };
  const applyRack = (nodeId: string, key: string) => { const s = allRacks.find((r) => r.key === key); if (s) apply(applyRackSpecObj(graph, nodeId, s)); };
  const deleteRack = (key: string) => writeRacks(customRacks.filter((r) => r.key !== key));
  const saveAsRack = (nodeId: string, rawName: string) => {
    const nm = rawName.trim(); if (!nm) return;
    const n = findNode(graph, nodeId); if (!n) return;
    const base = (n.aiRack && allRacks.find((r) => r.key === n.aiRack)) || RACK_SPECS.find((r) => r.key === "gb200-nvl72")!;
    const spec: RackSpec = {
      key: slug(nm), label: nm, vendor: "Custom", family: base.family,
      accel_model: base.accel_model, accel_per_rack: base.accel_per_rack, gpus_per_rack: base.gpus_per_rack,
      power: { ...(n.powerIf ?? base.power), rack_kw: n.kw },
      cooling: { ...(n.coolingIf ?? base.cooling) },
      network: { ...base.network },
      confidence: "estimate", source: "custom",
    };
    writeRacks([...customRacks.filter((r) => r.key !== spec.key), spec]);
    apply(applyRackSpecObj(graph, nodeId, spec));
    flash(`saved rack “${nm}”`);
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <span className="text-sm font-semibold">AI Factory — Single-line</span>
        <span className="font-mono text-[10px] text-muted-foreground">4-to-make-3 UPS · 2N dist</span>
        <div className="flex-1" />
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="topology name" className="w-36 rounded-md border px-2 py-1 text-xs" />
        <Button variant="outline" size="sm" onClick={save}>Save</Button>
        <select value="" onChange={(e) => e.target.value && load(e.target.value)} className="rounded-md border px-2 py-1 text-xs">
          <option value="">Load…</option>
          {Object.keys(lib).sort().map((nm) => <option key={nm}>{nm}</option>)}
        </select>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button variant="outline" size="sm" onClick={undo}>↶</Button>
        <Button variant="outline" size="sm" onClick={redo}>↷</Button>
        <Button variant="outline" size="sm" onClick={autoBuild}>AutoBuild</Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button variant="outline" size="sm" onClick={groupSelected} disabled={!selectedIds.length} title="Group the box-selected elements">Group ({selectedIds.length})</Button>
        <select
          value=""
          onMouseDown={refreshGroups}
          onChange={(e) => { if (e.target.value) importGroup(e.target.value); }}
          disabled={!canAccount}
          className="rounded-md border px-1.5 py-1 text-xs disabled:opacity-50"
          title={canAccount ? "Import a saved group" : "Sign in to use the account group library"}
        >
          <option value="">{savedGroups.length ? "Import group…" : "Import group… (none found)"}</option>
          {savedGroups.map((sg) => <option key={sg.id} value={sg.id}>{sg.name}</option>)}
        </select>
        <Button variant="outline" size="sm" onClick={reset}>Clear</Button>
      </div>

      {/* power expert agent — describe a facility, get a sized + validated single-line */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Power expert</span>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") designFromPrompt(); }}
          placeholder="Describe your facility — e.g. “48 MW GB300 campus, Tier III, distributed 4-to-make-3 UPS, 2N to the rack”"
          className="min-w-[280px] flex-1 rounded-md border bg-background px-2 py-1 text-xs"
        />
        <Button size="sm" onClick={() => designFromPrompt()}>Design</Button>
        {briefMd && <Button variant="outline" size="sm" onClick={() => setBriefMd((b) => (b ? null : briefMd))}>Brief</Button>}
        <div className="flex w-full flex-wrap gap-1 pt-0.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => designFromPrompt(ex)} className="rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted">{ex}</button>
          ))}
        </div>
      </div>

      <div className="grid flex-1 grid-cols-[160px_1fr_240px] overflow-hidden">
        {/* palette */}
        <aside className="overflow-auto border-r p-2">
          <h3 className="mb-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Add element</h3>
          {Object.entries(PAL).map(([t, p]) => (
            <button key={t} onClick={() => add(t)} className="mb-1 block w-full rounded-md border px-2 py-1 text-left text-[11px] hover:bg-muted">{p.label}</button>
          ))}
          <button onClick={addABus} className="mb-1 block w-full rounded-md border px-2 py-1 text-left text-[11px] hover:bg-muted">Bus / busbar (any tap)</button>
          <div className="mt-3 rounded-md bg-muted/50 p-2 text-[10px] text-muted-foreground">
            <div className="font-semibold text-foreground">Rolls up to cost model</div>
            <div>Racks: {roll.rackCount} · GPUs: {roll.gpus}</div>
            <div>IT: {(roll.itKW / 1000).toFixed(2)} MW</div>
            <div>Net racks: {roll.netracksEW} E-W · {roll.netracksNS} N-S</div>
          </div>
        </aside>

        {/* canvas */}
        <div className="relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onEdgeClick={onEdgeClick}
            onNodeClick={(_, node) => {
              if (node.type === "groupFrame") { setSelGroup(node.id); setSelId(null); setSelEdgeId(null); }
              else { setSelId(node.id); setSelEdgeId(null); setSelGroup(null); }
            }}
            onPaneClick={() => { setSelId(null); setSelEdgeId(null); setSelGroup(null); }}
            onSelectionChange={(s) => {
              const ids = s.nodes.filter((n) => n.type !== "groupFrame").map((n) => n.id).sort();
              // bail out when unchanged, else this re-renders → rebuilds nodes/edges →
              // React Flow re-fires onSelectionChange → infinite loop.
              setSelectedIds((prev) => (prev.length === ids.length && prev.every((x, i) => x === ids[i]) ? prev : ids));
            }}
            selectionOnDrag
            panOnDrag={[1, 2]}
            edgesReconnectable
            defaultEdgeOptions={{ type: "step" }}
            onNodeDragStart={pushUndo}
            fitView
          >
            <Background gap={16} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
          {toast && (
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white">{toast}</div>
          )}
          {briefMd && (
            <div className="absolute right-3 top-3 max-h-[70%] w-80 overflow-auto rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Design brief</span>
                <div className="flex gap-1">
                  <button onClick={() => navigator.clipboard?.writeText(briefMd)} className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted" title="Copy markdown">Copy</button>
                  <button onClick={() => setBriefMd(null)} className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted">×</button>
                </div>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-[10.5px] leading-snug text-foreground">{briefMd}</pre>
            </div>
          )}
        </div>

        {/* inspector */}
        <aside className="overflow-auto border-l p-3">
          <Inspector
            graph={graph}
            selId={selId}
            selEdgeId={selEdgeId}
            apply={apply}
            racks={allRacks}
            onApplyRack={applyRack}
            onSaveAsRack={saveAsRack}
            onDeleteRack={deleteRack}
            onDuplicate={duplicate}
            selGroupId={selGroup}
            onUngroup={ungroup}
            onDuplicateGroup={dupGroup}
            onRenameGroup={(gid, nm) => apply(renameGroup(graph, gid, nm))}
            onColorGroup={(gid, c) => apply(setGroupColor(graph, gid, c))}
            onSaveGroup={canAccount ? saveGroupToLib : undefined}
          />
        </aside>
      </div>
    </div>
  );
}
