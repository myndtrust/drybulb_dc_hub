"use client";

// Background drawing intake. With the rackline-api service configured, files
// go to the private GCS bucket and PDF / DXF processing runs on Cloud Run; the
// project keeps only object paths. Without it (local dev) the same work runs in
// the browser and the drawing lasts for the session.

import { DXF_UNITS, PDF_SCALES } from "@/lib/rackline/constants";
import { fetchDxf, fileUrl, isCloudConfigured, processDxf, renderPdf, uploadFile } from "@/lib/rackline/cloud";
import { parseDXF, type DxfDrawing } from "@/lib/rackline/dxf";
import type { Background } from "@/lib/rackline/types";
import type { BgView } from "./shared";

export interface BgLoad {
  bg: Background;
  view: BgView;
  message: string;
}

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    return m;
  });
  return pdfjs;
}

async function renderPdfInBrowser(data: ArrayBuffer, pageNo: number) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(data) }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const v1 = page.getViewport({ scale: 1 });
    const renderScale = Math.min(5, 7000 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale: renderScale });
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width);
    cv.height = Math.round(vp.height);
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("render failed"))), "image/png"));
    return { url: URL.createObjectURL(blob), w: cv.width, h: cv.height, renderScale, pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

const imageSize = (url: string) =>
  new Promise<{ w: number; h: number }>((res, rej) => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth || 2000, h: i.naturalHeight || 1500 });
    i.onerror = () => rej(new Error("Not a readable image."));
    i.src = url;
  });

/** Metres per pixel for a rasterised PDF sheet at a known sheet scale. */
function sheetScale(pdfScale: string, renderScale: number): number | null {
  const s = PDF_SCALES.find((x) => x[0] === pdfScale);
  return s && s[2] ? s[2] / 72 / renderScale : null;
}

function dxfBackground(name: string, d: DxfDrawing, path?: string): Background {
  const k = DXF_UNITS[d.insunits] ?? 0.001;
  return { kind: "dxf", name, path, scale: k, x: -d.bounds[0] * k, y: d.bounds[3] * k, rot: 0, opacity: 0.6 };
}

export async function loadBackgroundFile(
  file: File, o: { page: number; pdfScale: string; prev: Background | null; signedIn: boolean; projectId: string | null; editable: boolean },
): Promise<BgLoad> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  // Stored drawings belong to a saved project; otherwise keep it for this session.
  const pid = isCloudConfigured && o.signedIn && o.editable ? o.projectId : null;
  const cloud = pid !== null;
  const keep = (b: Background) => ({ ...b, x: o.prev?.x ?? b.x, y: o.prev?.y ?? b.y });

  if (ext === "dxf") {
    if (cloud) {
      const src = await uploadFile(file, file.name, pid!);
      const r = await processDxf(src);
      const d = await fetchDxf(r.path);
      return { bg: { ...dxfBackground(file.name, d, r.path), src }, view: { dxf: d }, message: `DXF stored, ${r.count.toLocaleString()} entities` };
    }
    const d = parseDXF(await file.text());
    if (!d.count) throw new Error("No drawable entities found in that DXF.");
    return { bg: dxfBackground(file.name, d), view: { dxf: d, local: true }, message: `DXF loaded for this session only, ${d.count.toLocaleString()} entities${isCloudConfigured ? ". Save the project, then reload the drawing to store it." : ""}` };
  }

  if (ext === "pdf") {
    let r: { url: string; w: number; h: number; renderScale: number; pages: number; path?: string; src?: string };
    if (cloud) {
      const src = await uploadFile(file, file.name, pid!);
      r = { ...(await renderPdf(src, o.page)), src };
    } else {
      r = await renderPdfInBrowser(await file.arrayBuffer(), o.page);
    }
    const known = sheetScale(o.pdfScale, r.renderScale);
    const bg = keep({
      kind: "image", name: file.name, path: r.path, src: r.src, page: Math.min(o.page, r.pages), pages: r.pages,
      w: r.w, h: r.h, scale: known ?? (o.prev?.kind === "image" ? o.prev.scale : 20 / r.w),
      renderScale: r.renderScale, pdfScale: o.pdfScale, x: 0, y: 0, rot: 0, opacity: 0.55,
    });
    return {
      bg, view: { img: r.url, local: !cloud },
      message: known ? `Loaded at ${PDF_SCALES.find((x) => x[0] === o.pdfScale)![1]}` : "Loaded. Use Calibrate scale with a known dimension.",
    };
  }

  // Raster / SVG image.
  let url: string, path: string | undefined;
  if (cloud) { path = await uploadFile(file, file.name, pid!); url = await fileUrl(path); }
  else url = URL.createObjectURL(file);
  const { w, h } = await imageSize(url);
  return {
    bg: keep({ kind: "image", name: file.name, path, src: path, w, h, scale: 20 / w, x: 0, y: 0, rot: 0, opacity: 0.55 }),
    view: { img: url, local: !cloud },
    message: "Loaded. Use Calibrate scale with a known dimension.",
  };
}

/** Re-render another page of a stored PDF (cloud only; the source must be in the bucket). */
export async function changePdfPage(bg: Background, page: number): Promise<BgLoad> {
  if (!bg.src || !isCloudConfigured) throw new Error("Reload the PDF to change pages.");
  const r = await renderPdf(bg.src, page);
  const known = bg.pdfScale ? sheetScale(bg.pdfScale, r.renderScale) : null;
  return {
    bg: { ...bg, path: r.path, page, pages: r.pages, w: r.w, h: r.h, renderScale: r.renderScale, scale: known ?? bg.scale },
    view: { img: r.url },
    message: `Page ${page} of ${r.pages}`,
  };
}

/** Fetch the drawable form of a stored background when a project is opened. */
export async function restoreBackground(bg: Background): Promise<BgView> {
  if (!bg.path || !isCloudConfigured) return { lost: true };
  try {
    if (bg.kind === "dxf") return { dxf: await fetchDxf(bg.path) };
    return { img: await fileUrl(bg.path) };
  } catch {
    return { lost: true };
  }
}

/** Plan-space bounding box of the background. */
export function bgBounds(bg: Background, view: BgView): [number, number][] | null {
  if (bg.kind === "dxf") {
    if (!view.dxf) return null;
    const B = view.dxf.bounds;
    return [[bg.x + B[0] * bg.scale, bg.y - B[3] * bg.scale], [bg.x + B[2] * bg.scale, bg.y - B[1] * bg.scale]];
  }
  return [[bg.x, bg.y], [bg.x + (bg.w ?? 0) * bg.scale, bg.y + (bg.h ?? 0) * bg.scale]];
}
