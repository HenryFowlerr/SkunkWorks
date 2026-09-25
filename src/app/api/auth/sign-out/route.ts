import { ApiFault, handleApiOperation } from "@/server/http/api";
import { assertSameOrigin } from "@/server/http/request-security";
import { createSupabaseServerClient } from "@/lib/auth/server";

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "Sign out could not reach the authentication service.", {
        retryable: true,
      });
    }
    return { signedOut: true as const };
  });
}
