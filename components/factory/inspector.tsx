"use client";

import {
  findNode, findBus, isBreakered, applyRackSpecObj, servedAmps, aggregateRatingA,
  type SldGraph, type OpResult,
  setBreaker, addBreaker, removeBreaker, removeEdge, removeNode, moveEdge,
} from "@/lib/factory/sld";
import { RACK_SPECS, type RackSpec } from "@/lib/factory/rack-specs.gen";
import { NETWORK_RACKS, NETWORK_RACK_BY_KEY } from "@/lib/factory/network-specs.gen";
import { Button } from "@/components/ui/button";

/** "served X A / rating Y A" capacity readout for a distribution element. */
function Capacity({ graph, id }: { graph: SldGraph; id: string }) {
  const rating = aggregateRatingA(graph, id);
  if (rating == null) return null;
  const served = Math.round(servedAmps(graph, id));
  const over = served > rating;
  return (
    <div className={`mt-1 rounded-md px-2 py-1 text-[11px] ${over ? "bg-red-50 text-red-700" : "bg-muted/50 text-muted-foreground"}`}>
      Served <b>{served} A</b> / rating <b>{rating} A</b>{over ? " — over-subscribed" : ""}
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: { label: string; value: string | number; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="mb-1.5 block">
      <span className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <input
        type={type}
        defaultValue={value}
        onBlur={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-1.5 py-1 text-xs"
      />
    </label>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: { id: string; name: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="mb-1.5 block">
      <span className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-md border bg-background px-1.5 py-1 text-xs">
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

export function Inspector({
  graph, selId, selEdgeId, apply,
  racks = RACK_SPECS, onApplyRack, onSaveAsRack, onDeleteRack, onDuplicate,
  selGroupId, onUngroup, onDuplicateGroup, onRenameGroup, onColorGroup, onSaveGroup,
}: {
  graph: SldGraph;
  selId: string | null;
  selEdgeId?: string | null;
  apply: (r: OpResult) => void;
  racks?: RackSpec[];
  onApplyRack?: (nodeId: string, key: string) => void;
  onSaveAsRack?: (nodeId: string, name: string) => void;
  onDeleteRack?: (key: string) => void;
  onDuplicate?: (id: string) => void;
  selGroupId?: string | null;
  onUngroup?: (id: string) => void;
  onDuplicateGroup?: (id: string) => void;
  onRenameGroup?: (id: string, name: string) => void;
  onColorGroup?: (id: string, color: string) => void;
  onSaveGroup?: (id: string) => void;
}) {
  const set = (fn: () => OpResult) => apply(fn());
  const ents = [
    ...graph.busbars.map((b) => ({ id: b.id, name: b.name })),
    ...graph.nodes.map((n) => ({ id: n.id, name: n.name })),
  ];
  const patchNode = (id: string, key: string, val: string | number) => {
    const g: SldGraph = JSON.parse(JSON.stringify(graph));
    const n = findNode(g, id) as Record<string, unknown> | null;
    if (n) { n[key] = val; apply({ ok: true, graph: g }); }
  };
  const patchBus = (id: string, key: string, val: string | number) => {
    const g: SldGraph = JSON.parse(JSON.stringify(graph));
    const b = findBus(g, id) as Record<string, unknown> | null;
    if (b) { b[key] = val; apply({ ok: true, graph: g }); }
  };

  // ── Group panel ────────────────────────────────────────────────────────────
  const group = selGroupId ? (graph.groups || []).find((x) => x.id === selGroupId) : null;
  if (group) {
    return (
      <div key={group.id}>
        <h3 className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Group</h3>
        <Field label="Name" value={group.name} onChange={(v) => onRenameGroup?.(group.id, v)} />
        <label className="mb-2 block">
          <span className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-muted-foreground">Color</span>
          <input type="color" defaultValue={group.color ?? "#94a3b8"} onChange={(ev) => onColorGroup?.(group.id, ev.target.value)} className="h-7 w-full rounded border" />
        </label>
        <div className="mb-2 text-[11px] text-muted-foreground">{group.members.length} members · drag the frame to move them together</div>
        {onSaveGroup && <Button variant="outline" size="sm" className="mb-1 w-full" onClick={() => onSaveGroup(group.id)}>Save group → library</Button>}
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => onDuplicateGroup?.(group.id)}>Duplicate</Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => onUngroup?.(group.id)}>Ungroup</Button>
        </div>
      </div>
    );
  }

  // ── Connector (edge) panel ─────────────────────────────────────────────────
  const e = selEdgeId ? graph.edges.find((x) => x.id === selEdgeId) : null;
  if (e) {
    const fromNode = findNode(graph, e.from);
    const fromBrk = !!(fromNode && isBreakered(fromNode));
    const name = (id: string) => findNode(graph, id)?.name ?? findBus(graph, id)?.name ?? id;
    const setFrom = (v: string) => {
      const t = findNode(graph, v);
      let opts: { fromBreaker?: string } | undefined;
      if (t && isBreakered(t)) {
        const used = new Set(graph.edges.filter((x) => x.from === v && x.id !== e.id).map((x) => x.fromBreaker));
        const free = (t.breakers || []).find((b) => !used.has(b.id));
        if (free) opts = { fromBreaker: free.id };
      }
      apply(moveEdge(graph, e.id, "from", v, opts));
    };
    const setBrk = (br: string) => apply(moveEdge(graph, e.id, "from", e.from, { fromBreaker: br }));
    const setTo = (v: string) => apply(moveEdge(graph, e.id, "to", v));
    const setSize = (v: string) => {
      const g: SldGraph = JSON.parse(JSON.stringify(graph));
      const ed = g.edges.find((x) => x.id === e.id);
      if (ed) { if (v) ed.size = v; else delete ed.size; apply({ ok: true, graph: g }); }
    };
    const setHidden = (hidden: boolean) => {
      const g: SldGraph = JSON.parse(JSON.stringify(graph));
      const ed = g.edges.find((x) => x.id === e.id);
      if (ed) { if (hidden) ed.labelHidden = true; else delete ed.labelHidden; apply({ ok: true, graph: g }); }
    };
    const setColor = (v: string | null) => {
      const g: SldGraph = JSON.parse(JSON.stringify(graph));
      const ed = g.edges.find((x) => x.id === e.id);
      if (ed) { if (v) ed.color = v; else delete ed.color; apply({ ok: true, graph: g }); }
    };

    return (
      <div key={e.id}>
        <h3 className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Connector</h3>
        <div className="mb-2 rounded-md bg-muted/50 px-2 py-1 text-[11px]">
          {name(e.from)}{e.fromBreaker ? ` · ${e.fromBreaker}` : ""} <span className="text-muted-foreground">→</span> {name(e.to)}
        </div>
        <Select label="Feeder (from)" value={e.from} options={ents.filter((o) => o.id !== e.to)} onChange={setFrom} />
        {fromBrk && (
          <Select
            label="Breaker"
            value={e.fromBreaker ?? ""}
            options={[{ id: "", name: "— board-level —" }, ...(fromNode!.breakers || []).map((b) => ({ id: b.id, name: `${b.label} · ${b.amp} A` }))]}
            onChange={(v) => (v ? setBrk(v) : apply(moveEdge(graph, e.id, "from", e.from)))}
          />
        )}
        <Select label="Load (to)" value={e.to} options={ents.filter((o) => o.id !== e.from)} onChange={setTo} />
        <Field label="Label / annotation" value={e.size ?? ""} onChange={setSize} />
        <label className="mb-2 flex items-center gap-2 text-[11px]">
          <input type="checkbox" checked={!e.labelHidden} onChange={(ev) => setHidden(!ev.target.checked)} />
          Show label on canvas
        </label>
        <div className="mb-2">
          <span className="mb-0.5 block text-[9.5px] uppercase tracking-wide text-muted-foreground">Wire color</span>
          <div className="flex items-center gap-2">
            <input type="color" value={e.color ?? "#64748b"} onChange={(ev) => setColor(ev.target.value)} className="h-7 w-12 rounded border" />
            <button onClick={() => setColor(null)} className="rounded border px-2 py-1 text-[11px] hover:bg-muted">Reset</button>
            {e.color && <span className="font-mono text-[11px] text-muted-foreground">{e.color}</span>}
          </div>
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => set(() => removeEdge(graph, e.id))}>Delete connector</Button>
      </div>
    );
  }

  if (!selId) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Select a card or bus to edit, or click a <b>wire</b> to open its connector panel (endpoints, size,
        delete). <b>Wire</b> by dragging a port (top = input, bottom = output) onto another port or a bus.
        <b> Re-route</b> by dragging a wire end onto another handle. Switchboard / RPP expose one output
        handle per breaker.
      </p>
    );
  }

  const bus = findBus(graph, selId);
  if (bus) {
    return (
      <div key={bus.id}>
        <h3 className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Bus</h3>
        <Field label="Name" value={bus.name} onChange={(v) => patchBus(bus.id, "name", v)} />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Voltage" value={bus.kv} onChange={(v) => patchBus(bus.id, "kv", v)} />
          <Field label="Aggregate rating (A)" value={bus.ratingA ?? ""} type="number" onChange={(v) => patchBus(bus.id, "ratingA", +v)} />
        </div>
        <Field label="Width" value={bus.w} type="number" onChange={(v) => patchBus(bus.id, "w", +v)} />
        <Capacity graph={graph} id={bus.id} />
        <div className="mt-2 flex gap-1">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => onDuplicate?.(bus.id)}>Duplicate</Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => set(() => removeNode(graph, bus.id))}>Delete bus</Button>
        </div>
      </div>
    );
  }

  const n = findNode(graph, selId);
  if (!n) return null;
  const brk = isBreakered(n);
  const isRack = n.kind === "load" && n.grp === "IT";
  const isNet = n.kind === "load" && n.grp === "NET";
  const patchIf = (group: "powerIf" | "coolingIf", key: string, val: string | number) => {
    const g: SldGraph = JSON.parse(JSON.stringify(graph));
    const nn = findNode(g, n.id) as Record<string, Record<string, unknown>> | null;
    if (nn && nn[group]) { nn[group][key] = val; apply({ ok: true, graph: g }); }
  };

  // Re-mount the spec-driven fields whenever the rack spec is (re)applied, so
  // selecting an AI/network rack RESETS power/cooling/circuit fields. The Name
  // field is keyed by node id (outer), so it is preserved.
  const ifKey = JSON.stringify([n.kw, n.rating, n.powerIf, n.coolingIf]);

  return (
    <div key={n.id}>
      <h3 className="mb-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Element — {n.type}</h3>
      <Field label="Name" value={n.name} onChange={(v) => patchNode(n.id, "name", v)} />
      <div key={ifKey} className="grid grid-cols-2 gap-2">
        <Field label="Rating" value={n.rating} onChange={(v) => patchNode(n.id, "rating", v)} />
        <Field label="Power (kW)" value={n.kw} type="number" onChange={(v) => patchNode(n.id, "kw", +v)} />
      </div>
      <Field label="Catalog key" value={n.catalogKey} onChange={(v) => patchNode(n.id, "catalogKey", v)} />
      <Field label="Product (vendor · model)" value={n.product} onChange={(v) => patchNode(n.id, "product", v)} />

      {(isRack || isNet) && (
        <div className="mt-3">
          {isRack && (
            <>
              <Select
                label="AI rack"
                value={n.aiRack ?? ""}
                options={[{ id: "", name: "— generic —" }, ...racks.map((s) => ({ id: s.key, name: s.label + (s.source === "custom" ? " (custom)" : "") }))]}
                onChange={(v) => v && onApplyRack?.(n.id, v)}
              />
              <div className="mb-2 flex gap-1">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { const nm = window.prompt("Save this rack configuration as:", n.name); if (nm) onSaveAsRack?.(n.id, nm); }}>Save as custom rack…</Button>
                {n.aiRack && racks.find((r) => r.key === n.aiRack)?.source === "custom" && (
                  <Button variant="outline" size="sm" onClick={() => onDeleteRack?.(n.aiRack!)} title="Delete this custom rack">🗑</Button>
                )}
              </div>
            </>
          )}
          {isNet && (
            <Select
              label="Network rack"
              value={n.netRack ?? ""}
              options={[{ id: "", name: "— generic —" }, ...NETWORK_RACKS.map((s) => ({ id: s.key, name: s.label }))]}
              onChange={(v) => v && apply(applyRackSpecObj(graph, n.id, NETWORK_RACK_BY_KEY[v]))}
            />
          )}
          {n.powerIf && (
            <div key={ifKey + ":p"}>
              <h3 className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Power interface</h3>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Voltage (V)" value={n.powerIf.voltage_v} type="number" onChange={(v) => patchIf("powerIf", "voltage_v", +v)} />
                <Field label="Feeds" value={n.powerIf.feeds} type="number" onChange={(v) => patchIf("powerIf", "feeds", +v)} />
                <Field label="Circuit amps" value={n.powerIf.circuit_amps} type="number" onChange={(v) => patchIf("powerIf", "circuit_amps", +v)} />
                <Field label="Redundancy" value={n.powerIf.redundancy} onChange={(v) => patchIf("powerIf", "redundancy", v)} />
              </div>
              <Field label="Circuit size" value={n.powerIf.circuit_size} onChange={(v) => patchIf("powerIf", "circuit_size", v)} />
              <Field label="Phase / delivery" value={`${n.powerIf.phase} · ${n.powerIf.delivery}`} onChange={() => {}} />
              <Field label="Connector" value={n.powerIf.connector} onChange={(v) => patchIf("powerIf", "connector", v)} />
            </div>
          )}
          {n.coolingIf && (
            <div key={ifKey + ":c"}>
              <h3 className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Cooling interface</h3>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Type" value={n.coolingIf.type} onChange={(v) => patchIf("coolingIf", "type", v)} />
                <Field label="Coolant" value={n.coolingIf.coolant} onChange={(v) => patchIf("coolingIf", "coolant", v)} />
                <Field label="Flow (LPM)" value={n.coolingIf.flow_lpm} type="number" onChange={(v) => patchIf("coolingIf", "flow_lpm", +v)} />
                <Field label="Supply °C" value={n.coolingIf.supply_c} type="number" onChange={(v) => patchIf("coolingIf", "supply_c", +v)} />
                <Field label="Return °C" value={n.coolingIf.return_c} type="number" onChange={(v) => patchIf("coolingIf", "return_c", +v)} />
                <Field label="ΔT °C" value={n.coolingIf.delta_c} type="number" onChange={(v) => patchIf("coolingIf", "delta_c", +v)} />
                <Field label="Air (CFM)" value={n.coolingIf.air_cfm} type="number" onChange={(v) => patchIf("coolingIf", "air_cfm", +v)} />
                <Field label="Liquid frac." value={n.coolingIf.liquid_fraction} type="number" onChange={(v) => patchIf("coolingIf", "liquid_fraction", +v)} />
              </div>
              <Field label="Manifold" value={n.coolingIf.manifold} onChange={(v) => patchIf("coolingIf", "manifold", v)} />
            </div>
          )}
          {n.powerIf && (
            <div className="mt-2">
              <h3 className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Power connectors (required: {n.powerIf.feeds})</h3>
              {Array.from({ length: n.powerIf.feeds }).map((_, i) => {
                const fed = graph.edges.filter((ed) => ed.to === n.id)[i];
                const src = fed ? (findNode(graph, fed.from)?.name ?? findBus(graph, fed.from)?.name ?? fed.from) : null;
                return (
                  <div key={i} className={`flex justify-between gap-2 py-0.5 text-[11px] ${fed ? "" : "font-medium text-red-600"}`}>
                    <span>Whip {i + 1}</span>
                    <span className="truncate">{fed ? `${src}${fed.fromBreaker ? " · " + fed.fromBreaker : ""}` : "— missing (required)"}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {brk && (
        <div className="mt-3">
          <h3 className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Breaker schedule</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Main amp (rating)" value={n.mainAmp ?? ""} type="number" onChange={(v) => patchNode(n.id, "mainAmp", +v)} />
            <Field label="Voltage" value={n.voltage ?? ""} onChange={(v) => patchNode(n.id, "voltage", v)} />
          </div>
          <Capacity graph={graph} id={n.id} />
          {(n.breakers || []).map((b) => (
            <div key={b.id} className="mb-1 flex items-center gap-1">
              <input defaultValue={b.label} onBlur={(ev) => set(() => setBreaker(graph, n.id, b.id, "label", ev.target.value))} className="w-10 rounded border px-1 py-0.5 text-[11px]" />
              <input defaultValue={b.amp} type="number" onBlur={(ev) => set(() => setBreaker(graph, n.id, b.id, "amp", +ev.target.value))} className="w-12 rounded border px-1 py-0.5 text-[11px]" />
              <select defaultValue={b.status} onChange={(ev) => set(() => setBreaker(graph, n.id, b.id, "status", ev.target.value))} className="rounded border px-1 py-0.5 text-[11px]">
                {["closed", "open", "spare"].map((s) => <option key={s}>{s}</option>)}
              </select>
              <button onClick={() => set(() => removeBreaker(graph, n.id, b.id))} className="ml-auto px-1 text-[11px] text-red-600">✕</button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="mt-1" onClick={() => set(() => addBreaker(graph, n.id))}>+ breaker</Button>
        </div>
      )}

      <div className="mt-3">
        <h3 className="mb-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Connectors</h3>
        {graph.edges.filter((ed) => ed.to === n.id || ed.from === n.id).map((ed) => {
          const otherId = ed.to === n.id ? ed.from : ed.to;
          const other = findNode(graph, otherId) || findBus(graph, otherId);
          const dir = ed.to === n.id ? "←" : "→";
          return (
            <div key={ed.id} className="flex items-center justify-between py-0.5 text-[11px]">
              <span className="truncate">{dir} {other?.name ?? otherId}</span>
              <button onClick={() => set(() => removeEdge(graph, ed.id))} className="px-1 text-red-600">✕</button>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-1">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => onDuplicate?.(n.id)}>Duplicate</Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={() => set(() => removeNode(graph, n.id))}>Delete</Button>
      </div>
    </div>
  );
}
