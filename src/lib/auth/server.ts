import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export class SupabaseConfigurationError extends Error {
  constructor() {
    super("Supabase server credentials are not configured.");
    this.name = "SupabaseConfigurationError";
  }
}

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey) {
    throw new SupabaseConfigurationError();
  }

  return { url, publishableKey };
}

/**
 * Creates an SSR client with the signed-in user's cookie session.
 * Authorization must still be checked in each server operation; a session
 * alone never grants workspace or release access.
 */
export async function createSupabaseServerClient() {
  const { url, publishableKey } = getSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes them
          // before protected routes render; route handlers can set them here.
        }
      },
    },
  });
}
