// Server-side background processing: rasterise one PDF sheet to PNG, and
// flatten a DXF to the compact path/text form the layout canvas draws. Both run
// here rather than in the browser so large drawing sets don't stall the page.

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { parseDXF, type DxfDrawing } from "../../../lib/rackline/dxf";

/** Longest side of the rendered sheet (px); keeps memory bounded for E-size sheets. */
const MAX_PX = 7000;

export interface RenderedPage {
  png: Buffer;
  w: number;
  h: number;
  /** Pixels per PDF point (1/72 in) — the client turns sheet scale into m/px with it. */
  renderScale: number;
  pages: number;
}

export async function renderPdfPage(pdf: Buffer, pageNo: number): Promise<RenderedPage> {
  const doc = await getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, useSystemFonts: false }).promise;
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
    const v1 = page.getViewport({ scale: 1 });
    const renderScale = Math.min(5, MAX_PX / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale: renderScale });
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js types expect a DOM context; @napi-rs/canvas implements the same API.
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise;
    return { png: canvas.toBuffer("image/png"), w: canvas.width, h: canvas.height, renderScale, pages: doc.numPages };
  } finally {
    await doc.destroy();
  }
}

export function processDxf(txt: string): DxfDrawing {
  return parseDXF(txt);
}
