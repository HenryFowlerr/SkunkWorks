import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiFault } from "../http/api";

export type SupabasePrivilegedConfig = {
  url: string;
  publishableKey: string;
  serviceRoleKey: string;
};

/** Read only in server code. The service key must never enter a client bundle. */
export function getSupabasePrivilegedConfig(
  environment: Record<string, string | undefined> = process.env,
): SupabasePrivilegedConfig {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !publishableKey || !serviceRoleKey) {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "The database service is not configured.", {
      retryable: true,
    });
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new TypeError("Supabase URL must use HTTPS outside localhost.");
    }
  } catch {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "The database service URL is invalid.", {
      retryable: false,
    });
  }

  return { url, publishableKey, serviceRoleKey };
}

export function createSupabaseServiceClient(
  config = getSupabasePrivilegedConfig(),
): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { "x-client-info": "skunkworks-server" },
    },
  });
}
