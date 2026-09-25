import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
 * Refreshes the server-verified Supabase session and carries refreshed cookies
 * onto the Next.js response. Import this from src/proxy.ts.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { url, publishableKey } = getSupabaseConfig();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser verifies the JWT with Supabase Auth; getSession alone only reads
  // the cookie and must not be used as an authorization decision.
  await supabase.auth.getUser();

  return response;
}
