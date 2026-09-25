import "server-only";

import {
  AnswerSchema,
  AssetSchema,
  ContextRefSchema,
  FlagSchema,
  JobSchema,
  ReleaseSchema,
  ReleaseViewSchema,
  WorkshopSnapshotSchema,
  type Actor,
  type Asset,
  type Answer,
  type ContextRef,
  type Flag,
  type Id,
  type Job,
  type Release,
  type ReleaseView,
  type WorkshopSnapshot,
} from "@/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { DataAdapterError, throwDatabaseError } from "./errors";

export type QuestionReceipt = {
  questionId: Id;
  context: ContextRef;
  createdAt: string;
  answer: Answer | null;
};

export type VisitorReleaseRepositoryOptions = {
  serviceClient: SupabaseClient;
  sessionId: Id;
  releaseId: Id;
};

/**
 * Server-only repository bound to one visitor session and one granted release.
 * Each mutating RPC rechecks the session, original link and exact release grant
 * using the database clock inside the mutation transaction.
 */
export function createVisitorReleaseRepository(options: VisitorReleaseRepositoryOptions) {
  const { serviceClient, sessionId, releaseId } = options;

  return {
    async assertLive() {
      const { data, error } = await serviceClient.rpc("require_live_release_session_internal", {
        p_session_id: sessionId,
        p_release_id: releaseId,
      });
      throwDatabaseError(error, "validate visitor release scope");
      if (!data) throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");
      return data as Record<string, unknown>;
    },

    async getRelease(): Promise<Release> {
      await this.assertLive();
      const { data, error } = await serviceClient.from("releases").select("*")
        .eq("id", releaseId).maybeSingle();
      throwDatabaseError(error, "read visitor release snapshot");
      if (!data) throw new DataAdapterError("RELEASE_REVOKED", "Release access is unavailable.");
      return mapRelease(data as Record<string, unknown>);
    },

    async getWorkshopSnapshot(snapshotId: Id): Promise<WorkshopSnapshot> {
      await this.assertLive();
      const { data, error } = await serviceClient.from("workshop_versions").select("*")
        .eq("id", snapshotId).maybeSingle();
      throwDatabaseError(error, "read visitor workshop snapshot");
      if (!data) throw new DataAdapterError("NOT_FOUND", "Workshop snapshot not found.");
      const row = data as { id: Id; workspace_id: Id; workshop_id: Id; version: number; snapshot: { name: string; machines: unknown } };
      const { data: confirmation, error: confirmationError } = await serviceClient
        .from("workshop_snapshot_confirmations").select("confirmed_by,confirmed_at")
        .eq("snapshot_id", snapshotId).maybeSingle();
      throwDatabaseError(confirmationError, "read visitor workshop confirmation");
      return WorkshopSnapshotSchema.parse({
        id: row.id,
        workspaceId: row.workspace_id,
        workshopId: row.workshop_id,
        version: row.version,
        name: row.snapshot.name,
        machines: row.snapshot.machines,
        confirmedBy: confirmation?.confirmed_by ?? null,
        confirmedAt: confirmation?.confirmed_at ?? null,
      });
    },

    async listReleaseSourceAssets() {
      await this.assertLive();
      const release = await this.getRelease();
      const { data, error } = await serviceClient.from("release_assets").select("asset_id,assets(*)")
        .eq("release_id", releaseId);
      throwDatabaseError(error, "load visitor release source allow-list");
      const rows = (data ?? []) as Array<{ asset_id: Id; assets: Record<string, unknown> | Record<string, unknown>[] | null }>;
      const assets = rows.map((row) => {
        const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
        if (!asset || asset.id !== row.asset_id || asset.status !== "ready" || asset.sha256 === null || asset.release_id !== null || asset.kind === "issue_photo") {
          throw new DataAdapterError("REVIEW_REQUIRED", "Release source allow-list contains an unavailable asset.");
        }
        return mapAsset(asset);
      });
      const expectedIds = release.snapshot.sourceAssetIds;
      if (new Set(expectedIds).size !== expectedIds.length || assets.length !== expectedIds.length ||
        expectedIds.some((assetId) => !assets.some((asset) => asset.id === assetId))) {
        throw new DataAdapterError("REVIEW_REQUIRED", "Release assets do not match its immutable source list.");
      }
      return assets;
    },

    async getReleaseView(): Promise<ReleaseView> {
      const scope = await this.assertLive();
      const release = await this.getRelease();
      const { data: jobData, error: jobError } = await serviceClient.from("jobs").select("*")
        .eq("id", release.jobId).maybeSingle();
      throwDatabaseError(jobError, "read visitor release job");
      if (!jobData) throw new DataAdapterError("NOT_FOUND", "Release job not found.");
      const row = jobData as Record<string, unknown>;
      const { data: sourceRows, error: sourceError } = await serviceClient.from("job_source_assets")
        .select("asset_id").eq("job_id", release.jobId);
      throwDatabaseError(sourceError, "read visitor source asset IDs");
      const job = mapJob(row, ((sourceRows ?? []) as Array<{ asset_id: Id }>).map(({ asset_id }) => asset_id));
      const sourceAssets = await this.listReleaseSourceAssets();
      const { data: successorData, error: successorError } = await serviceClient.rpc("lookup_live_release_successor_internal", {
        p_session_id: sessionId,
        p_release_id: releaseId,
      });
      throwDatabaseError(successorError, "read visitor replacement availability");
      const successor = successorData as { releaseId?: Id; canFollow?: boolean } | null;
      const actor: Actor = {
        id: sessionId,
        displayName: String(scope.displayName ?? "Shop floor visitor"),
        kind: "release_visitor",
        roles: [],
      };
      return ReleaseViewSchema.parse({
        job,
        release,
        sourceAssets,
        replacementReleaseId: successor?.releaseId ?? null,
        canFollowReplacement: successor?.canFollow === true,
        actor,
        permissions: { canAsk: true, canFlag: true, canRespond: false },
      });
    },

    async followReplacement(input: { replacementReleaseId: Id }): Promise<ReleaseView> {
      const { data, error } = await serviceClient.rpc("follow_release_replacement_internal", {
        p_session_id: sessionId,
        p_current_release_id: releaseId,
        p_replacement_release_id: input.replacementReleaseId,
      });
      throwDatabaseError(error, "follow visitor release replacement");
      if (!data || typeof data !== "object" || (data as Record<string, unknown>).releaseId !== input.replacementReleaseId) {
        throw new DataAdapterError("RELEASE_REVOKED", "Replacement access is unavailable.");
      }
      return createVisitorReleaseRepository({ ...options, releaseId: input.replacementReleaseId }).getReleaseView();
    },

    async listFlags(): Promise<Flag[]> {
      const scope = await this.assertLive();
      const { data, error } = await serviceClient.rpc("list_release_flags_internal", {
        p_session_id: sessionId,
        p_release_id: releaseId,
      });
      throwDatabaseError(error, "list visitor release flags");
      if (!Array.isArray(data)) throw new DataAdapterError("INTERNAL_ERROR", "Flag list is unavailable.");
      // The RPC returns the canonical contract DTOs after joining current
      // responses/photos and the verified creator display name.
      void scope;
      return data.map((row) => FlagSchema.parse(row));
    },

    async askQuestion(input: { context: ContextRef; question: string; idempotencyKey: string }): Promise<QuestionReceipt> {
      const context = ContextRefSchema.parse(input.context);
      if (context.releaseId !== releaseId || context.draftId !== null) {
        throw new DataAdapterError("FORBIDDEN", "Visitor questions are bound to the granted release.");
      }
      const { data, error } = await serviceClient.rpc("ask_release_question_internal", {
        p_session_id: sessionId,
        p_release_id: releaseId,
        p_context: context,
        p_question: input.question.trim(),
        p_idempotency_key: input.idempotencyKey,
        p_payload_hash: stablePayloadHash({ context, question: input.question.trim() }),
      });
      throwDatabaseError(error, "ask visitor release question");
      return parseQuestionReceipt(data);
    },

    async persistQuestionAnswer(input: { questionId: Id; answer: Answer; modelIdentifier: string }): Promise<Answer> {
      const answer = AnswerSchema.parse(input.answer);
      if (answer.id !== input.questionId || answer.context.releaseId !== releaseId) {
        throw new DataAdapterError("FORBIDDEN", "The answer does not belong to this visitor question.");
      }
      const { data, error } = await serviceClient.rpc("complete_visitor_question_internal", {
        p_session_id: sessionId,
        p_release_id: releaseId,
        p_question_id: input.questionId,
        p_answer: answer,
          p_model_identifier: requireQuestionModelIdentifier(input.modelIdentifier),
      });
      throwDatabaseError(error, "save visitor question answer");
      return AnswerSchema.parse(data);
    },

    async createFlag(input: {
      context: ContextRef;
      question: string;
      photoAssetIds: Id[];
      idempotencyKey: string;
    }): Promise<Flag> {
      const context = ContextRefSchema.parse(input.context);
      if (context.releaseId !== releaseId || context.draftId !== null) {
        throw new DataAdapterError("FORBIDDEN", "Visitor flags are bound to the granted release.");
      }
      if (new Set(input.photoAssetIds).size !== input.photoAssetIds.length) {
        throw new DataAdapterError("VALIDATION_FAILED", "A flag cannot attach the same photo more than once.");
      }
      const payload = {
        context,
        question: input.question.trim(),
        photoAssetIds: [...input.photoAssetIds].sort(),
      };
      const { data, error } = await serviceClient.rpc("create_release_flag_internal", {
        p_session_id: sessionId,
        p_release_id: releaseId,
        p_context: context,
        p_question: payload.question,
        p_photo_asset_ids: input.photoAssetIds,
        p_idempotency_key: input.idempotencyKey,
        p_payload_hash: stablePayloadHash(payload),
      });
      throwDatabaseError(error, "create visitor release flag");
      return FlagSchema.parse(data);
    },

    async acknowledgeFlag(input: { flagId: Id; expectedVersion: number }): Promise<Flag> {
      const { data, error } = await serviceClient.rpc("acknowledge_flag_internal", {
        p_actor_kind: "release_visitor",
        p_actor_id: sessionId,
        p_release_id: releaseId,
        p_flag_id: input.flagId,
        p_expected_version: input.expectedVersion,
      });
      throwDatabaseError(error, "acknowledge visitor flag");
      return FlagSchema.parse(data);
    },

    async preparePhoto(input: { filename: string; mimeType: string; byteSize: number; idempotencyKey: string }): Promise<Asset> {
      const filename = input.filename.trim();
      const mimeType = input.mimeType.trim().toLowerCase();
      if (!filename || !["image/jpeg", "image/png", "image/webp"].includes(mimeType) || input.byteSize < 1) {
        throw new DataAdapterError("VALIDATION_FAILED", "Photo metadata is invalid.");
      }
      const { data, error } = await serviceClient.rpc("prepare_visitor_photo_internal", {
        p_session_id: sessionId,
        p_release_id: releaseId,
        p_filename: filename,
        p_mime_type: mimeType,
        p_byte_size: input.byteSize,
        p_idempotency_key: input.idempotencyKey,
        p_payload_hash: stablePayloadHash({ releaseId, filename, mimeType, byteSize: input.byteSize }),
      });
      throwDatabaseError(error, "prepare visitor release photo");
      return AssetSchema.parse(data);
    },
  };
}

function parseQuestionReceipt(value: unknown): QuestionReceipt {
  if (!value || typeof value !== "object") {
    throw new DataAdapterError("INTERNAL_ERROR", "Question write returned no receipt.");
  }
  const row = value as Record<string, unknown>;
  return {
    questionId: row.questionId as Id,
    context: ContextRefSchema.parse(row.context),
    createdAt: String(row.createdAt),
    answer: row.answer === null || row.answer === undefined ? null : AnswerSchema.parse(row.answer),
  };
}

export function requireQuestionModelIdentifier(value: string): string {
  const modelIdentifier = value.trim();
  if (!modelIdentifier || modelIdentifier.length > 200) {
    throw new DataAdapterError("VALIDATION_FAILED", "Model identifier is invalid.");
  }
  return modelIdentifier;
}

function mapRelease(row: Record<string, unknown>): Release {
  return ReleaseSchema.parse({
    id: row.id,
    jobId: row.job_id,
    revisionNumber: row.revision_number,
    snapshot: row.snapshot,
    sourceDraftVersion: row.source_draft_version,
    reviews: row.reviews,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    supersedesReleaseId: row.supersedes_release_id,
    allowPredecessorVisitors: row.allow_predecessor_visitors,
  });
}

function mapAsset(row: Record<string, unknown>) {
  return AssetSchema.parse({
    id: row.id,
    jobId: row.job_id,
    releaseId: row.release_id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    version: row.version,
    status: row.status,
    drawingRevision: row.drawing_revision,
  });
}

function mapJob(row: Record<string, unknown>, sourceAssetIds: Id[]): Job {
  return JobSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    partNumber: row.part_number,
    partFamily: row.part_family,
    version: row.version,
    workshopSnapshotId: row.workshop_snapshot_id,
    machineId: row.machine_id,
    sourceAssetIds,
    draftId: row.current_draft_id,
    latestReleaseId: row.latest_release_id,
    createdAt: row.created_at,
  });
}
