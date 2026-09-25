import { SignInInputSchema } from "@/contracts";
import { loadAuthSessionView } from "@/server/auth/session-view";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";
import { createSupabaseServerClient } from "@/lib/auth/server";

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, SignInInputSchema);
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error || !data.user) {
      throw new ApiFault("UNAUTHENTICATED", "Email or password is incorrect.");
    }

    const { data: verified, error: verifyError } = await supabase.auth.getUser();
    if (verifyError || !verified.user) {
      throw new ApiFault("UNAUTHENTICATED", "Sign in could not be verified.");
    }

    return loadAuthSessionView(supabase, verified.user);
  });
}
