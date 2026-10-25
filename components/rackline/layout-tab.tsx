"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COOL_K, PDF_SCALES, PDU_TYPES, TRAY_K } from "@/lib/rackline/constants";
import { buildScenario, COOLING_LABEL, type CoolingScheme, type GenOptions } from "@/lib/rackline/generate";
import { dist, inRect, polyLength, rackRear } from "@/lib/rackline/geometry";
import { addDevice, choosePDU, clone, newRack, nextName, uid } from "@/lib/rackline/model";
import { fLen, fromU, n0, n1, snapStep, toU, uLbl } from "@/lib/rackline/format";
import type { CoolerKind, Scenario, TrayKind, Vec } from "@/lib/rackline/types";
import { bgBounds, changePdfPage, loadBackgroundFile } from "./background";
import type { TabProps } from "./shared";
import { Btn, Chip, Fold, Hint, KV, Label, NumField, Section, Select, TextField, UtilChip } from "./ui";

export interface View { tx: number; ty: number; z: number }

type Tool = "select" | "rack" | "hac" | "cooler" | "tray" | "measure" | "calib" | "bgmove";
type ObjKind = "racks" | "hacs" | "coolers" | "trays";

type Drag =
  | { k: "pan"; sx: number; sy: number; tx: number; ty: number }
  | { k: "move"; start: Vec; orig: Record<string, Vec | Vec[]>; moved: boolean }
  | { k: "vtx"; id: string; i: number; moved: boolean }
  | { k: "bg"; start: Vec; ox: number; oy: number; moved: boolean };

const TOOL_HINT: Partial<Record<Tool, string>> = {
  rack: "Click to place a rack. R rotates the last placed rack.",
  hac: "Click to place a hot aisle containment section, then size it in the panel. Add one per pod.",
  cooler: "Click to place a cooling unit.",
  tray: "Click to add tray points. Double-click or Enter to finish, Esc to cancel.",
  measure: "Click two points to measure.",
  calib: "Click two points of a known dimension on the background.",
  bgmove: "Drag to move the background.",
};

function findObj(s: Scenario, id: string): { k: ObjKind; o: Scenario[ObjKind][number] } | null {
  for (const k of ["racks", "hacs", "coolers", "trays"] as ObjKind[]) {
    const o = (s[k] as { id: string }[]).find((x) => x.id === id);
    if (o) return { k, o: o as Scenario[ObjKind][number] };
  }
  return null;
}

const heatFill = (kw: number) =>
  `color-mix(in oklab, var(--card), var(--rl-hot) ${Math.round(8 + Math.min(1, kw / 80) * 55)}%)`;

export function LayoutTab(p: TabProps & { view: View; setView: (v: View) => void; fitOnMount: boolean; onFitted: () => void; signedIn: boolean; projectId: string | null; editable: boolean }) {
  const { project, scenario: S, an, lib, commit, live, beginLive, endLive, toast, view, setView, bg } = p;
  const units = project.units;
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<string[]>([]);
  const [snap, setSnapOn] = useState(true);
  const [grid, setGrid] = useState(true);
  const [fill, setFill] = useState(false);
  const [coolKind, setCoolKind] = useState<CoolerKind>("crah");
  const [trayKind, setTrayKind] = useState<TrayKind>("fiber");
  const [draft, setDraft] = useState<{ pts: Vec[]; hover?: Vec } | null>(null);
  const [meas, setMeas] = useState<{ a: Vec; b?: Vec; hover?: Vec } | null>(null);
  const [calib, setCalib] = useState<{ a: Vec; b?: Vec; hover?: Vec } | null>(null);
  const [calDist, setCalDist] = useState(0);
  const [openGen, setOpenGen] = useState(false);
  const [openBg, setOpenBg] = useState(!project.bg);
  const [pdfPage, setPdfPage] = useState(project.bg?.page ?? 1);
  const [pdfScale, setPdfScale] = useState(project.bg?.pdfScale ?? "");
  const [busy, setBusy] = useState(false);
  const [g, setG] = useState({ nodes: 8, perRack: 2, model: project.lib.find((l) => l.cat === "compute")?.id ?? "", pattern: "pod" as GenOptions["pattern"], cooling: "hac" as CoolingScheme, rackW: 0.6, hot: 1.2, cold: 1.2, net: true });
  const drag = useRef<Drag | null>(null);
  const lastRot = useRef(0);
  const space = useRef(false);
  const fileIn = useRef<HTMLInputElement>(null);

  const st = snapStep(units);
  const snp = useCallback((v: number) => (snap ? Math.round(v / st) * st : v), [snap, st]);
  const z = view.z, fs = Math.max(0.12, 11 / z);

  // Keep selection valid when the scenario changes underneath (undo, scenario switch).
  const selValid = useMemo(() => sel.filter((id) => findObj(S, id)), [sel, S]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => setSize({ w: svg.clientWidth || 800, h: svg.clientHeight || 600 }));
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  const fitView = useCallback(() => {
    const pts: Vec[] = [];
    S.racks.forEach((r) => pts.push([r.x, r.y]));
    S.hacs.forEach((h) => pts.push([h.x - h.w / 2, h.y - h.d / 2], [h.x + h.w / 2, h.y + h.d / 2]));
    S.coolers.forEach((c) => pts.push([c.x, c.y]));
    S.trays.forEach((t) => t.pts.forEach((q) => pts.push(q)));
    if (!pts.length && project.bg) { const b = bgBounds(project.bg, bg); if (b) pts.push(...b); }
    if (!pts.length) pts.push([0, 0], [10, 10]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const x0 = Math.min(...xs) - 2, x1 = Math.max(...xs) + 2, y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2;
    const W = svgRef.current?.clientWidth || 800, H = svgRef.current?.clientHeight || 600;
    const nz = Math.max(2, Math.min(400, Math.min(W / (x1 - x0), H / (y1 - y0))));
    setView({ z: nz, tx: (W - (x1 - x0) * nz) / 2 - x0 * nz, ty: (H - (y1 - y0) * nz) / 2 - y0 * nz });
  }, [S, project.bg, bg, setView]);

  useEffect(() => {
    if (p.fitOnMount) { fitView(); p.onFitted(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoomAt = useCallback((f: number, cx: number, cy: number) => {
    const nz = Math.max(1, Math.min(600, view.z * f));
    const wx = (cx - view.tx) / view.z, wy = (cy - view.ty) / view.z;
    setView({ z: nz, tx: cx - wx * nz, ty: cy - wy * nz });
  }, [view, setView]);

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const toWorld = (e: { clientX: number; clientY: number }): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left - view.tx) / view.z, (e.clientY - r.top - view.ty) / view.z];
  };
  /** Orthogonal tray drawing unless Shift is held. */
  const ortho = (q: Vec, last: Vec | undefined, free: boolean): Vec => {
    if (!last || free) return q;
    return Math.abs(q[0] - last[0]) < Math.abs(q[1] - last[1]) ? [last[0], q[1]] : [q[0], last[1]];
  };

  const finishTray = useCallback(() => {
    if (!draft || draft.pts.length < 2) { setDraft(null); return; }
    const pts = draft.pts;
    const id = uid();
    commit((_p, s) => {
      s.trays.push({
        id, name: `${TRAY_K[trayKind].name} ${s.trays.filter((t) => t.kind === trayKind).length + 1}`, kind: trayKind,
        wmm: trayKind === "busway" ? 200 : 300, dmm: trayKind === "busway" ? 150 : 100, elev: trayKind === "busway" ? 2.6 : 2.9, pts,
      });
    });
    setDraft(null);
    setSel([id]);
  }, [draft, trayKind, commit]);

  const delSel = useCallback(() => {
    if (!selValid.length) return;
    const ids = new Set(selValid);
    commit((_p, s) => {
      s.racks = s.racks.filter((o) => !ids.has(o.id));
      s.hacs = s.hacs.filter((o) => !ids.has(o.id));
      s.coolers = s.coolers.filter((o) => !ids.has(o.id));
      s.trays = s.trays.filter((o) => !ids.has(o.id));
    });
    setSel([]);
  }, [selValid, commit]);

  const rotSel = useCallback(() => {
    if (!selValid.length) return;
    commit((_p, s) => selValid.forEach((id) => {
      const f = findObj(s, id);
      if (f && f.k !== "trays") {
        const o = f.o as { rot: number };
        o.rot = ((o.rot || 0) + 90) % 360;
        if (f.k === "racks") lastRot.current = o.rot;
      }
    }));
  }, [selValid, commit]);

  const dupSel = useCallback(() => {
    if (!selValid.length) return;
    const ns: string[] = [];
    commit((_p, s) => selValid.forEach((id) => {
      const f = findObj(s, id);
      if (!f) return;
      const c = clone(f.o) as Scenario[ObjKind][number] & { id: string };
      c.id = uid();
      if (f.k === "trays") { const t = c as Scenario["trays"][number]; t.pts = t.pts.map((q) => [q[0] + 0.6, q[1] + 0.6]); }
      else { const o = c as { x: number; y: number; w: number }; o.x += f.k === "racks" ? o.w : 0.6; o.y += f.k === "racks" ? 0 : 0.6; }
      if (f.k === "racks") {
        const r = c as Scenario["racks"][number];
        r.name = nextName(r.name, s.racks.map((x) => x.name));
        r.devs.forEach((d) => (d.id = uid()));
      }
      (s[f.k] as { id: string }[]).push(c);
      ns.push(c.id);
    }));
    setSel(ns);
  }, [selValid, commit]);

  const nudge = useCallback((dx: number, dy: number) => {
    commit((_p, s) => selValid.forEach((id) => {
      const f = findObj(s, id);
      if (!f) return;
      if (f.k === "trays") { const t = f.o as Scenario["trays"][number]; t.pts = t.pts.map((q) => [q[0] + dx, q[1] + dy]); }
      else { const o = f.o as { x: number; y: number }; o.x += dx; o.y += dy; }
    }));
  }, [selValid, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === " ") space.current = true;
      if (e.key === "Delete" || e.key === "Backspace") { if (selValid.length) { e.preventDefault(); delSel(); } }
      else if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey) rotSel();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); dupSel(); }
      else if (e.key === "Enter" && tool === "tray") finishTray();
      else if (e.key === "Escape") { setDraft(null); setMeas(null); setCalib(null); setTool("select"); }
      else if (e.key.startsWith("Arrow") && selValid.length) {
        e.preventDefault();
        const k = e.shiftKey ? st * 4 : st;
        nudge(e.key === "ArrowLeft" ? -k : e.key === "ArrowRight" ? k : 0, e.key === "ArrowUp" ? -k : e.key === "ArrowDown" ? k : 0);
      }
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === " ") space.current = false; };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onUp); };
  }, [selValid, delSel, rotSel, dupSel, finishTray, nudge, tool, st]);

  // ── Pointer handling ───────────────────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e);
    svgRef.current!.setPointerCapture(e.pointerId);
    const pan = () => { drag.current = { k: "pan", sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty }; };
    if (e.button === 1 || e.button === 2 || space.current) return pan();
    const target = e.target as Element;
    if (tool === "select") {
      const vt = target.closest("[data-vtx]") as HTMLElement | null;
      if (vt) {
        const [id, i] = vt.dataset.vtx!.split(":");
        beginLive();
        drag.current = { k: "vtx", id, i: +i, moved: false };
        return;
      }
      const el = target.closest("[data-id]") as HTMLElement | null;
      if (el) {
        const id = el.dataset.id!;
        let next = selValid;
        if (e.shiftKey) next = selValid.includes(id) ? selValid.filter((x) => x !== id) : [...selValid, id];
        else if (!selValid.includes(id)) next = [id];
        setSel(next);
        if (S.racks.some((r) => r.id === id)) p.setSelRack(id);
        const orig: Record<string, Vec | Vec[]> = {};
        next.forEach((i) => {
          const f = findObj(S, i);
          if (f) orig[i] = f.k === "trays" ? clone((f.o as Scenario["trays"][number]).pts) : [(f.o as { x: number }).x, (f.o as { y: number }).y];
        });
        beginLive();
        drag.current = { k: "move", start: w, orig, moved: false };
        return;
      }
      if (!e.shiftKey && selValid.length) setSel([]);
      return pan();
    }
    if (tool === "rack") {
      const id = uid();
      commit((_p, s) => {
        const r = newRack(`R${String(s.racks.length + 1).padStart(2, "0")}`, snp(w[0]), snp(w[1]), lastRot.current);
        r.id = id;
        const node = project.lib.find((l) => l.cat === "compute");
        if (node) addDevice(r, node.id, lib);
        choosePDU(r, lib, project.elec, s.loadFactor || 1);
        s.racks.push(r);
      });
      setSel([id]);
      p.setSelRack(id);
      return;
    }
    if (tool === "hac") {
      const id = uid();
      commit((_p, s) => { s.hacs.push({ id, name: `HAC-${s.hacs.length + 1}`, x: snp(w[0]), y: snp(w[1]), w: 4.8, d: 1.2, rot: 0 }); });
      setSel([id]);
      return;
    }
    if (tool === "cooler") {
      const id = uid(), K = COOL_K[coolKind];
      commit((_p, s) => {
        s.coolers.push({
          id, name: `${K.name.split(" ")[0].toUpperCase()}-${s.coolers.filter((c) => c.kind === coolKind).length + 1}`, kind: coolKind,
          x: snp(w[0]), y: snp(w[1]), w: K.w, d: K.d, rot: 0, cap: coolKind === "crah" ? s.cool.crahKW : coolKind === "cdu" ? s.cool.cduKW : K.cap,
        });
      });
      setSel([id]);
      return;
    }
    if (tool === "tray") {
      const pts = draft?.pts ?? [];
      const q = ortho([snp(w[0]), snp(w[1])], pts[pts.length - 1], e.shiftKey);
      if (!pts.length || dist(pts[pts.length - 1], q) > 0.01) setDraft({ pts: [...pts, q] });
      return;
    }
    if (tool === "measure") { setMeas(!meas || meas.b ? { a: w } : { ...meas, b: w }); return; }
    if (tool === "calib") { setCalib(!calib || calib.b ? { a: w } : { ...calib, b: w }); return; }
    if (tool === "bgmove" && project.bg) {
      beginLive();
      drag.current = { k: "bg", start: w, ox: project.bg.x, oy: project.bg.y, moved: false };
      return;
    }
    pan();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const w = toWorld(e);
    const d = drag.current;
    if (!d) {
      if (tool === "tray" && draft) setDraft({ ...draft, hover: ortho([snp(w[0]), snp(w[1])], draft.pts[draft.pts.length - 1], e.shiftKey) });
      if (tool === "measure" && meas && !meas.b) setMeas({ ...meas, hover: w });
      if (tool === "calib" && calib && !calib.b) setCalib({ ...calib, hover: w });
      return;
    }
    if (d.k === "pan") { setView({ ...view, tx: d.tx + e.clientX - d.sx, ty: d.ty + e.clientY - d.sy }); return; }
    if (d.k === "move") {
      const dx = snp(w[0] - d.start[0]), dy = snp(w[1] - d.start[1]);
      if (dx || dy) d.moved = true;
      live((_p, s) => {
        for (const [id, o] of Object.entries(d.orig)) {
          const f = findObj(s, id);
          if (!f) continue;
          if (f.k === "trays") (f.o as Scenario["trays"][number]).pts = (o as Vec[]).map((q) => [q[0] + dx, q[1] + dy]);
          else { const ob = f.o as { x: number; y: number }; ob.x = (o as Vec)[0] + dx; ob.y = (o as Vec)[1] + dy; }
        }
      });
      return;
    }
    if (d.k === "vtx") {
      d.moved = true;
      live((_p, s) => { const t = s.trays.find((t) => t.id === d.id); if (t) t.pts[d.i] = [snp(w[0]), snp(w[1])]; });
      return;
    }
    if (d.k === "bg") {
      d.moved = true;
      live((pp) => { if (pp.bg) { pp.bg.x = d.ox + w[0] - d.start[0]; pp.bg.y = d.oy + w[1] - d.start[1]; } });
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.k !== "pan") endLive(d.moved);
  };

  // ── Generator ───────────────────────────────────────────────────────────────
  const generate = (replace: boolean) => {
    const cx = (size.w / 2 - view.tx) / view.z, cy = (size.h / 2 - view.ty) / view.z;
    const o: GenOptions = { ...g, red: S.cool.red, ox: snp(cx - 3), oy: snp(cy - 1.5), name: `${g.nodes}× · ${g.perRack}/rack · ${COOLING_LABEL[g.cooling]}` };
    let s: Scenario;
    try { s = buildScenario(o, project.lib, project.elec); } catch (err) { toast((err as Error).message); return; }
    commit((pp, cur) => {
      if (replace) {
        cur.racks = s.racks; cur.hacs = s.hacs; cur.trays = s.trays; cur.coolers = s.coolers; cur.notes = s.notes;
      } else {
        s.electrical = clone(cur.electrical);
        s.cool = { ...clone(cur.cool), red: o.red };
        pp.scenarios.push(s);
        pp.active = s.id;
      }
    });
    setSel([]);
    toast(replace ? "Layout replaced" : `Scenario "${s.name}" created`);
  };

  // ── Background ──────────────────────────────────────────────────────────────
  const onFile = async (file: File) => {
    setBusy(true);
    setOpenBg(true);
    toast("Loading drawing…");
    try {
      const r = await loadBackgroundFile(file, { page: pdfPage, pdfScale, prev: project.bg, signedIn: p.signedIn, projectId: p.projectId, editable: p.editable });
      commit((pp) => { pp.bg = r.bg; });
      p.setBg(r.view);
      toast(r.message);
      if (!S.racks.length) setTimeout(fitView, 0);
    } catch (err) {
      toast("Could not read that file: " + ((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };
  const onPage = async (page: number) => {
    setPdfPage(page);
    if (!project.bg?.src) return;
    setBusy(true);
    try {
      const r = await changePdfPage(project.bg, page);
      commit((pp) => { pp.bg = r.bg; });
      p.setBg(r.view);
      toast(r.message);
    } catch (err) { toast((err as Error).message); } finally { setBusy(false); }
  };
  const onSheetScale = (k: string) => {
    setPdfScale(k);
    const b = project.bg;
    const s = PDF_SCALES.find((x) => x[0] === k);
    if (b && b.kind === "image" && b.renderScale && s && s[2]) commit((pp) => { pp.bg!.scale = s[2] / 72 / b.renderScale!; pp.bg!.pdfScale = k; });
  };
  const applyCalib = () => {
    const D = fromU(calDist, units);
    if (!(D > 0) || !calib?.b || !project.bg) { toast("Enter the real distance first"); return; }
    const a = calib.a, k = D / dist(calib.a, calib.b);
    commit((pp) => {
      const b = pp.bg!;
      b.scale *= k;
      b.x = a[0] - (a[0] - b.x) * k;
      b.y = a[1] - (a[1] - b.y) * k;
    });
    setCalib(null);
    setTool("select");
    toast("Background scale set");
  };

  // ── Drawing ─────────────────────────────────────────────────────────────────
  const fillBy = useMemo(() => new Map(an.cab.segs.map((sg) => [sg.t.id + ":" + sg.i, sg.fill])), [an]);

  const gridLines = useMemo(() => {
    if (!grid) return null;
    let s = units === "ft" ? 2 * 0.3048 : 0.6;
    while (s * z < 9) s *= 5;
    const major = s * 5;
    const x0 = -view.tx / z, y0 = -view.ty / z, x1 = x0 + size.w / z, y1 = y0 + size.h / z;
    const out: React.ReactNode[] = [];
    const isMaj = (v: number) => Math.abs(v / major - Math.round(v / major)) < 1e-6;
    for (let x = Math.floor(x0 / s) * s; x < x1; x += s)
      out.push(<line key={"x" + x} x1={x} y1={y0} x2={x} y2={y1} stroke={isMaj(x) ? "var(--rl-grid2)" : "var(--rl-grid)"} vectorEffect="non-scaling-stroke" />);
    for (let y = Math.floor(y0 / s) * s; y < y1; y += s)
      out.push(<line key={"y" + y} x1={x0} y1={y} x2={x1} y2={y} stroke={isMaj(y) ? "var(--rl-grid2)" : "var(--rl-grid)"} vectorEffect="non-scaling-stroke" />);
    return out;
  }, [grid, units, z, view.tx, view.ty, size]);

  const b = project.bg;
  const bgLayer = b && (b.kind === "image" ? (bg.img && (
    <image href={bg.img} x={b.x} y={b.y} width={(b.w ?? 0) * b.scale} height={(b.h ?? 0) * b.scale} opacity={b.opacity}
      transform={`rotate(${b.rot || 0} ${b.x} ${b.y})`} preserveAspectRatio="none" style={{ pointerEvents: "none" }} />
  )) : bg.dxf && (
    <g transform={`translate(${b.x},${b.y}) rotate(${b.rot || 0}) scale(${b.scale},${-b.scale})`} opacity={b.opacity} style={{ pointerEvents: "none" }}>
      <path d={bg.dxf.d} fill="none" stroke="var(--muted-foreground)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
      {bg.dxf.texts.map((t, i) => (
        <text key={i} transform={`translate(${t.x},${t.y}) scale(1,-1) rotate(${-t.r})`} fontSize={t.h} fill="var(--muted-foreground)">{t.s}</text>
      ))}
    </g>
  ));

  const selOutline = (w: number, d: number, extra = 0) => (
    <rect x={-w / 2 - 0.05} y={-d / 2 - 0.05} width={w + 0.1} height={d + 0.1 + extra} fill="none" stroke="var(--rl-accent)" strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
  );
  const measLine = (a: Vec, q: Vec, lbl?: string) => (
    <g>
      <line x1={a[0]} y1={a[1]} x2={q[0]} y2={q[1]} stroke="var(--rl-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={a[0]} cy={a[1]} r={3 / z} fill="var(--rl-accent)" />
      <circle cx={q[0]} cy={q[1]} r={3 / z} fill="var(--rl-accent)" />
      {lbl && <text x={(a[0] + q[0]) / 2} y={(a[1] + q[1]) / 2 - fs * 0.4} fontSize={fs * 1.1} textAnchor="middle" fill="var(--rl-accent)" className="font-mono">{lbl}</text>}
    </g>
  );

  const single = selValid.length === 1 ? findObj(S, selValid[0]) : null;
  const tb = (t: Tool, l: string) => <Btn on={tool === t} onClick={() => { setTool(t); setDraft(null); setMeas(null); if (t !== "calib") setCalib(null); }}>{l}</Btn>;
  const set = (fn: (o: never) => void) => commit((_p, s) => { const f = findObj(s, selValid[0]); if (f) fn(f.o as never); });

  return (
    <>
      <aside className="w-full shrink-0 overflow-y-auto border-b px-3 pb-10 md:w-80 md:border-b-0 md:border-r">
        <Section title="Tools">
          <div className="grid grid-cols-3 gap-1">
            {tb("select", "Select")}{tb("rack", "Rack")}{tb("hac", "Containment")}
            {tb("cooler", "Cooling unit")}{tb("tray", "Tray / busway")}{tb("measure", "Measure")}
          </div>
          {tool === "cooler" && (
            <KV><Label htmlFor="rl-cool-kind">Unit type</Label>
              <Select id="rl-cool-kind" value={coolKind} onChange={setCoolKind} options={Object.entries(COOL_K).map(([k, v]) => [k as CoolerKind, v.name])} /></KV>
          )}
          {tool === "tray" && (
            <>
              <KV><Label htmlFor="rl-tray-kind">Pathway type</Label>
                <Select id="rl-tray-kind" value={trayKind} onChange={setTrayKind} options={Object.entries(TRAY_K).map(([k, v]) => [k as TrayKind, v.name])} /></KV>
              <div className="flex items-center gap-2"><Btn tone="primary" disabled={!draft || draft.pts.length < 2} onClick={finishTray}>Finish tray</Btn><Hint>Hold Shift for angled runs.</Hint></div>
            </>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <label className="flex items-center gap-1"><input type="checkbox" checked={snap} onChange={(e) => setSnapOn(e.target.checked)} /> Snap</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Tray fill colours</label>
          </div>
          <Hint>Drag to move · Shift-click multi-select · R rotate · Ctrl+D duplicate · Del remove · wheel zoom · right-drag or Space-drag pan</Hint>
        </Section>

        <Section title={selValid.length > 1 ? `${selValid.length} items selected` : single ? ({ racks: "Rack", hacs: "Containment", coolers: "Cooling unit", trays: "Pathway" } as const)[single.k] : "Selection"}>
          {!selValid.length && <Hint>Nothing selected. Click a rack, containment, cooling unit or tray.</Hint>}
          {selValid.length > 1 && selValid.every((i) => S.racks.some((r) => r.id === i)) && (
            <KV>
              <Label>RDHx on all</Label>
              <input type="checkbox" onChange={(e) => { const on = e.target.checked; commit((_p, s) => s.racks.forEach((r) => { if (selValid.includes(r.id)) r.rdhx = on; })); }} />
              <Label>PDUs</Label>
              <Btn onClick={() => commit((pp, s) => s.racks.forEach((r) => { if (selValid.includes(r.id)) choosePDU(r, lib, pp.elec, s.loadFactor || 1); }))}>Auto-size all</Btn>
            </KV>
          )}
          {single && (() => {
            const o = single.o as { name: string; x?: number; y?: number; rot?: number };
            return (
              <KV>
                <Label htmlFor="rl-o-name">Name</Label>
                <TextField id="rl-o-name" value={o.name} onChange={(v) => set((x: { name: string }) => { x.name = v; })} />
                {single.k !== "trays" && (
                  <>
                    <Label htmlFor="rl-o-x">X ({uLbl(units)})</Label>
                    <NumField id="rl-o-x" step={0.1} value={toU(o.x!, units)} onChange={(v) => set((x: { x: number }) => { x.x = fromU(v, units); })} />
                    <Label htmlFor="rl-o-y">Y ({uLbl(units)})</Label>
                    <NumField id="rl-o-y" step={0.1} value={toU(o.y!, units)} onChange={(v) => set((x: { y: number }) => { x.y = fromU(v, units); })} />
                    <Label htmlFor="rl-o-rot">Rotation</Label>
                    <Select id="rl-o-rot" width="w-24" value={String(o.rot || 0)} onChange={(v) => set((x: { rot: number }) => { x.rot = +v; })} options={["0", "90", "180", "270"].map((a) => [a, a + "°"])} />
                  </>
                )}
              </KV>
            );
          })()}
          {single?.k === "racks" && (() => {
            const r = single.o as Scenario["racks"][number];
            const x = an.racks.find((x) => x.r.id === r.id)!;
            return (
              <>
                <KV>
                  <Label htmlFor="rl-o-role">Role</Label>
                  <Select id="rl-o-role" value={r.role} onChange={(v) => set((o: typeof r) => { o.role = v; })} options={[["compute", "Compute"], ["network", "Network"], ["storage", "Storage"]]} />
                  <Label htmlFor="rl-o-size">Width × depth</Label>
                  <Select id="rl-o-size" value={`${r.w}x${r.d}`} onChange={(v) => set((o: typeof r) => { const [a, b2] = v.split("x"); o.w = +a; o.d = +b2; })}
                    options={[["0.6x1.2", "600 × 1200 mm"], ["0.8x1.2", "800 × 1200 mm"], ["0.6x1.07", "600 × 1070 mm"], ["0.8x1.4", "800 × 1400 mm"]]} />
                  <Label htmlFor="rl-o-rd">Rear door HX</Label>
                  <input id="rl-o-rd" type="checkbox" checked={r.rdhx} onChange={(e) => { const on = e.target.checked; set((o: typeof r) => { o.rdhx = on; }); }} />
                </KV>
                <KV>
                  <Label>IT load</Label><span className="font-mono text-xs">{n1(x.it)} kW</span>
                  <Label>Air / liquid</Label><span className="font-mono text-xs">{n1(x.air)} / {n1(x.liq)} kW</span>
                  <Label>To room</Label><span className="font-mono text-xs">{n1(x.room)} kW</span>
                  <Label>Contained</Label><span>{x.contained ? <Chip tone="ok">yes</Chip> : <Chip tone="mute">no</Chip>}</span>
                  <Label>PDU</Label><span className="font-mono text-xs">{r.pduPairs}× pair {PDU_TYPES[r.pdu].amps}A <UtilChip u={x.st.util} /></span>
                  <Label>U used</Label><span className="font-mono text-xs">{x.u} / {r.u}</span>
                </KV>
                {x.warn.length > 0 && <ul className="space-y-1">{x.warn.map((w, i) => <li key={i} className="flex gap-2 text-xs"><Chip tone="bad">!</Chip>{w}</li>)}</ul>}
                <div className="flex gap-1"><Btn onClick={() => { p.setSelRack(r.id); p.goTab("elev"); }}>Edit elevation</Btn><Btn onClick={() => { p.setSelRack(r.id); p.goTab("power"); }}>Power striping</Btn></div>
              </>
            );
          })()}
          {single?.k === "hacs" && (() => {
            const h = single.o as Scenario["hacs"][number];
            return (
              <>
                <KV>
                  <Label htmlFor="rl-h-w">Length ({uLbl(units)})</Label>
                  <NumField id="rl-h-w" step={0.1} value={toU(h.w, units)} onChange={(v) => set((o: typeof h) => { o.w = fromU(v, units); })} />
                  <Label htmlFor="rl-h-d">Aisle width ({uLbl(units)})</Label>
                  <NumField id="rl-h-d" step={0.1} value={toU(h.d, units)} onChange={(v) => set((o: typeof h) => { o.d = fromU(v, units); })} />
                  <Label>Racks contained</Label>
                  <span className="font-mono text-xs">{S.racks.filter((r) => inRect(rackRear(r), h, 0.05)).length}</span>
                </KV>
                <Hint>A rack counts as contained when its rear face opens into a containment zone. Place one zone per pod; any number are allowed.</Hint>
              </>
            );
          })()}
          {single?.k === "coolers" && (() => {
            const c = single.o as Scenario["coolers"][number];
            return (
              <KV>
                <Label htmlFor="rl-c-kind">Type</Label>
                <Select id="rl-c-kind" value={c.kind} onChange={(v) => set((o: typeof c) => { const K = COOL_K[v]; o.kind = v; o.w = K.w; o.d = K.d; o.cap = K.cap; })} options={Object.entries(COOL_K).map(([k, v]) => [k as CoolerKind, v.name])} />
                <Label htmlFor="rl-c-cap">Capacity (kW)</Label>
                <NumField id="rl-c-cap" step={5} value={c.cap} onChange={(v) => set((o: typeof c) => { o.cap = v; })} />
              </KV>
            );
          })()}
          {single?.k === "trays" && (() => {
            const t = single.o as Scenario["trays"][number];
            return (
              <>
                <KV>
                  <Label htmlFor="rl-t-kind">Type</Label>
                  <Select id="rl-t-kind" value={t.kind} onChange={(v) => set((o: typeof t) => { o.kind = v; })} options={Object.entries(TRAY_K).map(([k, v]) => [k as TrayKind, v.name])} />
                  <Label htmlFor="rl-t-w">Width (mm)</Label>
                  <NumField id="rl-t-w" step={25} value={t.wmm} onChange={(v) => set((o: typeof t) => { o.wmm = v; })} />
                  <Label htmlFor="rl-t-d">Depth (mm)</Label>
                  <NumField id="rl-t-d" step={25} value={t.dmm} onChange={(v) => set((o: typeof t) => { o.dmm = v; })} />
                  <Label htmlFor="rl-t-el">Elevation AFF ({uLbl(units)})</Label>
                  <NumField id="rl-t-el" step={0.1} value={toU(t.elev, units)} onChange={(v) => set((o: typeof t) => { o.elev = fromU(v, units); })} />
                  <Label>Length</Label><span className="font-mono text-xs">{fLen(polyLength(t.pts), units)}</span>
                </KV>
                <Hint>Drag the round handles to reshape. Data cables route on fiber ducts and ladder trays only.</Hint>
              </>
            );
          })()}
          {selValid.length > 0 && (
            <div className="flex gap-1"><Btn onClick={rotSel}>Rotate 90°</Btn><Btn onClick={dupSel}>Duplicate</Btn><Btn tone="danger" onClick={delSel}>Delete</Btn></div>
          )}
        </Section>

        <Fold title="Generate layout" open={openGen} onToggle={setOpenGen}>
          <KV>
            <Label htmlFor="rl-g-n">Compute nodes</Label><NumField id="rl-g-n" min={1} step={1} value={g.nodes} onChange={(v) => setG({ ...g, nodes: Math.max(1, Math.round(v)) })} />
            <Label htmlFor="rl-g-per">Nodes per rack</Label><NumField id="rl-g-per" min={1} max={10} step={1} value={g.perRack} onChange={(v) => setG({ ...g, perRack: Math.max(1, Math.round(v)) })} />
            <Label htmlFor="rl-g-model">Node model</Label>
            <Select id="rl-g-model" value={g.model} onChange={(v) => setG({ ...g, model: v })} options={project.lib.filter((l) => l.cat === "compute").map((l) => [l.id, l.name])} />
            <Label htmlFor="rl-g-pat">Arrangement</Label>
            <Select id="rl-g-pat" value={g.pattern} onChange={(v) => setG({ ...g, pattern: v })} options={[["pod", "Two rows, shared hot aisle"], ["single", "Single row"]]} />
            <Label htmlFor="rl-g-cool">Cooling</Label>
            <Select id="rl-g-cool" value={g.cooling} onChange={(v) => setG({ ...g, cooling: v })} options={[["hac", "HAC + CRAH"], ["rdhx", "RDHx"], ["hac+rdhx", "HAC + RDHx"]]} />
            <Label htmlFor="rl-g-w">Rack width</Label>
            <Select id="rl-g-w" value={String(g.rackW)} onChange={(v) => setG({ ...g, rackW: +v })} options={[["0.6", "600 mm"], ["0.8", "800 mm"]]} />
            <Label htmlFor="rl-g-hot">Hot aisle ({uLbl(units)})</Label><NumField id="rl-g-hot" step={0.1} value={toU(g.hot, units)} onChange={(v) => setG({ ...g, hot: fromU(v, units) })} />
            <Label htmlFor="rl-g-cold">Cold aisle ({uLbl(units)})</Label><NumField id="rl-g-cold" step={0.1} value={toU(g.cold, units)} onChange={(v) => setG({ ...g, cold: fromU(v, units) })} />
            <Label htmlFor="rl-g-net">Network rack</Label><input id="rl-g-net" type="checkbox" checked={g.net} onChange={(e) => setG({ ...g, net: e.target.checked })} />
          </KV>
          <div className="flex flex-wrap gap-1"><Btn tone="primary" onClick={() => generate(false)}>Create as new scenario</Btn><Btn onClick={() => generate(true)}>Replace this layout</Btn></div>
          <Hint>Builds racks, devices, containment, trays, busway, CRAH/CDU count ({S.cool.red}) and auto-sizes PDUs, placed at the view centre. To compare many variants at once, use Sweep on the Compare tab.</Hint>
        </Fold>

        <Fold title="Background drawing" open={openBg} onToggle={setOpenBg}>
          <input ref={fileIn} type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.svg,.dxf" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          <div className="flex gap-1">
            <Btn tone={b ? undefined : "primary"} disabled={busy} onClick={() => fileIn.current?.click()}>{busy ? "Working…" : "Load PDF, image or DXF…"}</Btn>
            {b && <Btn tone="danger" onClick={() => { commit((pp) => { pp.bg = null; }); p.setBg({}); if (tool === "bgmove" || tool === "calib") setTool("select"); }}>Remove</Btn>}
          </div>
          {!b && <Hint>Overlay a scaled floor plan. PDF sheets render one page at a time; DXF reads lines, polylines, arcs, circles, text and blocks. Export DWG to DXF or PDF first. {p.projectId ? "Drawings are stored privately with this project, visible only to its members." : "Save the project to your account to store drawings with it."}</Hint>}
          <KV>
            <Label htmlFor="rl-bg-page">PDF page{b?.pages ? ` (of ${b.pages})` : ""}</Label>
            <NumField id="rl-bg-page" min={1} step={1} value={pdfPage} onChange={(v) => onPage(Math.max(1, Math.round(v)))} />
            <Label htmlFor="rl-bg-scale">PDF sheet scale</Label>
            <Select id="rl-bg-scale" value={b?.pdfScale ?? pdfScale} onChange={onSheetScale} options={PDF_SCALES.map(([k, l]) => [k, l])} />
          </KV>
          {b && (
            <>
              <Hint>
                {b.name}
                {bg.lost && <> · <b>stored file unavailable, reload it</b></>}
                {bg.local && !bg.lost && " · this session only"}
              </Hint>
              <KV>
                <Label htmlFor="rl-bg-op">Opacity</Label>
                <input id="rl-bg-op" type="range" min={0.05} max={1} step={0.05} value={b.opacity} className="w-28" onChange={(e) => { const v = +e.target.value; live((pp) => { if (pp.bg) pp.bg.opacity = v; }); }} onPointerDown={beginLive} onPointerUp={() => endLive(true)} />
                <Label htmlFor="rl-bg-rot">Rotation (°)</Label>
                <NumField id="rl-bg-rot" step={0.5} value={b.rot || 0} onChange={(v) => commit((pp) => { pp.bg!.rot = v; })} />
                <Label htmlFor="rl-bg-sc">Scale ({uLbl(units)} per {b.kind === "dxf" ? "unit" : "px"})</Label>
                <NumField id="rl-bg-sc" value={toU(b.scale, units)} onChange={(v) => commit((pp) => { pp.bg!.scale = fromU(v, units); })} />
              </KV>
              <div className="flex gap-1">
                <Btn on={tool === "bgmove"} onClick={() => setTool(tool === "bgmove" ? "select" : "bgmove")}>Move background</Btn>
                <Btn on={tool === "calib"} onClick={() => { setTool("calib"); setCalib(null); }}>Calibrate scale</Btn>
              </div>
              {calib?.b && (
                <>
                  <KV><Label htmlFor="rl-cal-d">Real distance ({uLbl(units)})</Label><NumField id="rl-cal-d" step={0.01} value={calDist} onChange={setCalDist} /></KV>
                  <div className="flex items-center gap-2"><Btn tone="primary" onClick={applyCalib}>Apply scale</Btn><Hint>Measured {fLen(dist(calib.a, calib.b), units, 2)} at the current scale.</Hint></div>
                </>
              )}
            </>
          )}
        </Fold>
      </aside>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--rl-canvas)]">
        <svg
          id="rl-layout-svg" ref={svgRef} className="block h-full w-full touch-none select-none"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onDoubleClick={() => tool === "tray" && finishTray()} onContextMenu={(e) => e.preventDefault()}
        >
          <defs>
            {/* Plan units are metres: size the hatch in screen pixels (8 px pitch). */}
            <pattern id="rl-hatch" width={8 / z} height={8 / z} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2={8 / z} stroke="var(--rl-hot)" strokeOpacity=".35" strokeWidth={2 / z} />
            </pattern>
          </defs>
          <g transform={`translate(${view.tx},${view.ty}) scale(${z})`}>
            <g>{gridLines}</g>
            <g>{bgLayer}</g>
            <g>
              {S.trays.map((t) => {
                const col = TRAY_K[t.kind]?.color ?? "var(--muted-foreground)", w = Math.max((+t.wmm || 300) / 1000, 2 / z);
                return (
                  <g key={t.id}>
                    {t.pts.slice(0, -1).map((a, i) => {
                      const q = t.pts[i + 1];
                      let c = col;
                      const f = fillBy.get(t.id + ":" + i);
                      if (fill && f != null) { const u = f / S.cable.fillMax; c = u > 1 ? "var(--rl-bad)" : u > 0.8 ? "var(--rl-warn)" : "var(--rl-ok)"; }
                      return <line key={i} data-id={t.id} x1={a[0]} y1={a[1]} x2={q[0]} y2={q[1]} stroke={c} strokeOpacity={0.55} strokeWidth={w} strokeLinecap="square" style={{ cursor: "move" }} />;
                    })}
                    {t.pts.length > 0 && <text x={t.pts[0][0]} y={t.pts[0][1] - w / 2 - fs * 0.3} fontSize={fs * 0.85} fill={col} className="pointer-events-none font-mono">{t.name}</text>}
                    {selValid.includes(t.id) && t.pts.map((q, i) => (
                      <circle key={"v" + i} data-vtx={`${t.id}:${i}`} cx={q[0]} cy={q[1]} r={6 / z} fill="var(--card)" stroke="var(--rl-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" style={{ cursor: "grab" }} />
                    ))}
                  </g>
                );
              })}
              {S.hacs.map((o) => (
                <g key={o.id} data-id={o.id} transform={`translate(${o.x},${o.y}) rotate(${o.rot || 0})`} style={{ cursor: "move" }}>
                  <rect x={-o.w / 2} y={-o.d / 2} width={o.w} height={o.d} fill="var(--rl-hot-soft)" stroke="var(--rl-hot)" strokeWidth={1.5} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
                  <rect x={-o.w / 2} y={-o.d / 2} width={o.w} height={o.d} fill="url(#rl-hatch)" pointerEvents="none" />
                  <text y={fs * 0.35} textAnchor="middle" fontSize={fs} fill="var(--rl-hot)" fontWeight={600}>{o.name} · hot aisle {fLen(o.d, units)}</text>
                  {selValid.includes(o.id) && selOutline(o.w, o.d)}
                </g>
              ))}
              {S.coolers.map((o) => (
                <g key={o.id} data-id={o.id} transform={`translate(${o.x},${o.y}) rotate(${o.rot || 0})`} style={{ cursor: "move" }}>
                  <rect x={-o.w / 2} y={-o.d / 2} width={o.w} height={o.d} fill="var(--rl-cold-soft)" stroke="var(--rl-cold)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  <line x1={-o.w / 2} y1={-o.d / 2} x2={o.w / 2} y2={-o.d / 2} stroke="var(--rl-cold)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                  <g transform={`rotate(${-(o.rot || 0)})`}>
                    <text y={-fs * 0.1} textAnchor="middle" fontSize={fs * 0.9} fill="var(--rl-cold)" fontWeight={600}>{o.name}</text>
                    <text y={fs * 0.95} textAnchor="middle" fontSize={fs * 0.75} fill="var(--muted-foreground)" className="font-mono">{n0(o.cap)} kW</text>
                  </g>
                  {selValid.includes(o.id) && selOutline(o.w, o.d)}
                </g>
              ))}
              {an.racks.map((x) => {
                const r = x.r;
                return (
                  <g key={r.id} data-id={r.id} transform={`translate(${r.x},${r.y}) rotate(${r.rot || 0})`} style={{ cursor: "move" }}>
                    <rect x={-r.w / 2} y={-r.d / 2} width={r.w} height={r.d} fill={r.role === "network" ? "var(--rl-warn-soft)" : heatFill(x.it)} stroke="var(--foreground)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={-r.w / 2} y1={-r.d / 2} x2={r.w / 2} y2={-r.d / 2} stroke="var(--rl-cold)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                    <line x1={-r.w / 2} y1={r.d / 2} x2={r.w / 2} y2={r.d / 2} stroke="var(--rl-hot)" strokeWidth={3} vectorEffect="non-scaling-stroke" />
                    {r.rdhx && <rect x={-r.w / 2} y={r.d / 2} width={r.w} height={0.16} fill="var(--rl-cold-soft)" stroke="var(--rl-cold)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
                    <g transform={`rotate(${-(r.rot || 0)})`}>
                      <text y={-fs * 0.25} textAnchor="middle" fontSize={fs} fill="var(--foreground)" fontWeight={600}>{r.name}</text>
                      <text y={fs * 0.85} textAnchor="middle" fontSize={fs * 0.78} fill="var(--muted-foreground)" className="font-mono">{n1(x.it)} kW</text>
                      {x.warn.length > 0 && <circle cx={r.w / 2 - 0.07} cy={-r.d / 2 + 0.09} r={Math.max(0.05, 3 / z)} fill="var(--rl-bad)" />}
                    </g>
                    {selValid.includes(r.id) && selOutline(r.w, r.d, 0.12)}
                  </g>
                );
              })}
            </g>
            <g>
              {draft && draft.pts.length > 0 && (() => {
                const pts = draft.hover ? [...draft.pts, draft.hover] : draft.pts;
                return (
                  <>
                    <polyline points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke="var(--rl-accent)" strokeWidth={0.3} strokeOpacity={0.5} />
                    {pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={3 / z} fill="var(--rl-accent)" />)}
                  </>
                );
              })()}
              {meas && (meas.b || meas.hover) && measLine(meas.a, (meas.b || meas.hover)!, fLen(dist(meas.a, (meas.b || meas.hover)!), units, 2))}
              {calib && (calib.b || calib.hover) && measLine(calib.a, (calib.b || calib.hover)!)}
            </g>
          </g>
        </svg>
        <div className="absolute right-2.5 top-2.5 flex gap-1">
          <Btn aria-label="Zoom in" onClick={() => zoomAt(1.3, size.w / 2, size.h / 2)}>+</Btn>
          <Btn aria-label="Zoom out" onClick={() => zoomAt(1 / 1.3, size.w / 2, size.h / 2)}>−</Btn>
          <Btn onClick={fitView}>Fit</Btn>
        </div>
        {TOOL_HINT[tool] && <div className="absolute left-1/2 top-2.5 max-w-[80%] -translate-x-1/2 rounded bg-foreground px-2.5 py-1 text-center text-xs text-background">{TOOL_HINT[tool]}</div>}
        <div className="absolute bottom-2.5 left-2.5 flex max-w-[calc(100%-20px)] flex-wrap gap-3 rounded-md border bg-card px-2.5 py-1.5 text-[11px]">
          <span><b className="font-mono">{an.racks.length}</b> racks</span>
          <span><b className="font-mono">{an.nodes}</b> compute nodes</span>
          <span><b className="font-mono">{n1(an.it)}</b> kW IT</span>
          <span>max <b className="font-mono">{n1(an.maxRack)}</b> kW/rack</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--rl-cold)] align-[-1px]" />front</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[var(--rl-hot)] align-[-1px]" />rear</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-[var(--rl-cold)] bg-[var(--rl-cold-soft)] align-[-1px]" />RDHx</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-[var(--rl-hot)] bg-[var(--rl-hot-soft)] align-[-1px]" />HAC</span>
        </div>
      </div>
    </>
  );
}
