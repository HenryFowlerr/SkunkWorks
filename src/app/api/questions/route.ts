import { AnswerSchema, AskQuestionInputSchema } from "@/contracts";
import { getJobApiContext } from "@/server/api/context";
import { assembleReleaseQuestionInput } from "@/server/api/question-context";
import { createAiAdapter } from "@/server/ai";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

/** Member-only until a separately scoped QR visitor exchange is implemented. */
export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, AskQuestionInputSchema);
    if (input.question.length > 2_000) {
      throw new ApiFault("VALIDATION_FAILED", "Keep the question under 2,000 characters.");
    }
    if (input.context.releaseId === null) {
      throw new ApiFault("REVIEW_REQUIRED", "Questions require a published release, not a draft.");
    }
    const { repository } = await getJobApiContext(input.context.jobId);
    const release = await repository.getRelease(input.context.releaseId);
    if (release.jobId !== input.context.jobId) throw new ApiFault("NOT_FOUND", "Release not found for this job.");
    const bundle = await repository.getJobBundle(release.jobId);
    const workshop = await repository.getWorkshopSnapshot(release.snapshot.workshopSnapshotId);
    const storage = createSupabaseServiceClient();
    const aiInput = await assembleReleaseQuestionInput({
      request: input,
      release,
      assets: bundle.assets,
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
    const { model: _model, ...answer } = await createAiAdapter().answerQuestion(aiInput);
    void _model;
    return AnswerSchema.parse(answer);
  });
}
