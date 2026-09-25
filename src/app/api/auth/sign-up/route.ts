import { SignUpInputSchema, SignUpResultSchema } from "@/contracts";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";
import { createSupabaseServerClient } from "@/lib/auth/server";

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, SignUpInputSchema);
    const supabase = await createSupabaseServerClient();
    const callback = new URL("/auth/callback?next=/studio", request.url).toString();
    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: callback,
        ...(input.displayName ? { data: { display_name: input.displayName } } : {}),
      },
    });

    if (error) {
      throw new ApiFault("VALIDATION_FAILED", "The account could not be created. Check the details and try again.");
    }
    return SignUpResultSchema.parse({ verificationRequired: data.session === null });
  });
}
