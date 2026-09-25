import { z } from "zod";
import { createAiAdapter } from "@/server/ai";
import { computeInputFingerprint } from "@/server/data/fingerprint";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { createGeneration } from "@/server/api/generation";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export const runtime = "nodejs";
export const maxDuration = 60;

const GenerateBodySchema = z.object({
  expectedJobVersion: z.number().int().positive(),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  return handleApiOperation(async () => {
    const { jobId: rawJobId } = await context.params;
    const jobId = parseRouteId(rawJobId);
    const body = await parseApiBody(request, GenerateBodySchema);
    const idempotencyKey = readIdempotencyKey(request);
    const { repository, storage } = await getJobApiContext(jobId, ["designer"]);
    const generation = await createGeneration({
      jobId,
      expectedJobVersion: body.expectedJobVersion,
      idempotencyKey,
    }, {
      repository,
      storage,
      ai: createAiAdapter(),
      fingerprint: computeInputFingerprint,
    });
    if (generation.jobId !== jobId) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The generation result did not match the requested job.");
    }
    return generation;
  });
}
