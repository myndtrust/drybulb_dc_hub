import { createBrowserClient } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";

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

/**
 * Read the current session without ever hanging the UI.
 *
 * `auth.getSession()` does not merely reject when the backend is unreachable: if a
 * stored session has expired, the client blocks on `_recoverAndRefresh`, which
 * retries the token refresh with backoff. That promise can stay pending for a long
 * time, so a plain `.then()`/`.catch()` leaves a loading flag permanently unset and
 * the page stuck on a spinner. Racing a timeout is what bounds it.
 *
 * `unreachable` distinguishes "we could not find out" from "signed out", so callers
 * can say so rather than showing a sign-in button that cannot succeed.
 */
export async function getSessionSafe(
  timeoutMs = 4000,
): Promise<{ session: Session | null; unreachable: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      createClient()
        .auth.getSession()
        .then(({ data }) => ({ session: data.session ?? null, unreachable: false })),
      new Promise<{ session: null; unreachable: true }>((resolve) => {
        timer = setTimeout(() => resolve({ session: null, unreachable: true }), timeoutMs);
      }),
    ]);
  } catch {
    return { session: null, unreachable: true };
  } finally {
    clearTimeout(timer);
  }
}

/** Start Google OAuth, returning to /auth/callback then back to `next`. */
export async function signInWithGoogle(next?: string) {
  const target =
    next ?? (typeof window !== "undefined" ? window.location.pathname : "/");
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`;
  const supabase = createClient();
  // Drop any current session (cookies only, this browser) so a failed or partial
  // callback can never leave the previous account signed in.
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  await supabase.auth.signInWithOAuth({
    provider: "google",
    // Always show Google's account chooser; otherwise Google silently reuses the
    // browser's current Google account and switching accounts is impossible.
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
}

/**
 * Email sign-in (also signs up new people): Supabase emails a one-time code plus a
 * link. Typing the code works on any device; the link returns via /auth/callback
 * and only works in this browser (PKCE). The emails are Supabase's "Confirm signup"
 * (new people) and "Magic Link" (returning) templates; both must include
 * {{ .Token }} for the code to appear.
 */
export async function sendEmailCode(email: string, next?: string): Promise<{ error: string | null }> {
  const target = next ?? window.location.pathname;
  const supabase = createClient();
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(target)}`,
    },
  });
  return { error: error?.message ?? null };
}

/**
 * Finish email sign-in with the code from the email. Returns Supabase's reason on
 * failure (wrong / expired / superseded code) rather than throwing.
 */
export async function verifyEmailCode(email: string, code: string): Promise<{ error: string | null }> {
  const { error } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
  return { error: error?.message ?? null };
}

export async function signOut() {
  await createClient().auth.signOut();
}
