import "server-only";

import {
  AnswerSchema,
  AssetSchema,
  ContextRefSchema,
  ConfirmWorkshopInputSchema,
  CreateJobInputSchema,
  CreateWorkshopInputSchema,
  DraftContentInputSchema,
  DraftContentSchema,
  DraftSchema,
  DecideProposalInputSchema,
  FlagSchema,
  GenerationSchema,
  GetJobResultSchema,
  JobSchema,
  MachineSchema,
  ReleaseSchema,
  ReleaseViewSchema,
  RecordClarificationInputSchema,
  ResolveFindingInputSchema,
  ReviewDraftInputSchema,
  RespondToFlagInputSchema,
  RoleSchema,
  SaveWorkshopVersionInputSchema,
  WorkshopSnapshotSchema,
  type Answer,
  type Actor,
  type Asset,
  type ContextRef,
  type Draft,
  type DraftContentInput,
  type Flag,
  type Generation,
  type Id,
  type Job,
  type Machine,
  type Release,
  type ReleaseView,
  type Role,
  type WorkshopSnapshot,
} from "@/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeInputFingerprint } from "./fingerprint";
import { DataAdapterError, throwDatabaseError } from "./errors";
import { stablePayloadHash } from "@/server/domain/idempotency";
import { deriveIdempotentBearerToken, hashBearerToken } from "./tokens";
import { requireQuestionModelIdentifier, type QuestionReceipt } from "./visitor";

type MemberRow = { role: Role; status: "active" | "revoked" };
type JobRow = {
  id: Id;
  workspace_id: Id;
  title: string;
  part_number: string;
  part_family: string;
  version: number;
  workshop_snapshot_id: Id | null;
  machine_id: Id | null;
  current_draft_id: Id | null;
  latest_release_id: Id | null;
  created_at: string;
};
type AssetRow = {
  id: Id;
  job_id: Id;
  release_id: Id | null;
  kind: Asset["kind"];
  filename: string;
  mime_type: string;
  byte_size: number;
  sha256: string | null;
  version: number;
  status: Asset["status"];
  drawing_revision: string | null;
  workspace_id: Id;
  storage_key: string;
  uploaded_by_user_id: Id | null;
  uploaded_by_visitor_session_id: Id | null;
};
type DraftRow = {
  id: Id;
  job_id: Id;
  workspace_id: Id;
  version: number;
  content: unknown;
  generation_id: Id | null;
  input_fingerprint: string;
};
type ReleaseRow = {
  id: Id;
  job_id: Id;
  revision_number: number;
  snapshot: unknown;
  source_draft_version: number;
  reviews: unknown;
  published_at: string;
  published_by: Id;
  supersedes_release_id: Id | null;
  allow_predecessor_visitors: boolean;
};
type ReviewRow = {
  kind: "design" | "process";
  actor_id: Id;
  draft_version: number;
  reviewed_at: string;
};
type WorkshopVersionRow = {
  id: Id;
  workshop_id: Id;
  workspace_id: Id;
  version: number;
  snapshot: { name?: unknown; machines?: unknown };
};
type FlagRow = {
  id: Id;
  workspace_id: Id;
  job_id: Id;
  release_id: Id;
  step_id: Id | null;
  bend_id: string | null;
  question: string;
  created_by_kind: "member" | "release_visitor";
  created_by_user_id: Id | null;
  created_by_session_id: Id | null;
  created_by_display_name: string;
  version: number;
  status: "open" | "responded" | "resolved";
  created_at: string;
};
type GenerationRow = {
  id: Id;
  job_id: Id;
  input_fingerprint: string;
  state: Generation["state"];
  started_at: string;
  expires_at: string;
  draft_version: number | null;
  error_code: string | null;
};

export type StartGenerationResult =
  | { state: "started"; generation: Generation; claimToken: Id; baseDraftVersion: number | null; jobVersion: number }
  | { state: "running"; retryAfterSeconds: number }
  | { state: "completed"; generation: Generation; draft: Draft }
  | { state: "failed"; generation: Generation; errorCode: string };

export type GetJobResult = {
  job: Job;
  assets: Asset[];
  draft: Draft | null;
  releases: Release[];
};

export type AuthorizedPrivateAsset = {
  readonly bucketId: "skunkworks-private";
  readonly objectKey: string;
  readonly asset: Asset;
};

export type RepositoryOptions = {
  /** Cookie/session-bound Supabase client, never a service key. */
  sessionClient: SupabaseClient;
  /** Server-only service client. Must not be imported by browser code. */
  serviceClient: SupabaseClient;
  /** Stable server-only HMAC key used to recover idempotent bearer URLs. */
  tokenPepper: string;
  workspaceId: Id;
  requiredRoles?: Role[];
};

type WorkspaceScope = {
  actorId: Id;
  workspaceId: Id;
  role: Role;
};

export async function createWorkspaceDataRepository(
  options: RepositoryOptions,
): Promise<WorkspaceDataRepository> {
  const { data: authData, error: authError } = await options.sessionClient.auth.getUser();
  if (authError || !authData.user) {
    throw new DataAdapterError("UNAUTHENTICATED", "A verified session is required.", {
      cause: authError ?? undefined,
    });
  }

  const { data: rawMember, error: membershipError } = await options.sessionClient
    .from("workspace_members")
    .select("role,status")
    .eq("workspace_id", options.workspaceId)
    .eq("user_id", authData.user.id)
    .maybeSingle();

  throwDatabaseError(membershipError, "read workspace membership");
  const member = rawMember as MemberRow | null;
  if (!member || member.status !== "active") {
    throw new DataAdapterError("FORBIDDEN", "Active workspace membership is required.");
  }

  const role = RoleSchema.parse(member.role);
  const required = options.requiredRoles ?? [];
  if (role !== "admin" && required.length > 0 && !required.includes(role)) {
    throw new DataAdapterError("FORBIDDEN", "This workspace role cannot perform the requested action.");
  }

  return new WorkspaceDataRepository(
    options.serviceClient,
    { actorId: authData.user.id, workspaceId: options.workspaceId, role },
    options.tokenPepper,
  );
}

/**
 * Workspace-scoped adapter. Construct it only from createWorkspaceDataRepository
 * after auth.getUser() and an RLS-scoped membership lookup. Service-client
 * queries always retain an explicit workspace predicate as defense in depth.
 */
export class WorkspaceDataRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly scope: WorkspaceScope,
    private readonly tokenPepper: string,
  ) {}

  get actorId() {
    return this.scope.actorId;
  }

  get workspaceId() {
    return this.scope.workspaceId;
  }

  get role() {
    return this.scope.role;
  }

  requireRole(...allowed: Role[]) {
    if (this.scope.role !== "admin" && !allowed.includes(this.scope.role)) {
      throw new DataAdapterError("FORBIDDEN", "This workspace role cannot perform the requested action.");
    }
  }

  async getJobBundle(jobId: Id): Promise<GetJobResult> {
    const { data, error } = await this.client
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("workspace_id", this.scope.workspaceId)
      .maybeSingle();
    throwDatabaseError(error, "read job");
    const row = data as JobRow | null;
    if (!row) throw new DataAdapterError("NOT_FOUND", "Job not found.");

    const [sourceIds, assets, draft, releases] = await Promise.all([
      this.listSourceAssetIds(row.id),
      this.listAssets(row.id),
      row.current_draft_id ? this.getDraftById(row.id, row.current_draft_id) : Promise.resolve(null),
      this.listReleases(row.id),
    ]);

    const job = this.mapJob(row, sourceIds);
    return GetJobResultSchema.parse({ job, assets, draft, releases });
  }

  async getWorkshopSnapshot(snapshotId: Id): Promise<WorkshopSnapshot> {
    const { data, error } = await this.client
      .from("workshop_versions")
      .select("*")
      .eq("id", snapshotId)
      .eq("workspace_id", this.scope.workspaceId)
      .maybeSingle();
    throwDatabaseError(error, "read workshop snapshot");
    const row = data as WorkshopVersionRow | null;
    if (!row) throw new DataAdapterError("NOT_FOUND", "Workshop snapshot not found.");

    const { data: confirmationRow, error: confirmationError } = await this.client
      .from("workshop_snapshot_confirmations")
      .select("confirmed_by,confirmed_at")
      .eq("snapshot_id", row.id)
      .eq("workspace_id", row.workspace_id)
      .maybeSingle();
    throwDatabaseError(confirmationError, "read workshop confirmation");

    return WorkshopSnapshotSchema.parse({
      id: row.id,
      workshopId: row.workshop_id,
      workspaceId: row.workspace_id,
      version: row.version,
      name: row.snapshot.name,
      machines: row.snapshot.machines,
      confirmedBy: confirmationRow?.confirmed_by ?? null,
      confirmedAt: confirmationRow?.confirmed_at ?? null,
    });
  }

  async getWorkshop(workshopId: Id): Promise<WorkshopSnapshot> {
    const { data, error } = await this.client.from("workshops")
      .select("id,current_version")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("id", workshopId)
      .maybeSingle();
    throwDatabaseError(error, "read workshop profile");
    const row = data as { id: Id; current_version: number } | null;
    if (!row) throw new DataAdapterError("NOT_FOUND", "Workshop not found.");
    const { data: version, error: versionError } = await this.client.from("workshop_versions")
      .select("id")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("workshop_id", row.id)
      .eq("version", row.current_version)
      .maybeSingle();
    throwDatabaseError(versionError, "read current workshop snapshot");
    if (!version?.id) throw new DataAdapterError("INTERNAL_ERROR", "Workshop profile is missing its current snapshot.");
    return this.getWorkshopSnapshot(version.id as Id);
  }

  async listWorkshops(): Promise<WorkshopSnapshot[]> {
    const { data, error } = await this.client
      .from("workshops")
      .select("id,current_version")
      .eq("workspace_id", this.scope.workspaceId)
      .order("name", { ascending: true });
    throwDatabaseError(error, "list workshops");
    const workshops = (data ?? []) as Array<{ id: Id; current_version: number }>;
    return Promise.all(workshops.map(async (workshop) => {
      const { data: version, error: versionError } = await this.client
        .from("workshop_versions")
        .select("id")
        .eq("workspace_id", this.scope.workspaceId)
        .eq("workshop_id", workshop.id)
        .eq("version", workshop.current_version)
        .maybeSingle();
      throwDatabaseError(versionError, "read current workshop profile");
      if (!version?.id) throw new DataAdapterError("INTERNAL_ERROR", "Workshop profile is missing its current version.");
      return this.getWorkshopSnapshot(version.id as Id);
    }));
  }

  async createWorkshop(input: { name: string; idempotencyKey: string }): Promise<WorkshopSnapshot> {
    const parsed = CreateWorkshopInputSchema.parse({ workspaceId: this.scope.workspaceId, ...input });
    this.requireRole("fabricator");
    const name = parsed.name;
    const { data, error } = await this.client.rpc("create_workshop_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_name: name,
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash({ workspaceId: this.scope.workspaceId, name }),
    });
    throwDatabaseError(error, "create workshop");
    return WorkshopSnapshotSchema.parse(data);
  }

  async saveWorkshopVersion(input: {
    workshopId: Id;
    expectedVersion: number;
    name: string;
    machines: Machine[];
    idempotencyKey: string;
  }): Promise<WorkshopSnapshot> {
    const parsedInput = SaveWorkshopVersionInputSchema.parse({ workspaceId: this.scope.workspaceId, ...input });
    this.requireRole("fabricator");
    const parsedMachines = parsedInput.machines.map((machine) => MachineSchema.parse(machine));
    const payload = {
      workshopId: parsedInput.workshopId,
      expectedVersion: parsedInput.expectedVersion,
      name: parsedInput.name,
      machines: parsedMachines,
    };
    const { data, error } = await this.client.rpc("save_workshop_version_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_workshop_id: parsedInput.workshopId,
      p_expected_version: parsedInput.expectedVersion,
      p_name: payload.name,
      p_machines: parsedMachines,
      p_idempotency_key: parsedInput.idempotencyKey,
      p_payload_hash: stablePayloadHash(payload),
    });
    throwDatabaseError(error, "save workshop version");
    return WorkshopSnapshotSchema.parse(data);
  }

  async confirmWorkshop(input: { workshopId: Id; snapshotId: Id }): Promise<WorkshopSnapshot> {
    const parsed = ConfirmWorkshopInputSchema.parse(input);
    this.requireRole("fabricator");
    const { data, error } = await this.client.rpc("confirm_workshop_snapshot_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_workshop_id: parsed.workshopId,
      p_snapshot_id: parsed.snapshotId,
    });
    throwDatabaseError(error, "confirm workshop snapshot");
    const result = data as { snapshotId?: Id } | null;
    if (!result?.snapshotId) throw new DataAdapterError("INTERNAL_ERROR", "Workshop confirmation returned no snapshot.");
    return this.getWorkshopSnapshot(result.snapshotId);
  }

  async listJobs(): Promise<Job[]> {
    const { data, error } = await this.client
      .from("jobs")
      .select("*")
      .eq("workspace_id", this.scope.workspaceId)
      .order("created_at", { ascending: false });
    throwDatabaseError(error, "list jobs");
    const rows = (data ?? []) as JobRow[];
    return Promise.all(rows.map(async (row) => this.mapJob(row, await this.listSourceAssetIds(row.id))));
  }

  async createJob(input: {
    title: string;
    partNumber: string;
    partFamily: string;
    workshopSnapshotId: Id | null;
    machineId: Id | null;
    idempotencyKey: string;
  }): Promise<Job> {
    const parsed = CreateJobInputSchema.parse({ workspaceId: this.scope.workspaceId, ...input });
    this.requireRole("designer");
    const payload = {
      workspaceId: this.scope.workspaceId,
      title: parsed.title,
      partNumber: parsed.partNumber,
      partFamily: parsed.partFamily,
      workshopSnapshotId: parsed.workshopSnapshotId,
      machineId: parsed.machineId,
    };
    const { data, error } = await this.client.rpc("create_job_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_title: payload.title,
      p_part_number: payload.partNumber,
      p_part_family: payload.partFamily,
      p_workshop_snapshot_id: payload.workshopSnapshotId,
      p_machine_id: payload.machineId,
      p_idempotency_key: parsed.idempotencyKey,
      p_payload_hash: stablePayloadHash(payload),
    });
    throwDatabaseError(error, "create job");
    const result = data as { job?: unknown } | null;
    return JobSchema.parse(result?.job ?? data);
  }

  async getDraft(jobId: Id): Promise<Draft | null> {
    const job = await this.getJobRow(jobId);
    return job.current_draft_id
      ? this.getDraftById(job.id, job.current_draft_id)
      : null;
  }

  async getRelease(releaseId: Id): Promise<Release> {
    const { data, error } = await this.client
      .from("releases")
      .select("*")
      .eq("id", releaseId)
      .eq("workspace_id", this.scope.workspaceId)
      .maybeSingle();
    throwDatabaseError(error, "read release");
    if (!data) throw new DataAdapterError("NOT_FOUND", "Release not found.");
    return this.mapRelease(data as ReleaseRow);
  }

  async getReleaseView(releaseId: Id): Promise<ReleaseView> {
    const release = await this.getRelease(releaseId);
    const job = await this.getJobRow(release.jobId);
    const sourceAssets = await this.listReleaseSourceAssets(releaseId);
    const [successorResult, actorResult] = await Promise.all([
      this.client.from("releases").select("id,allow_predecessor_visitors")
        .eq("workspace_id", this.scope.workspaceId).eq("job_id", release.jobId)
        .eq("supersedes_release_id", releaseId).maybeSingle(),
      this.client.from("user_profiles").select("display_name").eq("user_id", this.scope.actorId).maybeSingle(),
    ]);
    throwDatabaseError(successorResult.error, "read release successor");
    throwDatabaseError(actorResult.error, "read member display name");
    const actor: Actor = {
      id: this.scope.actorId,
      displayName: (actorResult.data as { display_name?: string } | null)?.display_name?.trim() || "Workspace member",
      kind: "member",
      roles: [this.scope.role],
    };
    return ReleaseViewSchema.parse({
      job: this.mapJob(job, await this.listSourceAssetIds(job.id)),
      release,
      sourceAssets,
      replacementReleaseId: successorResult.data?.id ?? null,
      canFollowReplacement: false,
      actor,
      permissions: { canAsk: true, canFlag: true, canRespond: this.scope.role === "admin" || this.scope.role === "designer" },
    });
  }

  async listReleaseSourceAssets(releaseId: Id): Promise<Asset[]> {
    const release = await this.getRelease(releaseId);
    const expectedIds = release.snapshot.sourceAssetIds;
    const { data, error } = await this.client.from("release_assets")
      .select("asset_id,assets(*)")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("job_id", release.jobId)
      .eq("release_id", releaseId);
    throwDatabaseError(error, "load immutable release source allow-list");
    const rows = (data ?? []) as Array<{ asset_id: Id; assets: AssetRow | AssetRow[] | null }>;
    const assets = rows.map((row) => {
      const asset = Array.isArray(row.assets) ? row.assets[0] : row.assets;
      if (!asset || row.asset_id !== asset.id || asset.status !== "ready" || asset.sha256 === null) {
        throw new DataAdapterError("REVIEW_REQUIRED", "Release source allow-list contains an unavailable asset.");
      }
      return this.mapAsset(asset);
    });
    if (new Set(expectedIds).size !== expectedIds.length || assets.length !== expectedIds.length ||
      expectedIds.some((id) => !assets.some((asset) => asset.id === id))) {
      throw new DataAdapterError("REVIEW_REQUIRED", "Release assets do not match its immutable source list.");
    }
    return assets;
  }

  async listFlags(input: { jobId?: Id; releaseId?: Id }): Promise<Flag[]> {
    if ((input.jobId === undefined) === (input.releaseId === undefined)) {
      throw new DataAdapterError("VALIDATION_FAILED", "Provide exactly one job or release ID.");
    }

    let query = this.client
      .from("flags")
      .select("*")
      .eq("workspace_id", this.scope.workspaceId)
      .order("created_at", { ascending: false });
    query = input.jobId ? query.eq("job_id", input.jobId) : query.eq("release_id", input.releaseId!);

    const { data, error } = await query;
    throwDatabaseError(error, "list flags");
    const rows = (data ?? []) as FlagRow[];
    if (rows.length === 0) return [];

    const flagIds = rows.map(({ id }) => id);
    const [photoResult, responseResult, membershipResult] = await Promise.all([
      this.client.from("flag_photo_assets").select("flag_id,asset_id").in("flag_id", flagIds),
      this.client.from("flag_responses").select("*").in("flag_id", flagIds).order("flag_version", { ascending: false }),
      this.client.from("workspace_members").select("user_id,role").eq("workspace_id", this.scope.workspaceId).eq("status", "active"),
    ]);
    throwDatabaseError(photoResult.error, "read flag photos");
    throwDatabaseError(responseResult.error, "read flag responses");
    throwDatabaseError(membershipResult.error, "read flag actor roles");
    const memberIds = ((membershipResult.data ?? []) as Array<{ user_id: Id }>).map(({ user_id }) => user_id);
    const { data: profileData, error: profileError } = memberIds.length
      ? await this.client.from("user_profiles").select("user_id,display_name").in("user_id", memberIds)
      : { data: [], error: null };
    throwDatabaseError(profileError, "read workspace flag actor names");

    const photoRows = (photoResult.data ?? []) as Array<{ flag_id: Id; asset_id: Id }>;
    const responseRows = (responseResult.data ?? []) as Array<{
      flag_id: Id;
      text: string;
      author_id: Id;
      kind: "explanation" | "replacement_release";
      replacement_release_id: Id | null;
      created_at: string;
    }>;
    const roleByUser = new Map(
      ((membershipResult.data ?? []) as Array<{ user_id: Id; role: Role }>).map((member) => [
        member.user_id,
        RoleSchema.parse(member.role),
      ]),
    );
    const nameByUser = new Map(
      ((profileData ?? []) as Array<{ user_id: Id; display_name: string }>).map((profile) => [
        profile.user_id,
        profile.display_name,
      ]),
    );
    const photosByFlag = new Map<Id, Id[]>();
    for (const photo of photoRows) {
      photosByFlag.set(photo.flag_id, [...(photosByFlag.get(photo.flag_id) ?? []), photo.asset_id]);
    }
    const latestResponseByFlag = new Map<Id, (typeof responseRows)[number]>();
    for (const response of responseRows) {
      if (!latestResponseByFlag.has(response.flag_id)) latestResponseByFlag.set(response.flag_id, response);
    }

    return rows.map((row) => {
      const actorId = row.created_by_kind === "member"
        ? row.created_by_user_id
        : row.created_by_session_id;
      if (!actorId) throw new DataAdapterError("INTERNAL_ERROR", "Flag actor record is incomplete.");

      const actorRole = row.created_by_user_id ? roleByUser.get(row.created_by_user_id) : undefined;
      const response = latestResponseByFlag.get(row.id);
      return FlagSchema.parse({
        id: row.id,
        context: {
          jobId: row.job_id,
          releaseId: row.release_id,
          draftId: null,
          draftVersion: null,
          stepId: row.step_id,
          bendId: row.bend_id,
        },
        question: row.question,
        photoAssetIds: photosByFlag.get(row.id) ?? [],
        createdBy: {
          id: actorId,
          displayName: row.created_by_kind === "release_visitor"
            ? row.created_by_display_name
            : nameByUser.get(actorId) ?? "Member",
          kind: row.created_by_kind,
          roles: actorRole ? [actorRole] : [],
        },
        version: row.version,
        status: row.status,
        createdAt: row.created_at,
        response: response
          ? {
              text: response.text,
              authorId: response.author_id,
              at: response.created_at,
              kind: response.kind,
              replacementReleaseId: response.replacement_release_id,
            }
          : null,
      });
    });
  }

  async createFlag(input: {
    context: ContextRef;
    question: string;
    photoAssetIds: Id[];
    idempotencyKey: string;
  }): Promise<Flag> {
    const context = ContextRefSchema.parse(input.context);
    if (!context.releaseId || context.draftId !== null) {
      throw new DataAdapterError("VALIDATION_FAILED", "Flags are bound to a published release.");
    }
    const payload = {
      context,
      question: input.question.trim(),
      photoAssetIds: [...input.photoAssetIds].sort(),
    };
    const { data, error } = await this.client.rpc("create_member_release_flag_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_release_id: context.releaseId,
      p_context: context,
      p_question: payload.question,
      p_photo_asset_ids: input.photoAssetIds,
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash(payload),
    });
    throwDatabaseError(error, "create member release flag");
    return FlagSchema.parse(data);
  }

  async respondToFlag(input: {
    flagId: Id;
    expectedVersion: number;
    text: string;
    kind: "explanation" | "replacement_release";
    replacementReleaseId: Id | null;
  }): Promise<Flag> {
    this.requireRole("designer");
    const parsed = RespondToFlagInputSchema.parse(input);
    const { data, error } = await this.client.rpc("respond_to_flag_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_flag_id: parsed.flagId,
      p_expected_version: parsed.expectedVersion,
      p_text: parsed.text,
      p_kind: parsed.kind,
      p_replacement_release_id: parsed.replacementReleaseId,
    });
    throwDatabaseError(error, "respond to release flag");
    return FlagSchema.parse(data);
  }

  async askQuestion(input: { context: ContextRef; question: string; idempotencyKey: string }): Promise<QuestionReceipt> {
    const context = ContextRefSchema.parse(input.context);
    const { data, error } = await this.client.rpc("ask_member_question_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_context: context,
      p_question: input.question.trim(),
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash({ context, question: input.question.trim() }),
    });
    throwDatabaseError(error, "ask member contextual question");
    return parseQuestionReceipt(data);
  }

  async persistQuestionAnswer(input: { questionId: Id; answer: Answer; modelIdentifier: string }): Promise<Answer> {
    const answer = AnswerSchema.parse(input.answer);
    if (answer.id !== input.questionId) {
      throw new DataAdapterError("VALIDATION_FAILED", "Answer ID must match its persisted question ID.");
    }
    const { data, error } = await this.client.rpc("complete_member_question_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_question_id: input.questionId,
      p_answer: answer,
      p_model_identifier: requireQuestionModelIdentifier(input.modelIdentifier),
    });
    throwDatabaseError(error, "save member question answer");
    return AnswerSchema.parse(data);
  }

  async createInvite(input: {
    role: Exclude<Role, "admin">;
    idempotencyKey: string;
  }): Promise<{ inviteId: Id; workspaceId: Id; role: Exclude<Role, "admin">; createdAt: string; expiresAt: string; token: string }> {
    this.requireRole("admin");
    const token = deriveIdempotentBearerToken(
      this.tokenPepper,
      "workspace-invite",
      `${this.scope.workspaceId}:${input.role}:${this.scope.actorId}`,
      input.idempotencyKey,
    );
    const payload = { workspaceId: this.scope.workspaceId, role: input.role };
    const { data, error } = await this.client.rpc("create_workspace_invite_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_role: input.role,
      p_token_hash: hashBearerToken(token),
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash(payload),
    });
    throwDatabaseError(error, "create workspace invite");
    const row = data as Record<string, unknown>;
    return {
      inviteId: row.inviteId as Id,
      workspaceId: this.scope.workspaceId,
      role: input.role,
      createdAt: String(row.createdAt),
      expiresAt: String(row.expiresAt),
      token,
    };
  }

  async createShareLink(input: {
    releaseId: Id;
    idempotencyKey: string;
  }): Promise<{ linkId: Id; releaseId: Id; token: string }> {
    this.requireRole("designer");
    const token = deriveIdempotentBearerToken(
      this.tokenPepper,
      "release-access-link",
      `${this.scope.workspaceId}:${input.releaseId}:${this.scope.actorId}`,
      input.idempotencyKey,
    );
    const { data, error } = await this.client.rpc("create_release_access_link_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_release_id: input.releaseId,
      p_token_hash: hashBearerToken(token),
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash({ releaseId: input.releaseId }),
    });
    throwDatabaseError(error, "create release access link");
    const row = data as Record<string, unknown>;
    return { linkId: row.linkId as Id, releaseId: input.releaseId, token };
  }

  async revokeShareLink(input: { releaseId: Id; linkId: Id }): Promise<{ linkId: Id; revokedAt: string }> {
    this.requireRole("designer");
    const { data, error } = await this.client.rpc("revoke_release_access_link_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_release_id: input.releaseId,
      p_link_id: input.linkId,
    });
    throwDatabaseError(error, "revoke release access link");
    const row = data as Record<string, unknown>;
    return { linkId: row.linkId as Id, revokedAt: String(row.revokedAt) };
  }

  async prepareMemberSourceAsset(input: {
    jobId: Id;
    kind: "drawing_pdf" | "model_glb" | "bend_manifest";
    filename: string;
    mimeType: string;
    byteSize: number;
    drawingRevision?: string | null;
    idempotencyKey: string;
  }): Promise<Asset> {
    this.requireRole("designer");
    const { data, error } = await this.client.rpc("prepare_member_source_asset_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_job_id: input.jobId,
      p_kind: input.kind,
      p_filename: input.filename.trim(),
      p_mime_type: input.mimeType.trim().toLowerCase(),
      p_byte_size: input.byteSize,
      p_drawing_revision: input.drawingRevision ?? null,
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash({
        jobId: input.jobId,
        kind: input.kind,
        filename: input.filename.trim(),
        mimeType: input.mimeType.trim().toLowerCase(),
        byteSize: input.byteSize,
        drawingRevision: input.drawingRevision ?? null,
      }),
    });
    throwDatabaseError(error, "prepare source asset");
    return this.mapAsset(data as AssetRow);
  }

  async getAsset(jobId: Id, assetId: Id): Promise<Asset> {
    const { data, error } = await this.client
      .from("assets")
      .select("*")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("job_id", jobId)
      .eq("id", assetId)
      .maybeSingle();
    throwDatabaseError(error, "get workspace asset");
    if (!data) throw new DataAdapterError("NOT_FOUND", "Asset not found.");
    return this.mapAsset(data as AssetRow);
  }

  async listJobSourceAssets(jobId: Id): Promise<AuthorizedPrivateAsset[]> {
    const { data: sourceData, error: sourceError } = await this.client
      .from("job_source_assets")
      .select("asset_id")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("job_id", jobId);
    throwDatabaseError(sourceError, "list selected job source asset IDs");
    const sourceIds = ((sourceData ?? []) as Array<{ asset_id: Id }>).map(({ asset_id }) => asset_id);
    if (!sourceIds.length) return [];
    const { data, error } = await this.client
      .from("assets")
      .select("*")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("job_id", jobId)
      .eq("status", "ready")
      .in("id", sourceIds);
    throwDatabaseError(error, "load selected source assets");
    const rows = (data ?? []) as AssetRow[];
    if (rows.length !== sourceIds.length || rows.some((row) => row.kind === "issue_photo" || !row.sha256)) {
      throw new DataAdapterError("REVIEW_REQUIRED", "Selected source assets are not all verified and ready.");
    }
    return rows.map((row) => ({ bucketId: "skunkworks-private", objectKey: row.storage_key, asset: this.mapAsset(row) }));
  }

  async recordDraftReview(input: { jobId: Id; expectedVersion: number; kind: "design" | "process" }): Promise<Draft> {
    const parsed = ReviewDraftInputSchema.parse(input);
    const requiredRole = parsed.kind === "design" ? "designer" : "fabricator";
    this.requireRole(requiredRole);
    const { data, error } = await this.client.rpc("review_draft_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: parsed.jobId,
      p_actor_id: this.scope.actorId,
      p_expected_version: parsed.expectedVersion,
      p_kind: parsed.kind,
    });
    throwDatabaseError(error, "review draft");
    const result = data as { draftId?: Id } | null;
    if (!result?.draftId) throw new DataAdapterError("INTERNAL_ERROR", "Draft review returned no draft.");
    const draft = await this.getDraft(parsed.jobId);
    if (!draft || draft.id !== result.draftId || draft.version !== parsed.expectedVersion) {
      throw new DataAdapterError("VERSION_CONFLICT", "Draft changed while saving the review.");
    }
    return draft;
  }

  async createDraftFromRelease(input: {
    jobId: Id;
    releaseId: Id;
    expectedJobVersion: number;
    expectedDraftVersion: number | null;
    idempotencyKey: string;
  }): Promise<Draft> {
    this.requireRole("designer");
    const payload = { jobId: input.jobId, releaseId: input.releaseId,
      expectedJobVersion: input.expectedJobVersion, expectedDraftVersion: input.expectedDraftVersion };
    const { data, error } = await this.client.rpc("create_draft_from_release_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: input.jobId,
      p_release_id: input.releaseId,
      p_actor_id: this.scope.actorId,
      p_expected_job_version: input.expectedJobVersion,
      p_expected_draft_version: input.expectedDraftVersion,
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash(payload),
    });
    throwDatabaseError(error, "create draft from release");
    return DraftSchema.parse(data);
  }

  async recordClarification(input: { jobId: Id; text: string; idempotencyKey: string }): Promise<{ recordId: Id; evidence: { kind: "human_clarification"; recordId: Id } }> {
    this.requireRole("designer");
    const parsed = RecordClarificationInputSchema.parse(input);
    const { data, error } = await this.client.rpc("record_draft_clarification_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: parsed.jobId,
      p_actor_id: this.scope.actorId,
      p_text: parsed.text,
      p_idempotency_key: parsed.idempotencyKey,
      p_payload_hash: stablePayloadHash({ jobId: parsed.jobId, text: parsed.text }),
    });
    throwDatabaseError(error, "record draft clarification");
    const row = data as { recordId?: Id } | null;
    if (!row?.recordId) throw new DataAdapterError("INTERNAL_ERROR", "Clarification record returned no ID.");
    return { recordId: row.recordId, evidence: { kind: "human_clarification", recordId: row.recordId } };
  }

  async resolveFinding(input: { jobId: Id; findingId: Id; expectedVersion: number; recordId: Id }): Promise<Draft> {
    this.requireRole("designer");
    const parsed = ResolveFindingInputSchema.parse(input);
    const { data, error } = await this.client.rpc("resolve_draft_finding_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: parsed.jobId,
      p_actor_id: this.scope.actorId,
      p_finding_id: parsed.findingId,
      p_expected_version: parsed.expectedVersion,
      p_record_id: parsed.recordId,
    });
    throwDatabaseError(error, "resolve draft finding");
    return DraftSchema.parse(data);
  }

  async decideMachineProposal(input: { jobId: Id; proposalId: Id; expectedVersion: number; decision: "accept" | "reject" }): Promise<Draft> {
    this.requireRole("fabricator");
    const parsed = DecideProposalInputSchema.parse(input);
    const { data, error } = await this.client.rpc("decide_machine_proposal_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: parsed.jobId,
      p_actor_id: this.scope.actorId,
      p_proposal_id: parsed.proposalId,
      p_expected_version: parsed.expectedVersion,
      p_decision: parsed.decision,
    });
    throwDatabaseError(error, "decide machine proposal");
    return DraftSchema.parse(data);
  }

  async startGeneration(input: {
    jobId: Id;
    expectedJobVersion: number;
    idempotencyKey: string;
  }): Promise<StartGenerationResult> {
    this.requireRole("designer");
    const { data, error } = await this.client.rpc("start_generation_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: input.jobId,
      p_actor_id: this.scope.actorId,
      p_expected_job_version: input.expectedJobVersion,
      p_idempotency_key: input.idempotencyKey,
      p_payload_hash: stablePayloadHash({ jobId: input.jobId, expectedJobVersion: input.expectedJobVersion }),
    });
    throwDatabaseError(error, "start generation");
    if (!data || typeof data !== "object") throw new DataAdapterError("INTERNAL_ERROR", "Generation start returned no result.");
    const result = data as Record<string, unknown>;
    if (result.state === "running") {
      return { state: "running", retryAfterSeconds: Number(result.retryAfterSeconds ?? 1) };
    }
    if (result.state === "completed") {
      return {
        state: "completed",
        generation: GenerationSchema.parse(result.generation),
        draft: DraftSchema.parse(result.draft),
      };
    }
    if (result.state === "failed") {
      return {
        state: "failed",
        generation: GenerationSchema.parse(result.generation),
        errorCode: String(result.errorCode),
      };
    }
    if (result.state !== "started" || !result.claimToken) {
      throw new DataAdapterError("INTERNAL_ERROR", "Generation start returned an unknown state.");
    }
    return {
      state: "started",
      generation: GenerationSchema.parse(result.generation),
      claimToken: result.claimToken as Id,
      baseDraftVersion: result.baseDraftVersion === null ? null : Number(result.baseDraftVersion),
      jobVersion: Number(result.jobVersion),
    };
  }

  async getGeneration(generationId: Id): Promise<Generation | null> {
    const { data, error } = await this.client
      .from("generations")
      .select("*")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("id", generationId)
      .maybeSingle();
    throwDatabaseError(error, "get generation");
    return data ? mapGeneration(data as GenerationRow) : null;
  }

  async listGenerationSourceAssets(generationId: Id): Promise<AuthorizedPrivateAsset[]> {
    const generation = await this.getGeneration(generationId);
    if (!generation || generation.state !== "running") {
      throw new DataAdapterError("NOT_FOUND", "Active generation not found.");
    }
    return this.listJobSourceAssets(generation.jobId);
  }

  async getGenerationResult(generationId: Id): Promise<{ generation: Generation; draft: Draft | null } | null> {
    const generation = await this.getGeneration(generationId);
    if (!generation) return null;
    const job = await this.getJobRow(generation.jobId);
    const draft = job.current_draft_id ? await this.getDraftById(job.id, job.current_draft_id) : null;
    return {
      generation,
      draft: draft?.generationId === generation.id && draft.version === generation.draftVersion ? draft : null,
    };
  }

  async completeGeneration(input: {
    generationId: Id;
    claimToken: Id;
    content: unknown;
    modelIdentifier: string;
  }): Promise<{ applied: true; draft: Draft } | { applied: false; reason: string }> {
    const content = DraftContentSchema.parse(input.content);
    const { data, error } = await this.client.rpc("complete_generation_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_generation_id: input.generationId,
      p_claim_token: input.claimToken,
      p_content: content,
      p_model_identifier: requireQuestionModelIdentifier(input.modelIdentifier),
    });
    throwDatabaseError(error, "complete generation");
    const result = data as Record<string, unknown> | null;
    if (!result) throw new DataAdapterError("INTERNAL_ERROR", "Generation completion returned no result.");
    if (result.applied === false) return { applied: false, reason: String(result.reason) };
    return { applied: true, draft: DraftSchema.parse(result.draft) };
  }

  async failGeneration(input: { generationId: Id; claimToken: Id; errorCode: string }): Promise<Generation> {
    const { data, error } = await this.client.rpc("fail_generation_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_generation_id: input.generationId,
      p_claim_token: input.claimToken,
      p_error_code: input.errorCode,
    });
    throwDatabaseError(error, "fail generation");
    return GenerationSchema.parse(data);
  }

  async updateJobInputs(input: {
    jobId: Id;
    expectedVersion: number;
    workshopSnapshotId: Id;
    machineId: Id;
    sourceAssetIds: Id[];
    partFamily: string;
  }): Promise<{ job: Job; draftVersion: number | null }> {
    this.requireRole("designer");
    const { data, error } = await this.client.rpc("update_job_inputs_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: input.jobId,
      p_actor_id: this.scope.actorId,
      p_expected_job_version: input.expectedVersion,
      p_workshop_snapshot_id: input.workshopSnapshotId,
      p_machine_id: input.machineId,
      p_source_asset_ids: input.sourceAssetIds,
      p_part_family: input.partFamily,
    });
    throwDatabaseError(error, "update job inputs");

    const bundle = await this.getJobBundle(input.jobId);
    const result = data as { draftVersion?: number | null } | null;
    return { job: bundle.job, draftVersion: result?.draftVersion ?? null };
  }

  async saveDraft(input: {
    jobId: Id;
    expectedVersion: number;
    content: DraftContentInput;
  }): Promise<Draft> {
    this.requireRole("designer");
    const contentInput = DraftContentInputSchema.parse(input.content);
    const job = await this.getJobRow(input.jobId);
    if (!job.current_draft_id) throw new DataAdapterError("NOT_FOUND", "Current draft not found.");

    const [sourceIds, assetRows, snapshot] = await Promise.all([
      this.listSourceAssetIds(job.id),
      this.listAssetRows(job.id),
      job.workshop_snapshot_id ? this.getWorkshopSnapshot(job.workshop_snapshot_id) : Promise.resolve(null),
    ]);
    if (!snapshot || !job.machine_id) {
      throw new DataAdapterError("REVIEW_REQUIRED", "Select a workshop snapshot and machine before saving a reviewed draft.");
    }

    const sourceIdsCanonical = [...sourceIds].sort();
    if (
      contentInput.workshopSnapshotId !== snapshot.id ||
      contentInput.machineId !== job.machine_id ||
      [...contentInput.sourceAssetIds].sort().join(",") !== sourceIdsCanonical.join(",")
    ) {
      throw new DataAdapterError("VERSION_CONFLICT", "Draft inputs no longer match the job inputs.");
    }

    const assets = assetRows.map((row) => this.mapAsset(row));
    const inputFingerprint = computeInputFingerprint({ job: this.mapJob(job, sourceIds), assets, workshopSnapshot: snapshot });

    const { data, error } = await this.client.rpc("save_draft_content_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: job.id,
      p_draft_id: job.current_draft_id,
      p_actor_id: this.scope.actorId,
      p_expected_version: input.expectedVersion,
      p_content: contentInput,
      p_input_fingerprint: inputFingerprint,
    });
    throwDatabaseError(error, "save draft");

    const saved = data as { version?: number } | null;
    if (!saved?.version) throw new DataAdapterError("INTERNAL_ERROR", "Draft save returned no version.");
    const draft = await this.getDraftById(job.id, job.current_draft_id);
    if (!draft || draft.version !== saved.version) {
      throw new DataAdapterError("VERSION_CONFLICT", "Draft changed before it could be reloaded.");
    }
    return draft;
  }

  async claimIdempotency(input: {
    operation: string;
    key: string;
    payloadHash: string;
    leaseSeconds?: number;
  }): Promise<unknown> {
    const { data, error } = await this.client.rpc("claim_idempotency_internal", {
      p_actor_kind: "member",
      p_actor_id: this.scope.actorId,
      p_operation: input.operation,
      p_idempotency_key: input.key,
      p_payload_hash: input.payloadHash,
      p_lease_seconds: input.leaseSeconds ?? 90,
    });
    throwDatabaseError(error, "claim idempotency key");
    return data;
  }

  async publishRelease(input: {
    jobId: Id;
    expectedDraftVersion: number;
    supersedesReleaseId: Id | null;
    allowPredecessorVisitors: boolean;
    idempotencyRecordId: Id;
    idempotencyClaimToken: Id;
  }): Promise<Release> {
    this.requireRole("designer");

    const bundle = await this.getJobBundle(input.jobId);
    if (!bundle.draft || bundle.draft.version !== input.expectedDraftVersion) {
      throw new DataAdapterError("VERSION_CONFLICT", "Draft changed before publication.");
    }
    const currentFingerprint = await this.currentInputFingerprint(bundle.job, bundle.assets);
    if (currentFingerprint !== bundle.draft.inputFingerprint) {
      throw new DataAdapterError("REVIEW_REQUIRED", "Draft inputs changed; reconcile and review the draft again.");
    }

    const { data, error } = await this.client.rpc("publish_release_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: input.jobId,
      p_actor_id: this.scope.actorId,
      p_expected_draft_version: input.expectedDraftVersion,
      p_supersedes_release_id: input.supersedesReleaseId,
      p_allow_predecessor_visitors: input.allowPredecessorVisitors,
      p_idempotency_record_id: input.idempotencyRecordId,
      p_idempotency_claim_token: input.idempotencyClaimToken,
    });
    throwDatabaseError(error, "publish release");

    const result = data as { releaseId?: Id } | null;
    if (!result?.releaseId) throw new DataAdapterError("INTERNAL_ERROR", "Publication returned no release ID.");
    return this.getRelease(result.releaseId);
  }

  async authorizeMemberAsset(jobId: Id, assetId: Id): Promise<AuthorizedPrivateAsset> {
    const { data, error } = await this.client
      .from("assets")
      .select("*")
      .eq("id", assetId)
      .eq("job_id", jobId)
      .eq("workspace_id", this.scope.workspaceId)
      .eq("status", "ready")
      .maybeSingle();
    throwDatabaseError(error, "authorize member asset");
    if (!data) throw new DataAdapterError("NOT_FOUND", "Asset not found.");
    const row = data as AssetRow;
    return { bucketId: "skunkworks-private", objectKey: row.storage_key, asset: this.mapAsset(row) };
  }

  private async currentInputFingerprint(job: Job, assets: Asset[]): Promise<string> {
    if (!job.workshopSnapshotId) {
      throw new DataAdapterError("REVIEW_REQUIRED", "The job has no selected workshop snapshot.");
    }
    const snapshot = await this.getWorkshopSnapshot(job.workshopSnapshotId);
    return computeInputFingerprint({ job, assets, workshopSnapshot: snapshot });
  }

  private async getJobRow(jobId: Id): Promise<JobRow> {
    const { data, error } = await this.client
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .eq("workspace_id", this.scope.workspaceId)
      .maybeSingle();
    throwDatabaseError(error, "read job");
    if (!data) throw new DataAdapterError("NOT_FOUND", "Job not found.");
    return data as JobRow;
  }

  private async listSourceAssetIds(jobId: Id): Promise<Id[]> {
    const { data, error } = await this.client
      .from("job_source_assets")
      .select("asset_id")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("job_id", jobId)
      .order("added_at", { ascending: true });
    throwDatabaseError(error, "read job source assets");
    return ((data ?? []) as Array<{ asset_id: Id }>).map(({ asset_id }) => asset_id);
  }

  private async listAssets(jobId: Id): Promise<Asset[]> {
    return (await this.listAssetRows(jobId)).map((row) => this.mapAsset(row));
  }

  private async listAssetRows(jobId: Id): Promise<AssetRow[]> {
    const { data, error } = await this.client
      .from("assets")
      .select("*")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });
    throwDatabaseError(error, "list job assets");
    return (data ?? []) as AssetRow[];
  }

  private async getDraftById(jobId: Id, draftId: Id): Promise<Draft | null> {
    const { data, error } = await this.client
      .from("drafts")
      .select("*")
      .eq("id", draftId)
      .eq("job_id", jobId)
      .eq("workspace_id", this.scope.workspaceId)
      .maybeSingle();
    throwDatabaseError(error, "read draft");
    const row = data as DraftRow | null;
    if (!row) return null;

    const { data: reviewData, error: reviewError } = await this.client
      .from("draft_reviews")
      .select("kind,actor_id,draft_version,reviewed_at")
      .eq("draft_id", row.id)
      .eq("workspace_id", this.scope.workspaceId)
      .eq("draft_version", row.version)
      .order("reviewed_at", { ascending: true });
    throwDatabaseError(reviewError, "read current draft reviews");

    return DraftSchema.parse({
      id: row.id,
      jobId: row.job_id,
      version: row.version,
      content: DraftContentSchema.parse(row.content),
      reviews: ((reviewData ?? []) as ReviewRow[]).map((review) => ({
        kind: review.kind,
        actorId: review.actor_id,
        draftVersion: review.draft_version,
        at: review.reviewed_at,
      })),
      generationId: row.generation_id,
      inputFingerprint: row.input_fingerprint,
    });
  }

  private async listReleases(jobId: Id): Promise<Release[]> {
    const { data, error } = await this.client
      .from("releases")
      .select("*")
      .eq("job_id", jobId)
      .eq("workspace_id", this.scope.workspaceId)
      .order("revision_number", { ascending: true });
    throwDatabaseError(error, "list job releases");
    return ((data ?? []) as ReleaseRow[]).map((row) => this.mapRelease(row));
  }

  private mapJob(row: JobRow, sourceAssetIds: Id[]): Job {
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

  private mapAsset(row: AssetRow): Asset {
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

  private mapRelease(row: ReleaseRow): Release {
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
}

function mapGeneration(row: GenerationRow): Generation {
  return GenerationSchema.parse({
    id: row.id,
    jobId: row.job_id,
    inputFingerprint: row.input_fingerprint,
    state: row.state,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    draftVersion: row.draft_version,
    errorCode: row.error_code,
  });
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
