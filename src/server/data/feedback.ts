import "server-only";

import { FlagSchema, AnswerSchema, type Answer, type Flag } from "@/contracts";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/server/auth/service-client";
import { throwDatabaseError } from "./errors";

export async function createReleaseFlag(input: {
  flagId: string;
  releaseId: string;
  actorId: string | null;
  sessionHash: string | null;
  stepId: string | null;
  bendId: string | null;
  question: string;
  photoAssetIds: string[];
  idempotencyKey: string;
  payloadHash: string;
}): Promise<Flag> {
  const { data, error } = await createSupabaseServiceClient().rpc("create_release_flag_internal", {
    p_flag_id: input.flagId,
    p_release_id: input.releaseId,
    p_actor_id: input.actorId,
    p_session_hash: input.sessionHash,
    p_step_id: input.stepId,
    p_bend_id: input.bendId,
    p_question: input.question,
    p_photo_asset_ids: input.photoAssetIds,
    p_idempotency_key: input.idempotencyKey,
    p_payload_hash: input.payloadHash,
  });
  throwDatabaseError(error, "create release flag");
  return FlagSchema.parse(data);
}

export async function respondToReleaseFlag(input: {
  flagId: string;
  actorId: string;
  expectedVersion: number;
  text: string;
  kind: "explanation" | "replacement_release";
  replacementReleaseId: string | null;
}): Promise<Flag> {
  const { data, error } = await createSupabaseServiceClient().rpc("respond_release_flag_internal", {
    p_flag_id: input.flagId,
    p_actor_id: input.actorId,
    p_expected_version: input.expectedVersion,
    p_text: input.text,
    p_kind: input.kind,
    p_replacement_release_id: input.replacementReleaseId,
  });
  throwDatabaseError(error, "respond to release flag");
  return FlagSchema.parse(data);
}

export async function recordReleaseQuestion(input: {
  answer: Answer;
  question: string;
  actorId: string | null;
  sessionHash: string | null;
}): Promise<Answer> {
  const { data, error } = await createSupabaseServiceClient().rpc("record_release_question_internal", {
    p_question_id: input.answer.id,
    p_release_id: input.answer.context.releaseId,
    p_actor_id: input.actorId,
    p_session_hash: input.sessionHash,
    p_step_id: input.answer.context.stepId,
    p_bend_id: input.answer.context.bendId,
    p_question: input.question,
    p_answer: input.answer,
  });
  throwDatabaseError(error, "record release question");
  return AnswerSchema.parse(data);
}

export async function listVisitorReleaseFlags(input: {
  releaseId: string;
  sessionHash: string;
}): Promise<Flag[]> {
  const { data, error } = await createSupabaseServiceClient().rpc("list_visitor_release_flags_internal", {
    p_release_id: input.releaseId,
    p_session_hash: input.sessionHash,
  });
  throwDatabaseError(error, "list visitor release flags");
  return z.array(FlagSchema).parse(data);
}
