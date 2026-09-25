import { loadAuthSessionView } from "@/server/auth/session-view";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { handleApiOperation } from "@/server/http/api";

export async function GET(): Promise<Response> {
  return handleApiOperation(async () => {
    const { supabase, user } = await getVerifiedRequestIdentity();
    return loadAuthSessionView(supabase, user);
  });
}
