// Private GCS bucket access. Files are stored per PROJECT, under
// projects/<project id>/<upload uuid>/, so every member of a project can see its
// drawings and nobody else can. The browser never holds GCP credentials: it gets
// short-lived V4 signed URLs, issued only after the caller's project role is
// checked in Postgres. On Cloud Run the URLs are signed through IAM signBlob as
// the service's own account (no key files).

import { randomUUID } from "node:crypto";
import { Storage } from "@google-cloud/storage";

const BUCKET = process.env.GCS_BUCKET ?? "drybulb-rackline";
const storage = new Storage();
export const bucket = storage.bucket(BUCKET);

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Accepted background types: extension → content type. */
export const UPLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  dxf: "application/dxf",
};

export class FileError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertProjectId(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new FileError("Unknown project.");
  return v;
}

/** The project a stored object belongs to: projects/<id>/<uuid>/<file>. */
export function projectOfPath(path: unknown): { path: string; projectId: string } {
  if (typeof path !== "string" || path.includes("..")) throw new FileError("Unknown file.");
  const m = path.match(/^projects\/([0-9a-f-]{36})\/[0-9a-f-]{36}\/[^/]+$/i);
  if (!m || !UUID.test(m[1])) throw new FileError("Unknown file.");
  return { path, projectId: m[1] };
}

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";

/** A signed URL the browser PUTs the file to, and the object path it lands at. */
export async function createUpload(projectId: string, name: string, size: number) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = UPLOAD_TYPES[ext];
  if (!contentType) throw new FileError("Use a PDF, PNG, JPG, WebP, SVG or DXF file.");
  if (!(size > 0) || size > MAX_UPLOAD_BYTES) throw new FileError("Files must be under 50 MB.");
  const path = `projects/${projectId}/${randomUUID()}/${safeName(name)}`;
  const [uploadUrl] = await bucket.file(path).getSignedUrl({
    version: "v4", action: "write", expires: Date.now() + 15 * 60_000, contentType,
  });
  return { path, uploadUrl, contentType };
}

export async function readUrl(path: string) {
  const [url] = await bucket.file(path).getSignedUrl({ version: "v4", action: "read", expires: Date.now() + 60 * 60_000 });
  return url;
}

export async function download(path: string): Promise<Buffer> {
  const f = bucket.file(path);
  const [meta] = await f.getMetadata();
  if (Number(meta.size) > MAX_UPLOAD_BYTES) throw new FileError("File too large.");
  const [buf] = await f.download();
  return buf;
}

export async function upload(path: string, data: Buffer | string, contentType: string) {
  await bucket.file(path).save(data, { contentType, resumable: false });
}

/** Delete one upload and everything derived from it (its <uuid> folder). */
export async function removeUpload(path: string) {
  const folder = path.split("/").slice(0, 3).join("/") + "/"; // projects/<id>/<uuid>/
  await bucket.deleteFiles({ prefix: folder, force: true });
}

/** Derived files sit next to their source in the same upload folder. */
export const derivedPath = (src: string, suffix: string) => src + suffix;
