import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const DEFAULT_NEXT = "/dashboard/tools/pue-calculator";

/**
 * Only allow same-origin relative paths as the post-login destination, so the
 * `next` param can't be turned into an open redirect (e.g. `@evil.com`,
 * `//evil.com`, `https://evil.com`, `/\evil.com`).
 */
function safeNext(value: string | null): string {
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith("/")) return DEFAULT_NEXT; // must be a relative path
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_NEXT; // protocol-relative
  if (value.includes(":") || value.includes("@") || value.includes("\\")) return DEFAULT_NEXT;
  return value;
}

// OAuth callback: exchange the authorization code for a session (sets cookies),
// then return the user to wherever they started (`next`).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Respect the proxy host behind Heroku so we don't redirect to the dyno URL.
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      const base = isLocal || !forwardedHost ? origin : `https://${forwardedHost}`;
      return NextResponse.redirect(`${base}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}${next}?auth_error=1`);
}
