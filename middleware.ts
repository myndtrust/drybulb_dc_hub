import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const CANONICAL_HOST = "www.drybulb.com";

/**
 * Middleware:
 *  1. Redirect non-canonical hosts (e.g. herokuapp.com) → www.drybulb.com
 *  2. Auth stub (Phase 2)
 */
export function middleware(request: NextRequest) {
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

  // TODO (Phase 2): protect all (app) routes once auth is wired
  // const isAppRoute = request.nextUrl.pathname.startsWith("/dashboard");
  // const session = await getSession(request);
  // if (isAppRoute && !session) {
  //   return NextResponse.redirect(new URL("/login", request.url));
  // }

  return NextResponse.next();
}

export const config = {
  // Match all routes except static files and Next internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
