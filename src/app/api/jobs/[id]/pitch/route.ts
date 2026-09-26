import { PitchRequestBodySchema, type Asset } from "@/contracts";
import { getJobApiContext, parseRouteId } from "@/server/api/context";
import { createPitchAiAdapter } from "@/server/ai";
import {
  assertPitchRequestQuotaAvailable,
  cachePitchCapability,
  consumePitchRequestQuota,
  getCachedPitchCapability,
  getCachedPitchKnowledgeBase,
  getOrCreatePitchKnowledgeBase,
} from "@/server/ai/pitch-guardrails";
import { buildPitchCapabilityInput, preparePitchPacket } from "@/server/ai/pitch-input";
import { createPitchMobilePreviewAdapter } from "@/server/ai/pitch-mobile-preview";
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
    const { repository, actor } = await getJobApiContext(jobId, ["designer"]);
    const { bundle, workshop, inputFingerprint } = await repository.getGenerationContext(jobId);

    if (bundle.job.version !== body.expectedJobVersion) {
      throw new ApiFault("VERSION_CONFLICT", "Job inputs changed. Reload the job before preparing the pitch analysis.");
    }

    const cacheKey = {
      actorId: actor.id,
      jobId,
      jobVersion: bundle.job.version,
      inputFingerprint,
    };

    // This is an engineer-only simulation of the phone chat. It receives only
    // the exact short-lived, server-held draft that Astra just created; it does
    // not read a browser-provided knowledge base, create a release, or expose a
    // QR destination. The actual floor question route stays release-bound.
    if (body.action === "preview_question") {
      if (!getCachedPitchCapability(cacheKey)) {
        throw new ApiFault(
          "REVIEW_REQUIRED",
          "Run the supplier capability check again before using the phone preview. The local pitch result has expired or this server restarted.",
        );
      }
      const pendingKnowledgeBase = getCachedPitchKnowledgeBase(cacheKey);
      if (!pendingKnowledgeBase) {
        throw new ApiFault(
          "REVIEW_REQUIRED",
          "Create the knowledge-base draft again before using the phone preview. The local draft has expired or this server restarted.",
        );
      }
      assertPitchRequestQuotaAvailable({ actorId: actor.id, jobId, action: body.action });
      const knowledgeBase = await pendingKnowledgeBase;
      consumePitchRequestQuota({ actorId: actor.id, jobId, action: body.action });
      const answer = await createPitchMobilePreviewAdapter().answerDraftQuestion({
        partName: bundle.job.title,
        partNumber: bundle.job.partNumber,
        question: body.preview.question,
        knowledgeBase,
      });
      return { action: body.action, answer };
    }

    // A browser cannot supply an earlier assessment. Fail before any private
    // source reads when the server-held prerequisite has expired or restarted.
    if (body.action === "knowledge_base" && !getCachedPitchCapability(cacheKey)) {
      throw new ApiFault(
        "REVIEW_REQUIRED",
        "Run the supplier capability check again before creating the knowledge-base draft. The local pitch result has expired or this server restarted.",
      );
    }

    // Reject a full bucket before downloading private files, extracting PDFs,
    // or rasterizing an STL. The actual reservation remains immediately before
    // the provider call so an invalid packet does not consume the allowance.
    assertPitchRequestQuotaAvailable({ actorId: actor.id, jobId, action: body.action });

    const storage = createSupabaseServiceClient();
    const packet = await preparePitchPacket({
      job: bundle.job,
      assets: bundle.assets,
      workshop,
      includeStlVisual: body.action === "capability",
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
      // The quota is consumed only after the request is authenticated,
      // version-checked and its source packet is usable, but before its one
      // provider call. Its identity cannot be supplied by the browser.
      consumePitchRequestQuota({ actorId: actor.id, jobId, action: body.action });
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

    if (body.action === "capability") {
      consumePitchRequestQuota({ actorId: actor.id, jobId, action: body.action });
      const capability = await adapter.assessCapability(capabilityInput);
      cachePitchCapability(cacheKey, capability);
      return { action: body.action, capability };
    }

    // Re-read after validating the current packet so a cache expiry or a fresh
    // capability result cannot be silently reused after the preflight check.
    const capability = getCachedPitchCapability(cacheKey);
    if (!capability) {
      throw new ApiFault(
        "REVIEW_REQUIRED",
        "Run the supplier capability check again before creating the knowledge-base draft. The local pitch result has expired or this server restarted.",
      );
    }

    // A knowledge-base draft follows only a non-blocking capability result. It
    // is never published or attached to a QR label from this endpoint.
    if (capability.decision !== "clear_for_engineer_review") {
      return { action: body.action, capability, knowledgeBase: null };
    }

    const knowledgeBase = await getOrCreatePitchKnowledgeBase(cacheKey, async () => {
      consumePitchRequestQuota({ actorId: actor.id, jobId, action: body.action });
      return adapter.createKnowledgeBase({
        partName: capabilityInput.partName,
        partNumber: capabilityInput.partNumber,
        sources: capabilityInput.sources,
        supplier: capabilityInput.supplier,
        capability,
      });
    });
    return { action: body.action, capability, knowledgeBase };
  });
}
