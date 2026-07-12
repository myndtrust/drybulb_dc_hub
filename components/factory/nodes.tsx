"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  EQH, nodeW, ports, outTaps, isBreakered, type SldNode, type SldBus,
} from "@/lib/factory/sld";

export type CardData = { node: SldNode };
export type BusData = { bus: SldBus };

const ACCENT: Record<string, string> = {
  IT: "#047857", MECH: "#0e7490", NET: "#6d28d9",
};
function accent(n: SldNode) { return (n.grp && ACCENT[n.grp]) || "#334155"; }

/** A switchboard/RPP/eq/source/load card with input (top) + output (bottom) handles.
 *  Breakered cards expose one source handle per feeder breaker (id = breaker id). */
export function SldCardNode({ data, selected }: NodeProps) {
  const node = (data as CardData).node;
  const w = nodeW(node);
  const p = ports(node);
  const brk = isBreakered(node);
  const taps = brk ? outTaps(node) : [];

  return (
    <div
      style={{
        width: w, height: EQH, borderColor: accent(node),
        boxShadow: selected ? "0 0 0 2px rgba(29,78,216,.4)" : undefined,
      }}
      className="relative flex flex-col rounded-[5px] border-[1.4px] bg-white"
    >
      {p.input && (
        <Handle type="target" id="in" position={Position.Top} className="!h-2.5 !w-2.5 !border-[1.6px] !bg-white" />
      )}

      <div className="flex items-center gap-1.5 px-1.5 py-[3px]">
        <span className="truncate text-[11.5px] font-semibold leading-tight">{node.name}</span>
      </div>
      <div className="mt-auto flex justify-between gap-1.5 px-1.5 pb-1 text-[9.5px] text-muted-foreground">
        <span className="truncate">{node.rating || node.type}</span>
        <span className="font-semibold text-foreground">
          {brk ? (node.mainAmp ? `${node.mainAmp} A` : "") : node.kw ? `${node.kw} kW` : ""}
        </span>
      </div>

      {brk && <div className="absolute inset-x-[5px] -bottom-px h-[3px] rounded-[2px] bg-slate-700" />}

      {!brk && p.output && (
        <Handle type="source" id="out" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-[1.6px] !bg-white" />
      )}
      {brk && taps.map((t) => {
        const b = (node.breakers || []).find((x) => x.id === t.breaker);
        const left = `${((t.x - node.x) / w) * 100}%`;
        const fill = b?.status === "open" ? "#fff" : b?.status === "spare" ? "#f1f5f9" : "#334155";
        return (
          <Handle
            key={t.breaker}
            type="source"
            id={t.breaker as string}
            position={Position.Bottom}
            style={{ left, background: fill, borderColor: "#334155", width: 9, height: 13, borderRadius: 2 }}
            title={b ? `${b.label} · ${b.amp} A · ${b.poles}P · ${b.status}` : ""}
          />
        );
      })}
    </div>
  );
}

/** A busbar — thick line; any element can tap on (both handles allow many edges). */
export function BusNode({ data, selected }: NodeProps) {
  const bus = (data as BusData).bus;
  return (
    <div style={{ width: bus.w }} className="relative">
      <Handle type="target" id="in" position={Position.Top} className="!bg-slate-900" />
      <div
        style={{ boxShadow: selected ? "0 0 0 2px rgba(29,78,216,.4)" : undefined }}
        className="h-[10px] w-full rounded-[2px] bg-slate-900"
      />
      <div className="absolute -top-4 left-0.5 whitespace-nowrap text-[9.5px] font-semibold text-slate-600">
        {bus.name} · {bus.kv}
      </div>
      <Handle type="source" id="out" position={Position.Bottom} className="!bg-slate-900" />
    </div>
  );
}

/** A logical-group frame: a labeled dashed rectangle drawn behind its members. */
export function GroupFrameNode({ data, selected }: NodeProps) {
  const d = data as { name: string; color?: string; w: number; h: number };
  const c = d.color || "#94a3b8";
  return (
    <div
      style={{ width: d.w, height: d.h, borderColor: c, boxShadow: selected ? `0 0 0 2px ${c}` : undefined }}
      className="rounded-lg border-2 border-dashed bg-slate-100/30"
    >
      <span className="absolute left-2 top-1 text-[10px] font-semibold" style={{ color: c }}>{d.name}</span>
    </div>
  );
}

export const NODE_TYPES = { card: SldCardNode, bus: BusNode, groupFrame: GroupFrameNode };
