// Minimal DXF reader for background drawings: LINE, LWPOLYLINE, POLYLINE,
// CIRCLE, ARC, TEXT, MTEXT and block INSERTs (nested up to 4 deep), flattened
// to one SVG path in drawing units (y up). DWG must be exported to DXF first.

export interface DxfText { x: number; y: number; h: number; r: number; s: string }

export interface DxfDrawing {
  /** SVG path data in drawing units. */
  d: string;
  texts: DxfText[];
  /** Number of drawable entities emitted. */
  count: number;
  /** [minX, minY, maxX, maxY] in drawing units. */
  bounds: [number, number, number, number];
  /** $INSUNITS header code (0 = unitless). */
  insunits: number;
}

type Pair = [number, string];
interface Ent { type: string; c: Pair[]; v?: Ent[] }
interface Block { name: string; bx: number; by: number; ents: Ent[] }
/** 2D affine [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type M = [number, number, number, number, number, number];

const MAX_ENTS = 200_000, MAX_TEXTS = 4000;

export function parseDXF(txt: string): DxfDrawing {
  const lines = txt.split(/\r?\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([+lines[i].trim(), lines[i + 1].trim()]);

  let insunits = 0;
  for (let i = 0; i < pairs.length - 1; i++)
    if (pairs[i][0] === 9 && pairs[i][1] === "$INSUNITS") { insunits = +pairs[i + 1][1]; break; }

  const blocks: Record<string, Block> = {}, entities: Ent[] = [];
  let i = 0, sec: string | null = null, cur: Block | null = null;
  const readEnt = (): Ent => {
    const e: Ent = { type: pairs[i][1], c: [] };
    i++;
    while (i < pairs.length && pairs[i][0] !== 0) { e.c.push(pairs[i]); i++; }
    return e;
  };
  const num = (e: Ent, code: number, def: number) => { const p = e.c.find((p) => p[0] === code); return p ? +p[1] : def; };
  const str = (e: Ent, code: number) => e.c.find((p) => p[0] === code)?.[1];
  const all = (e: Ent, code: number) => e.c.filter((p) => p[0] === code).map((p) => +p[1]);

  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "SECTION") { sec = pairs[i + 1]?.[1] ?? null; i += 2; continue; }
    if (c === 0 && v === "ENDSEC") { sec = null; i++; continue; }
    if (c === 0 && (sec === "ENTITIES" || sec === "BLOCKS")) {
      if (v === "BLOCK") {
        const e = readEnt();
        cur = { name: str(e, 2) ?? "", bx: num(e, 10, 0), by: num(e, 20, 0), ents: [] };
        continue;
      }
      if (v === "ENDBLK") { if (cur) blocks[cur.name] = cur; cur = null; readEnt(); continue; }
      const e = readEnt();
      if (sec === "BLOCKS") cur?.ents.push(e);
      else entities.push(e);
      continue;
    }
    i++;
  }

  // Fold POLYLINE … VERTEX … SEQEND into one entity.
  const groupPoly = (list: Ent[]): Ent[] => {
    const out: Ent[] = [];
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      if (e.type === "POLYLINE") {
        const pl: Ent = { type: "PL", c: e.c, v: [] };
        k++;
        while (k < list.length && list[k].type === "VERTEX") { pl.v!.push(list[k]); k++; }
        out.push(pl);
      } else out.push(e);
    }
    return out;
  };
  for (const b of Object.values(blocks)) b.ents = groupPoly(b.ents);
  const top = groupPoly(entities);

  let d = "", count = 0;
  const texts: DxfText[] = [];
  const B: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const emit = (pts: [number, number][], m: M, closed = false) => {
    if (pts.length < 2) return;
    const q = pts.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    for (const p of q)
      if (isFinite(p[0]) && isFinite(p[1])) {
        B[0] = Math.min(B[0], p[0]); B[1] = Math.min(B[1], p[1]);
        B[2] = Math.max(B[2], p[0]); B[3] = Math.max(B[3], p[1]);
      }
    d += "M" + q.map((p) => p[0].toFixed(3) + " " + p[1].toFixed(3)).join("L") + (closed ? "Z" : "");
    count++;
  };
  const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number): [number, number][] => {
    if (a1 < a0) a1 += 360;
    const n = Math.max(8, Math.ceil((a1 - a0) / 10));
    const o: [number, number][] = [];
    for (let k = 0; k <= n; k++) {
      const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
      o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return o;
  };
  const mul = (A: M, Bm: M): M => [
    A[0] * Bm[0] + A[2] * Bm[1], A[1] * Bm[0] + A[3] * Bm[1],
    A[0] * Bm[2] + A[2] * Bm[3], A[1] * Bm[2] + A[3] * Bm[3],
    A[0] * Bm[4] + A[2] * Bm[5] + A[4], A[1] * Bm[4] + A[3] * Bm[5] + A[5],
  ];

  const walk = (list: Ent[], m: M, depth: number) => {
    for (const e of list) {
      if (count > MAX_ENTS) return;
      switch (e.type) {
        case "LINE":
          emit([[num(e, 10, 0), num(e, 20, 0)], [num(e, 11, 0), num(e, 21, 0)]], m);
          break;
        case "LWPOLYLINE": {
          const xs = all(e, 10), ys = all(e, 20);
          emit(xs.map((x, k) => [x, ys[k]]), m, (num(e, 70, 0) & 1) === 1);
          break;
        }
        case "PL":
          emit((e.v ?? []).map((v) => [num(v, 10, 0), num(v, 20, 0)]), m, (num(e, 70, 0) & 1) === 1);
          break;
        case "CIRCLE":
          emit(arcPts(num(e, 10, 0), num(e, 20, 0), num(e, 40, 0), 0, 360), m, true);
          break;
        case "ARC":
          emit(arcPts(num(e, 10, 0), num(e, 20, 0), num(e, 40, 0), num(e, 50, 0), num(e, 51, 360)), m);
          break;
        case "TEXT":
        case "MTEXT": {
          if (texts.length > MAX_TEXTS) break;
          const x = num(e, 10, 0), y = num(e, 20, 0);
          const s = (str(e, 1) || "").replace(/\\[A-Za-z][^;]*;|[{}]|\\P/g, " ").trim();
          if (!s) break;
          const sc = Math.hypot(m[0], m[1]);
          texts.push({
            x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5],
            h: num(e, 40, 1) * sc, r: num(e, 50, 0) + (Math.atan2(m[1], m[0]) * 180) / Math.PI, s: s.slice(0, 80),
          });
          break;
        }
        case "INSERT": {
          if (depth > 4) break;
          const b = blocks[str(e, 2) ?? ""];
          if (!b) break;
          const sx = num(e, 41, 1), sy = num(e, 42, 1), a = (num(e, 50, 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
          const T: M = [c * sx, s * sx, -s * sy, c * sy, num(e, 10, 0), num(e, 20, 0)];
          const Tb: M = [1, 0, 0, 1, -b.bx, -b.by];
          walk(b.ents, mul(m, mul(T, Tb)), depth + 1);
          break;
        }
      }
    }
  };
  walk(top, [1, 0, 0, 1, 0, 0], 0);
  if (!isFinite(B[0])) { B[0] = B[1] = 0; B[2] = B[3] = 1; }
  return { d, texts, count, bounds: B, insunits };
}
