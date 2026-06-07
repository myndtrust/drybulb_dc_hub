import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CANONICAL_HOST = "www.drybulb.com";

/**
 * Proxy (Next.js 16's renamed Middleware):
 *  - Redirect non-canonical hosts (e.g. herokuapp.com) → www.drybulb.com
 *
 * Auth note: Supabase sessions are managed client-side by the browser client
 * and written by the /auth/callback Route Handler, so no Supabase logic runs
 * here. (Per Next 16's proxy docs, proxy must not be the session/authz layer.)
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  // Redirect any non-canonical host to the canonical domain (permanent 301).
  // Skip in local development.
  if (
    host &&
    host !== CANONICAL_HOST &&
    !host.startsWith("localhost") &&
    !host.startsWith("127.0.0.1")
  ) {
    const url = request.nextUrl.clone();
    url.host = CANONICAL_HOST;
    url.port = "";
    url.protocol = "https:";
    return NextResponse.redirect(url, 301);
  }

  return NextResponse.next();
}

export const config = {
  // Match all routes except static files and Next internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
