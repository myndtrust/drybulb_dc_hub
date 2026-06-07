import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Supabase client, used in the /auth/callback Route Handler to exchange
// the OAuth code for a session and write the session cookies.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Thrown when called from a Server Component (read-only cookies);
            // safe to ignore — the callback Route Handler can write cookies.
          }
        },
      },
    },
  );
}
