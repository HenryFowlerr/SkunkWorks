import "server-only";

import { createHash, randomUUID } from "node:crypto";
import {
  AnswerSchema, type Answer, type Asset, type ContextRef,
} from "@/contracts";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import type { FeedbackScope } from "@/server/data/feedback-access";
import { throwDatabaseError } from "@/server/data/errors";
import { validateContext } from "@/server/domain/contexts";
import { ApiFault } from "@/server/http/api";
import { createAiAdapter, extractPdfEvidence, MAX_PDF_BYTES } from ".";
import type { GroundingSource, PdfEvidenceFile } from "./types";

/** Answer only from the immutable release's verified drawing PDFs. */
export async function answerReleaseQuestion(
  scope: FeedbackScope,
  context: ContextRef,
  question: string,
): Promise<Answer> {
  validateContext(context, { kind: "release", release: scope.release }, "floor");
  if (!process.env.OPENAI_API_KEY?.trim() || !process.env.OPENAI_MODEL?.trim()) {
    return deferredAnswer(context, "AI question answering is not configured. Flag this operation for an engineer.");
  }
  const drawings = scope.sourceAssets.filter((asset) => asset.kind === "drawing_pdf");
  if (!drawings.length || drawings.reduce((sum, asset) => sum + asset.byteSize, 0) > MAX_PDF_BYTES) {
    return deferredAnswer(context, "The released drawings cannot be checked automatically. Flag this operation for an engineer.");
  }

  const service = createSupabaseServiceClient();
  const pdfs: PdfEvidenceFile[] = [];
  for (const asset of drawings) {
    const bytes = await readCheckedReleaseDrawing(scope, asset, service);
    pdfs.push(await extractPdfEvidence({ assetId: asset.id, filename: asset.filename, bytes }));
  }
  const sources: GroundingSource[] = pdfs.flatMap((pdf) => pdf.pages
    .filter((page) => page.text.trim())
    .map((page) => ({ kind: "document" as const, assetId: pdf.assetId, page: page.page, text: page.text })));
  if (!sources.length) {
    return deferredAnswer(context, "The released drawing text is unreadable. Flag this operation for an engineer.", "unreadable");
  }
  const result = await createAiAdapter().answerQuestion({
    context,
    question,
    pdfs,
    sources,
    workshopSnapshot: null,
    knownBendIds: scope.release.snapshot.bends.map((bend) => bend.bendId),
    knownStepTargets: scope.release.snapshot.steps.map((step) => ({ id: step.id, bendId: step.bendId })),
  });
  return AnswerSchema.parse(result);
}

function deferredAnswer(
  context: ContextRef,
  text: string,
  evidenceState: "not_found" | "unreadable" = "not_found",
): Answer {
  return AnswerSchema.parse({
    id: randomUUID(), context, evidenceState, text,
    evidence: [], suggestedFlag: "Ask an engineer to clarify this operation.",
  });
}

async function readCheckedReleaseDrawing(
  scope: FeedbackScope,
  asset: Asset,
  service: ReturnType<typeof createSupabaseServiceClient>,
): Promise<Uint8Array> {
  if (asset.status !== "ready" || !asset.sha256 || asset.releaseId !== null) {
    throw new ApiFault("UNSUPPORTED_ASSET", "A release drawing is not verified.");
  }
  const { data, error } = await service.from("assets")
    .select("storage_key,sha256,byte_size,kind,status")
    .eq("id", asset.id)
    .eq("workspace_id", scope.job.workspaceId)
    .eq("job_id", scope.job.id)
    .eq("status", "ready")
    .maybeSingle();
  throwDatabaseError(error, "read release drawing location");
  if (!data || data.kind !== "drawing_pdf" || data.sha256 !== asset.sha256 || data.byte_size !== asset.byteSize) {
    throw new ApiFault("VERSION_CONFLICT", "A released drawing changed after publication.");
  }
  const { data: blob, error: storageError } = await service.storage.from("skunkworks-private")
    .download(data.storage_key, {}, { cache: "no-store" });
  if (storageError || !blob) throw new ApiFault("UNSUPPORTED_ASSET", "A released drawing could not be read.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== asset.byteSize || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
    throw new ApiFault("VERSION_CONFLICT", "A released drawing failed its verified hash check.");
  }
  return bytes;
}
