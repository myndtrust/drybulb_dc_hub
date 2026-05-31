import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth middleware stub.
 *
 * TODO (Phase 2): Replace this stub with a real auth check.
 * Recommended options:
 *   - Auth.js (NextAuth v5): full ownership, any provider
 *   - Clerk: fastest setup, great DX
 *   - Supabase: auth + Postgres + storage in one
 *
 * Pattern: check session/JWT, redirect to /login if missing,
 * pass through otherwise.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // TODO: protect all (app) routes once auth is wired
  // const isAppRoute = pathname.startsWith("/dashboard");
  // const session = await getSession(request); // your auth provider
  // if (isAppRoute && !session) {
  //   return NextResponse.redirect(new URL("/login", request.url));
  // }

  void pathname; // suppress unused variable warning until auth is wired

  return NextResponse.next();
}

export const config = {
  // Match all routes except static files and Next internals
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public/).*)"],
};
