// rackline-api — Cloud Run service behind the Rackline DCIM tool on drybulb.com.
//
//   POST /v1/uploads          → signed PUT URL for a background drawing
//   POST /v1/files/url        → signed GET URL for one of the caller's files
//   POST /v1/files/delete     → delete a background and its derived files
//   POST /v1/backgrounds/pdf  → render one PDF sheet to PNG in the bucket
//   POST /v1/backgrounds/dxf  → flatten a DXF to drawable JSON in the bucket
//   POST /v1/sweep            → generate + analyse a grid of layouts
//   GET  /health (also /healthz locally — Cloud Run reserves /healthz on run.app URLs)
//
// Every /v1 call needs the caller's Supabase access token (Bearer). Files live
// in the private bucket under projects/<project id>/ and are never public; each
// file call checks the caller's role on that project in Postgres first
// (any member may read; owners, editors and Drybulb staff may write).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { sweep, type SweepRequest } from "../../../lib/rackline/sweep";
import { AccessError, AuthError, callerFromRequest, requireRole, type Caller } from "./auth";
import { FileError, assertProjectId, createUpload, derivedPath, download, projectOfPath, readUrl, removeUpload, upload } from "./files";
import { processDxf, renderPdfPage } from "./render";

const PORT = Number(process.env.PORT ?? 8080);
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? "https://www.drybulb.com,https://drybulb.com,http://localhost:3000")
  .split(",").map((s) => s.trim()).filter(Boolean);
const MAX_JSON = 2 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader("Access-Control-Allow-Origin", o);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Max-Age", "3600");
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_JSON) throw new HttpError(413, "Request too large.");
    chunks.push(c as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof v !== "object" || v === null) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Body must be JSON.");
  }
}

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

type Handler = (c: Caller, b: Record<string, unknown>) => Promise<unknown>;

/** Resolve a stored path to its project and check the caller's access. */
async function owned(c: Caller, path: unknown, write: boolean): Promise<string> {
  const f = projectOfPath(path);
  await requireRole(c, f.projectId, write);
  return f.path;
}

const routes: Record<string, Handler> = {
  "/v1/uploads": async (c, b) => {
    const projectId = assertProjectId(b.projectId);
    await requireRole(c, projectId, true);
    return createUpload(projectId, String(b.name ?? ""), Number(b.size));
  },

  "/v1/files/url": async (c, b) => ({ url: await readUrl(await owned(c, b.path, false)) }),

  "/v1/files/delete": async (c, b) => { await removeUpload(await owned(c, b.path, true)); return { ok: true }; },

  "/v1/backgrounds/pdf": async (c, b) => {
    const src = await owned(c, b.path, true);
    if (!src.toLowerCase().endsWith(".pdf")) throw new FileError("Not a PDF.");
    const page = Math.max(1, Math.floor(Number(b.page) || 1));
    const r = await renderPdfPage(await download(src), page);
    const path = derivedPath(src, `.p${page}.png`);
    await upload(path, r.png, "image/png");
    return { path, url: await readUrl(path), w: r.w, h: r.h, renderScale: r.renderScale, pages: r.pages };
  },

  "/v1/backgrounds/dxf": async (c, b) => {
    const src = await owned(c, b.path, true);
    if (!src.toLowerCase().endsWith(".dxf")) throw new FileError("Not a DXF.");
    const d = processDxf((await download(src)).toString("utf8"));
    if (!d.count) throw new FileError("No drawable entities found in that DXF.");
    const path = derivedPath(src, ".json");
    await upload(path, JSON.stringify(d), "application/json");
    return { path, url: await readUrl(path), count: d.count, bounds: d.bounds, insunits: d.insunits };
  },

  "/v1/sweep": async (_c, b) => {
    try {
      return { rows: sweep(b as unknown as SweepRequest) };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  },
};

createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const path = (req.url ?? "/").split("?")[0];
  if (req.method === "GET" && (path === "/health" || path === "/healthz")) return send(res, 200, { ok: true });
  const route = routes[path];
  if (!route || req.method !== "POST") return send(res, 404, { error: "Not found." });
  try {
    const caller = await callerFromRequest(req.headers.authorization);
    send(res, 200, await route(caller, await body(req)));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : e instanceof AuthError ? 401 : e instanceof AccessError ? 403 : e instanceof FileError ? 400 : 500;
    if (status === 500) console.error(path, e);
    send(res, status, { error: status === 500 ? "Something went wrong on the server." : (e as Error).message });
  }
}).listen(PORT, () => console.log(`rackline-api listening on ${PORT}`));
