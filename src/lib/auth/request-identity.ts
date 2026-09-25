import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ApiFault } from "../../server/http/api";
import { createSupabaseServerClient } from "./server";

export type VerifiedRequestIdentity = {
  supabase: SupabaseClient;
  user: User;
};

/**
 * Reads and verifies the current caller with Supabase Auth. No role or
 * permission is taken from user_metadata; callers must separately resolve
 * workspace membership and release-session scope.
 */
export async function getVerifiedRequestIdentity(): Promise<VerifiedRequestIdentity> {
  let supabase: SupabaseClient;
  try {
    supabase = await createSupabaseServerClient();
  } catch (error) {
    if (error instanceof Error && error.name === "SupabaseConfigurationError") {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The sign-in service is not configured.", {
        retryable: true,
      });
    }
    throw error;
  }

  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    result = await supabase.auth.getUser();
  } catch {
    throw new ApiFault("PROVIDER_UNAVAILABLE", "The sign-in service is temporarily unavailable.", {
      retryable: true,
    });
  }

  if (result.error) {
    const status = (result.error as { status?: unknown }).status;
    if (typeof status === "number" && (status === 0 || status >= 500)) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The sign-in service is temporarily unavailable.", {
        retryable: true,
      });
    }
    throw new ApiFault("UNAUTHENTICATED", "Sign in to continue.");
  }

  if (!result.data.user) {
    throw new ApiFault("UNAUTHENTICATED", "Sign in to continue.");
  }

  return { supabase, user: result.data.user };
}
