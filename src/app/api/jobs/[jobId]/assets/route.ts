import { UploadAssetPreparationBodySchema } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const body = await parseApiBody(request, UploadAssetPreparationBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository, sessionClient, storage } = await getJobApiContext(jobId, ["designer"]);
    const asset = await repository.prepareMemberSourceAsset({ jobId, ...body, idempotencyKey });
    const upload = await storage.prepareMemberSourceUpload({
      sessionClient,
      workspaceId: repository.workspaceId,
      jobId,
      assetId: asset.id,
    });
    return { assetId: asset.id, upload };
  }, { status: 201 });
}
