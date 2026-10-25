// Browser client for the rackline-api Cloud Run service (services/rackline-api):
// background drawings go to the private GCS bucket through signed URLs, heavy
// processing (PDF rasterising, DXF flattening, layout sweeps) runs server-side.
// Calls carry the user's Supabase access token; the service checks the caller's
// role on the project before signing any URL. Files are stored per project, so
// every project member (and only they) can see the drawings.

import { getSessionSafe } from "@/lib/supabase/client";
import type { DxfDrawing } from "./dxf";
import type { SweepRequest, SweepRow } from "./sweep";

const API = process.env.NEXT_PUBLIC_RACKLINE_API_URL?.replace(/\/$/, "");

/** When false the tool falls back to in-browser processing and session-only drawings. */
export const isCloudConfigured = Boolean(API);

export class CloudError extends Error {}

async function call<T>(path: string, body: unknown): Promise<T> {
  if (!API) throw new CloudError("The cloud service is not configured.");
  const { session } = await getSessionSafe();
  if (!session) throw new CloudError("Sign in to store drawings and run sweeps.");
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudError((data as { error?: string }).error || `Request failed (${res.status}).`);
  return data as T;
}

/** Upload a file to the project's folder in the bucket; returns its object path. */
export async function uploadFile(file: Blob, name: string, projectId: string): Promise<string> {
  const { path, uploadUrl, contentType } = await call<{ path: string; uploadUrl: string; contentType: string }>(
    "/v1/uploads", { projectId, name, size: file.size },
  );
  const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
  if (!put.ok) throw new CloudError(`Upload failed (${put.status}).`);
  return path;
}

export const fileUrl = async (path: string) => (await call<{ url: string }>("/v1/files/url", { path })).url;

export const deleteFile = (path: string) => call<{ ok: true }>("/v1/files/delete", { path });

export const renderPdf = (path: string, page: number) =>
  call<{ path: string; url: string; w: number; h: number; renderScale: number; pages: number }>("/v1/backgrounds/pdf", { path, page });

export const processDxf = (path: string) =>
  call<{ path: string; url: string; count: number; bounds: DxfDrawing["bounds"]; insunits: number }>("/v1/backgrounds/dxf", { path });

export async function fetchDxf(path: string): Promise<DxfDrawing> {
  const res = await fetch(await fileUrl(path));
  if (!res.ok) throw new CloudError("Couldn't load the stored drawing.");
  return (await res.json()) as DxfDrawing;
}

export const runSweep = async (req: SweepRequest) => (await call<{ rows: SweepRow[] }>("/v1/sweep", req)).rows;
