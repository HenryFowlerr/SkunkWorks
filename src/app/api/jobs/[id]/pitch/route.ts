import { PitchRequestBodySchema, type Asset } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { createPitchAiAdapter } from "@/server/ai";
import { buildPitchCapabilityInput, preparePitchPacket } from "@/server/ai/pitch-input";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { ApiFault, handleApiOperation, parseApiBody } from "@/server/http/api";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Creates a non-persistent, engineer-review-only pitch result. It accepts a
 * hash-checked drawing PDF and confirmed supplier profile without treating an
 * opaque native SLDPRT/SLDDRW file as readable drawing evidence.
 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const jobId = parseRouteId((await context.params).id);
    const body = await parseApiBody(request, PitchRequestBodySchema);
    const { repository } = await getJobApiContext(jobId, ["designer"]);
    const { bundle, workshop } = await repository.getGenerationContext(jobId);

    if (bundle.job.version !== body.expectedJobVersion) {
      throw new ApiFault("VERSION_CONFLICT", "Job inputs changed. Reload the job before preparing the pitch analysis.");
    }

    const storage = createSupabaseServiceClient();
    const packet = await preparePitchPacket({
      job: bundle.job,
      assets: bundle.assets,
      workshop,
      readSource: async (asset: Asset) => {
        const authorized = await repository.authorizeMemberAsset(jobId, asset.id);
        if (
          authorized.asset.kind !== asset.kind ||
          authorized.asset.sha256 !== asset.sha256 ||
          authorized.asset.byteSize !== asset.byteSize
        ) {
          throw new ApiFault("VERSION_CONFLICT", "A selected source changed while preparing the pitch analysis.");
        }
        const { data, error } = await storage.storage
          .from(authorized.bucketId)
          .download(authorized.objectKey, {}, { cache: "no-store" });
        if (error || !data) {
          throw new ApiFault("UNSUPPORTED_ASSET", "A selected source could not be read from private storage.");
        }
        return new Uint8Array(await data.arrayBuffer());
      },
    });

    const capabilityInput = buildPitchCapabilityInput(packet);
    const adapter = createPitchAiAdapter();

    if (body.action === "triage") {
      // Pitch drafts are deliberately not persisted. The triage packet is
      // rebuilt from trusted sources and treats any prior KB as unavailable,
      // rather than accepting browser-provided guidance as evidence.
      const triage = await adapter.triageIssue({
        partName: capabilityInput.partName,
        partNumber: capabilityInput.partNumber,
        issue: body.issue,
        // The engineer report can cite the same trusted, confirmed supplier
        // profile as the capability draft. Browser-supplied guidance remains
        // excluded from this non-persistent path.
        sources: [...capabilityInput.sources, ...capabilityInput.supplier.sources],
        knowledgeBase: null,
      });
      return { action: body.action, triage };
    }

    const capability = await adapter.assessCapability(capabilityInput);

    if (body.action === "capability") {
      return { action: body.action, capability };
    }

    // A knowledge-base draft follows only a non-blocking capability result.
    // It is never published or attached to a QR label from this endpoint.
    if (capability.decision !== "clear_for_engineer_review") {
      return { action: body.action, capability, knowledgeBase: null };
    }

    const knowledgeBase = await adapter.createKnowledgeBase({
      ...capabilityInput,
      capability,
    });
    return { action: body.action, capability, knowledgeBase };
  });
}
