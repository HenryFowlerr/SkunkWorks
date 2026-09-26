import "server-only";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  ActorSchema, AssetSchema, JobSchema, ReleaseSchema,
  type Actor, type Asset, type Job, type Release,
} from "@/contracts";
import { getVerifiedRequestIdentity } from "@/lib/auth/request-identity";
import { getJobApiContext } from "@/server/api/context";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { throwDatabaseError } from "@/server/data/errors";
import { ApiFault } from "@/server/http/api";

// This matches the QR exchange cookie. The SQL write RPC rechecks it under
// lock; this read is for preparing a response, never the final permission gate.
const VISITOR_COOKIE = "chappe_visitor_session";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type FeedbackScope = {
  actor: Actor;
  job: Job;
  release: Release;
  sourceAssets: Asset[];
  /** Exactly one actor credential is sent to the atomic write RPC. */
  actorId: string | null;
  sessionHash: string | null;
};

export async function resolveReleaseFeedbackScope(releaseId: string): Promise<FeedbackScope> {
  try {
    const { supabase } = await getVerifiedRequestIdentity();
    const { data, error } = await supabase.from("releases").select("job_id").eq("id", releaseId).maybeSingle();
    if (error) throw new ApiFault("PROVIDER_UNAVAILABLE", "Release access could not be checked.", { retryable: true });
    if (data?.job_id) {
      const { repository, actor } = await getJobApiContext(data.job_id);
      const bundle = await repository.getJobBundle(data.job_id);
      const release = bundle.releases.find((item) => item.id === releaseId);
      if (!release) throw new ApiFault("NOT_FOUND", "Release not found.");
      const sourceAssets = release.snapshot.sourceAssetIds.map((id) => bundle.assets.find((asset) => asset.id === id));
      if (sourceAssets.some((asset) => !asset)) throw new ApiFault("INTERNAL_ERROR", "Release sources are incomplete.");
      return { actor, job: bundle.job, release, sourceAssets: sourceAssets as Asset[], actorId: actor.id, sessionHash: null };
    }
  } catch (cause) {
    if (!(cause instanceof ApiFault) || !["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(cause.code)) throw cause;
  }

  const token = (await cookies()).get(VISITOR_COOKIE)?.value;
  if (!token || !TOKEN_PATTERN.test(token)) {
    throw new ApiFault("UNAUTHENTICATED", "Open the authorized QR link for this release.");
  }
  const sessionHash = createHash("sha256").update(token).digest("hex");
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc("read_release_visitor_scope_internal", {
    p_release_id: releaseId,
    p_session_hash: sessionHash,
  });
  throwDatabaseError(error, "read feedback visitor scope");
  const scope = z.object({
    sessionId: z.uuid(),
    displayName: z.string().min(1),
    job: JobSchema,
    release: ReleaseSchema,
    sourceAssets: z.array(AssetSchema),
  }).parse(data);
  const actor = ActorSchema.parse({
    id: scope.sessionId, displayName: scope.displayName,
    kind: "release_visitor", roles: [],
  });
  return {
    actor, job: scope.job, release: scope.release,
    sourceAssets: scope.sourceAssets,
    actorId: null, sessionHash,
  };
}
