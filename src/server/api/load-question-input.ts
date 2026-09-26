import "server-only";
import type { AskQuestionInput } from "@/contracts";
import type { WorkspaceDataRepository } from "@/server/data/repository";
import { assembleReleaseQuestionInput } from "./question-context";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { ApiFault } from "@/server/http/api";

export async function loadQuestionInput(repository: WorkspaceDataRepository, input: AskQuestionInput) {
  if (!input.context.releaseId) throw new ApiFault("REVIEW_REQUIRED", "Choose approved part guidance first.");
    const release = await repository.getRelease(input.context.releaseId);
    if (release.jobId !== input.context.jobId) throw new ApiFault("NOT_FOUND", "Release not found for this job.");
    const bundle = await repository.getJobBundle(release.jobId);
    const workshop = await repository.getWorkshopSnapshot(release.snapshot.workshopSnapshotId);
    const flags = await repository.listFlags({ releaseId: release.id });
    const storage = createSupabaseServiceClient();
    return assembleReleaseQuestionInput({
      request: input,
      release,
      assets: bundle.assets,
      flags,
      workshop,
      readSource: async (asset) => {
        const authorized = await repository.authorizeMemberAsset(release.jobId, asset.id);
        if (authorized.asset.sha256 !== asset.sha256 || authorized.asset.byteSize !== asset.byteSize ||
            authorized.asset.kind !== asset.kind || authorized.asset.status !== "ready") {
          throw new ApiFault("VERSION_CONFLICT", "A release source changed while preparing the answer.");
        }
        const { data, error } = await storage.storage.from(authorized.bucketId)
          .download(authorized.objectKey, {}, { cache: "no-store" });
        if (error || !data) throw new ApiFault("REVIEW_REQUIRED", "A private release source could not be read.");
        return new Uint8Array(await data.arrayBuffer());
      },
    });
}
