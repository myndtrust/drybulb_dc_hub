import { createBrowserClient } from "@supabase/ssr";

// Browser Supabase client. The session is stored in cookies and auto-refreshed
// client-side, so all signed-in data access (saved models) can run from the
// browser with Row-Level Security enforcing per-user ownership.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// When unset (e.g. local dev without Supabase), auth UI hides itself and the
// calculator keeps working anonymously.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function createClient() {
  return createBrowserClient(SUPABASE_URL!, SUPABASE_ANON_KEY!);
}

/** Start Google OAuth, returning to /auth/callback then back to `next`. */
export async function signInWithGoogle(next?: string) {
  const target =
    next ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`;
  await createClient().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

export async function signOut() {
  await createClient().auth.signOut();
}
