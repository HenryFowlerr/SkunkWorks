import "server-only";

import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getWorkspaceApiContext } from "@/server/api/context";
import { ApiFault } from "@/server/http/api";

/** Resolve the flag under session RLS before constructing a privileged adapter. */
export async function getFlagResponseApiContext(flagId: string) {
  const { supabase } = await getVerifiedRequestIdentity();
  const { data, error } = await supabase.from("flags")
    .select("workspace_id").eq("id", flagId).maybeSingle();
  if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Flag access could not be checked.", { retryable: true });
  if (!data?.workspace_id) throw new ApiFault("NOT_FOUND", "Flag not found.");
  return getWorkspaceApiContext(data.workspace_id, ["designer"]);
}
