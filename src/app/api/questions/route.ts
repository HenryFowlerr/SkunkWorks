import {
  AnswerSchema,
  AskQuestionInputSchema,
  ContextRefSchema,
  type Answer,
  type ContextRef,
  type DraftContent,
  type Id,
  type WorkshopSnapshot,
} from "@/contracts";
import { getJobApiContext } from "@/server/api/context";
import { loadTrustedPdfEvidence } from "@/server/api/generation";
import { createAiAdapter } from "@/server/ai";
import type { QuestionInput } from "@/server/ai/types";
import { readVisitorSessionToken } from "@/server/access/visitor-cookie";
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from "@/server/auth/service-client";
import { createPrivateStorageAdapter } from "@/server/data/storage";
import type { AuthorizedPrivateAsset, WorkspaceDataRepository } from "@/server/data/repository";
import { resolveVisitorReleaseScope } from "@/server/data/tokens";
import { createVisitorReleaseRepository, type QuestionReceipt } from "@/server/data/visitor";
import { validateContext, type ContextResource } from "@/server/domain/contexts";
import { ApiFault, handleApiOperation, parseApiBody, readIdempotencyKey } from "@/server/http/api";

export const runtime = "nodejs";

type QuestionPersistence = {
  ask(context: ContextRef, question: string, idempotencyKey: string): Promise<QuestionReceipt>;
  persist(questionId: Id, answer: Answer, modelIdentifier: string): Promise<Answer>;
  getWorkshopSnapshot(snapshotId: Id): Promise<WorkshopSnapshot>;
};

export async function POST(request: Request): Promise<Response> {
  return handleApiOperation(async () => {
    const input = await parseApiBody(request, AskQuestionInputSchema.omit({ idempotencyKey: true }));
    const idempotencyKey = readIdempotencyKey(request);
    const requestedContext = ContextRefSchema.parse(input.context);
    const visitorToken = readVisitorSessionToken(request);
    const config = getSupabasePrivilegedConfig();
    const serviceClient = createSupabaseServiceClient(config);
    const storage = createPrivateStorageAdapter({
      serviceClient,
      publishableKey: config.publishableKey,
      supabaseUrl: config.url,
    });

    let canonical: ContextRef;
    let resource: ContextResource;
    let content: DraftContent;
    let sourceAssets: AuthorizedPrivateAsset[];
    let persistence: QuestionPersistence;

    if (visitorToken) {
      const releaseId = requestedContext.releaseId;
      if (!releaseId || requestedContext.draftId !== null) {
        throw new ApiFault("FORBIDDEN", "Visitors can ask questions only about their granted release.");
      }
      const scope = await resolveVisitorReleaseScope({ serviceClient, sessionToken: visitorToken, releaseId });
      if (scope.jobId !== requestedContext.jobId) throw new ApiFault("NOT_FOUND", "Release access is unavailable.");
      const visitorRepository = createVisitorReleaseRepository({
        serviceClient,
        sessionId: scope.sessionId,
        releaseId: scope.releaseId,
      });
      const release = await visitorRepository.getRelease();
      resource = { kind: "release", release };
      canonical = validateContext(requestedContext, resource, "floor");
      content = release.snapshot;
      const listedAssets = await visitorRepository.listReleaseSourceAssets();
      assertExactAssetSet(content.sourceAssetIds, listedAssets.map(({ id }) => id));
      sourceAssets = await Promise.all(listedAssets.map(({ id }) => storage.authorizeVisitorAsset({
        sessionToken: visitorToken,
        releaseId,
        assetId: id,
      })));
      persistence = {
        ask: (context, question, idempotencyKey) =>
          visitorRepository.askQuestion({ context, question, idempotencyKey }),
        persist: (questionId, answer, modelIdentifier) =>
          visitorRepository.persistQuestionAnswer({ questionId, answer, modelIdentifier }),
        getWorkshopSnapshot: (snapshotId) => visitorRepository.getWorkshopSnapshot(snapshotId),
      };
    } else {
      const { repository } = await getJobApiContext(requestedContext.jobId);
      const memberContext = await loadCanonicalMemberContext(requestedContext, repository);
      canonical = memberContext.canonical;
      resource = memberContext.resource;
      content = resource.kind === "draft" ? resource.draft.content : resource.release.snapshot;

      if (resource.kind === "draft") {
        sourceAssets = await repository.listJobSourceAssets(canonical.jobId);
      } else {
        const listedAssets = await repository.listReleaseSourceAssets(canonical.releaseId!);
        sourceAssets = await Promise.all(listedAssets.map(({ id }) =>
          repository.authorizeMemberAsset(canonical.jobId, id)));
      }
      assertExactAssetSet(content.sourceAssetIds, sourceAssets.map(({ asset }) => asset.id));
      persistence = memberQuestionPersistence(repository);
    }

    if (sourceAssets.some(({ asset }) =>
      asset.jobId !== canonical.jobId || asset.releaseId !== null || asset.kind === "issue_photo" || asset.status !== "ready")) {
      throw new ApiFault("REVIEW_REQUIRED", "The selected context has an invalid or unavailable source set.");
    }

    // Save or retrieve the idempotent question before extracting evidence. A
    // retry of a completed question can return its saved answer immediately.
    const receipt = await persistence.ask(canonical, input.question, idempotencyKey);
    if (JSON.stringify(receipt.context) !== JSON.stringify(canonical)) {
      throw new ApiFault("VERSION_CONFLICT", "The selected context changed while the question was being saved.");
    }
    if (receipt.answer) {
      const savedAnswer = AnswerSchema.parse(receipt.answer);
      if (savedAnswer.id !== receipt.questionId || JSON.stringify(savedAnswer.context) !== JSON.stringify(receipt.context)) {
        throw new ApiFault("VERSION_CONFLICT", "The saved answer does not match its question context.");
      }
      return savedAnswer;
    }

    let workshopSnapshot: WorkshopSnapshot | null = null;
    const sources: QuestionInput["sources"] = [];
    if (content.workshopSnapshotId) {
      workshopSnapshot = await persistence.getWorkshopSnapshot(content.workshopSnapshotId);
      const machine = content.machineId
        ? workshopSnapshot.machines.find(({ id }) => id === content.machineId)
        : undefined;
      if (content.machineId && !machine) {
        throw new ApiFault("REVIEW_REQUIRED", "The selected machine is not part of the saved workshop snapshot.");
      }
      if (machine) {
        sources.push(...machine.notes
          .filter((note) => note.confirmedBy !== null)
          .map((note) => ({
            kind: "workshop_note" as const,
            snapshotId: workshopSnapshot!.id,
            machineId: machine.id,
            noteId: note.id,
            text: note.text,
          })));
      }
    }

    const pdfs = await loadTrustedPdfEvidence(sourceAssets, storage);
    sources.push(...pdfs.flatMap((pdf) => pdf.pages.map((page) => ({
      kind: "document" as const,
      assetId: pdf.assetId,
      page: page.page,
      text: page.text,
    }))));

    // An AI or evidence-loading failure leaves the question unanswered and
    // retryable with the same key; no placeholder Answer is returned.
    const questionInput: QuestionInput = {
      context: receipt.context,
      question: input.question,
      pdfs,
      sources,
      workshopSnapshot,
      knownBendIds: content.bends.map(({ bendId }) => bendId),
      knownStepTargets: content.steps.map(({ id, bendId }) => ({ id, bendId })),
    };
    const generated = await createAiAdapter().answerQuestion(questionInput);
    const modelIdentifier = generated.model.trim();
    if (!modelIdentifier) {
      throw new ApiFault("PROVIDER_UNAVAILABLE", "The AI provider returned no model identifier.");
    }
    const answer = AnswerSchema.parse({
      id: receipt.questionId,
      context: receipt.context,
      evidenceState: generated.evidenceState,
      text: generated.text,
      evidence: generated.evidence,
      suggestedFlag: generated.suggestedFlag,
    });
    return persistence.persist(receipt.questionId, answer, modelIdentifier);
  });
}

async function loadCanonicalMemberContext(
  requested: ContextRef,
  repository: WorkspaceDataRepository,
): Promise<{ canonical: ContextRef; resource: ContextResource }> {
  if (requested.releaseId) {
    const release = await repository.getRelease(requested.releaseId);
    return {
      canonical: validateContext(requested, { kind: "release", release }, "floor"),
      resource: { kind: "release", release },
    };
  }

  const draft = await repository.getDraft(requested.jobId);
  if (!draft) throw new ApiFault("NOT_FOUND", "Draft not found.");
  return {
    canonical: validateContext(requested, { kind: "draft", draft }, "studio"),
    resource: { kind: "draft", draft },
  };
}

function memberQuestionPersistence(repository: WorkspaceDataRepository): QuestionPersistence {
  return {
    ask: (context, question, idempotencyKey) => repository.askQuestion({ context, question, idempotencyKey }),
    persist: (questionId, answer, modelIdentifier) =>
      repository.persistQuestionAnswer({ questionId, answer, modelIdentifier }),
    getWorkshopSnapshot: (snapshotId) => repository.getWorkshopSnapshot(snapshotId),
  };
}

function assertExactAssetSet(expected: Id[], actual: string[]): void {
  if (new Set(expected).size !== expected.length || new Set(actual).size !== actual.length ||
    expected.length !== actual.length || expected.some((id) => !actual.includes(id))) {
    throw new ApiFault("VERSION_CONFLICT", "The selected context source set changed; reload before asking.");
  }
}
