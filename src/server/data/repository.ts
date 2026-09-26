import "server-only";

import {
  AssetSchema,
  DraftContentInputSchema,
  DraftContentSchema,
  DraftSchema,
  FlagSchema,
  GetJobResultSchema,
  JobSchema,
  MachineInputSchema,
  ReleaseSchema,
  RoleSchema,
  WorkshopSnapshotSchema,
  IdSchema,
  type Asset,
  type Draft,
  type DraftContentInput,
  type Flag,
  type Id,
  type Job,
  type MachineInput,
  type Release,
  type Role,
  type WorkshopSnapshot,
  type UploadAssetKind,
} from "@/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { computeInputFingerprint } from "./fingerprint";
import { DataAdapterError, throwDatabaseError } from "./errors";

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

const IdempotencyClaimSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("claimed"),
    recordId: IdSchema,
    claimToken: IdSchema,
    leaseExpiresAt: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({ state: z.literal("running"), retryAfterSeconds: z.number().int().positive() }).strict(),
  z.object({ state: z.literal("completed"), response: z.unknown(), resourceId: IdSchema.nullable() }).strict(),
  z.object({ state: z.literal("failed"), response: z.unknown(), resourceId: IdSchema.nullable() }).strict(),
]);
export type IdempotencyClaim = z.infer<typeof IdempotencyClaimSchema>;

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
    jobId: Id;
    title: string;
    partNumber: string;
    partFamily: string;
    workshopSnapshotId: Id | null;
    machineId: Id | null;
    idempotencyRecordId: Id;
    idempotencyClaimToken: Id;
  }): Promise<Job> {
    this.requireRole("designer");
    const { data, error } = await this.client.rpc("create_job_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_actor_id: this.scope.actorId,
      p_job_id: input.jobId,
      p_title: input.title,
      p_part_number: input.partNumber,
      p_part_family: input.partFamily,
      p_workshop_snapshot_id: input.workshopSnapshotId,
      p_machine_id: input.machineId,
      p_idempotency_record_id: input.idempotencyRecordId,
      p_idempotency_claim_token: input.idempotencyClaimToken,
    });
    throwDatabaseError(error, "create job");
    return JobSchema.parse(data);
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

    const machines = Array.isArray(row.snapshot.machines) ? row.snapshot.machines : [];
    const confirmedBy = confirmationRow?.confirmed_by ?? null;
    return WorkshopSnapshotSchema.parse({
      id: row.id,
      workshopId: row.workshop_id,
      workspaceId: row.workspace_id,
      version: row.version,
      name: row.snapshot.name,
      machines: machines.map((machine) => {
        if (!machine || typeof machine !== "object") return machine;
        const record = machine as { notes?: unknown };
        const notes = Array.isArray(record.notes)
          ? record.notes.map((note) => note && typeof note === "object"
            ? { ...note, confirmedBy: confirmedBy ?? ("confirmedBy" in note ? note.confirmedBy : null) }
            : note)
          : record.notes;
        return { ...machine, notes };
      }),
      confirmedBy,
      confirmedAt: confirmationRow?.confirmed_at ?? null,
    });
  }

  async listWorkshopSnapshots(): Promise<WorkshopSnapshot[]> {
    const { data, error } = await this.client
      .from("workshops")
      .select("id,current_version")
      .eq("workspace_id", this.scope.workspaceId)
      .order("created_at", { ascending: true });
    throwDatabaseError(error, "list workshops");
    const rows = (data ?? []) as Array<{ id: Id; current_version: number }>;
    const snapshots = await Promise.all(rows.map(async (workshop) => {
      const { data: version, error: versionError } = await this.client
        .from("workshop_versions")
        .select("id")
        .eq("workspace_id", this.scope.workspaceId)
        .eq("workshop_id", workshop.id)
        .eq("version", workshop.current_version)
        .maybeSingle();
      throwDatabaseError(versionError, "read current workshop version");
      if (!version?.id) throw new DataAdapterError("NOT_FOUND", "Current workshop version not found.");
      return this.getWorkshopSnapshot(version.id as Id);
    }));
    return snapshots;
  }

  async getCurrentWorkshopSnapshot(workshopId: Id): Promise<WorkshopSnapshot> {
    const { data, error } = await this.client
      .from("workshops")
      .select("current_version")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("id", workshopId)
      .maybeSingle();
    throwDatabaseError(error, "read current workshop version");
    if (!data) throw new DataAdapterError("NOT_FOUND", "Workshop not found.");
    const { data: version, error: versionError } = await this.client
      .from("workshop_versions")
      .select("id")
      .eq("workspace_id", this.scope.workspaceId)
      .eq("workshop_id", workshopId)
      .eq("version", data.current_version)
      .maybeSingle();
    throwDatabaseError(versionError, "read current workshop snapshot");
    if (!version?.id) throw new DataAdapterError("NOT_FOUND", "Current workshop version not found.");
    return this.getWorkshopSnapshot(version.id as Id);
  }

  async createWorkshop(input: {
    workshopId: Id;
    snapshotId: Id;
    name: string;
    idempotencyRecordId: Id;
    idempotencyClaimToken: Id;
  }): Promise<WorkshopSnapshot> {
    this.requireRole("fabricator");
    const { data, error } = await this.client.rpc("create_workshop_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_workshop_id: input.workshopId,
      p_snapshot_id: input.snapshotId,
      p_actor_id: this.scope.actorId,
      p_name: input.name,
      p_idempotency_record_id: input.idempotencyRecordId,
      p_idempotency_claim_token: input.idempotencyClaimToken,
    });
    throwDatabaseError(error, "create workshop");
    return this.getWorkshopSnapshot(IdSchema.parse(data));
  }

  async saveWorkshopVersion(input: {
    workshopId: Id;
    expectedVersion: number;
    machines: MachineInput[];
    name: string;
    snapshotId: Id;
    idempotencyRecordId: Id;
    idempotencyClaimToken: Id;
  }): Promise<WorkshopSnapshot> {
    this.requireRole("fabricator");
    const machines = input.machines.map((machine) => MachineInputSchema.parse(machine));
    const { data, error } = await this.client.rpc("save_workshop_version_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_workshop_id: input.workshopId,
      p_snapshot_id: input.snapshotId,
      p_actor_id: this.scope.actorId,
      p_expected_version: input.expectedVersion,
      p_name: input.name,
      p_machines: machines,
      p_idempotency_record_id: input.idempotencyRecordId,
      p_idempotency_claim_token: input.idempotencyClaimToken,
    });
    throwDatabaseError(error, "save workshop version");
    return this.getWorkshopSnapshot(IdSchema.parse(data));
  }

  async confirmWorkshopSnapshot(workshopId: Id, snapshotId: Id): Promise<WorkshopSnapshot> {
    this.requireRole("fabricator");
    const { data, error } = await this.client.rpc("confirm_workshop_snapshot_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_workshop_id: workshopId,
      p_snapshot_id: snapshotId,
      p_actor_id: this.scope.actorId,
    });
    throwDatabaseError(error, "confirm workshop snapshot");
    return this.getWorkshopSnapshot(IdSchema.parse(data));
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
    const [photoResult, responseResult, membershipResult, profileResult] = await Promise.all([
      this.client.from("flag_photo_assets").select("flag_id,asset_id").in("flag_id", flagIds),
      this.client.from("flag_responses").select("*").in("flag_id", flagIds).order("flag_version", { ascending: false }),
      this.client.from("workspace_members").select("user_id,role").eq("workspace_id", this.scope.workspaceId).eq("status", "active"),
      this.client.from("user_profiles").select("user_id,display_name"),
    ]);
    throwDatabaseError(photoResult.error, "read flag photos");
    throwDatabaseError(responseResult.error, "read flag responses");
    throwDatabaseError(membershipResult.error, "read flag actor roles");
    throwDatabaseError(profileResult.error, "read flag actor names");

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
      ((profileResult.data ?? []) as Array<{ user_id: Id; display_name: string }>).map((profile) => [
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

  async recordDraftReview(input: {
    jobId: Id;
    expectedVersion: number;
    kind: "design" | "process";
  }): Promise<Draft> {
    this.requireRole(input.kind === "design" ? "designer" : "fabricator");
    const { data, error } = await this.client.rpc("record_draft_review_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: input.jobId,
      p_actor_id: this.scope.actorId,
      p_expected_version: input.expectedVersion,
      p_kind: input.kind,
    });
    throwDatabaseError(error, "record draft review");
    const result = data as { draftId?: Id; version?: number } | null;
    if (!result?.draftId || result.version !== input.expectedVersion) {
      throw new DataAdapterError("INTERNAL_ERROR", "Review returned no current draft version.");
    }
    const draft = await this.getDraftById(input.jobId, result.draftId);
    if (!draft || draft.version !== input.expectedVersion || !draft.reviews.some((review) =>
      review.kind === input.kind && review.actorId === this.scope.actorId && review.draftVersion === input.expectedVersion
    )) {
      throw new DataAdapterError("VERSION_CONFLICT", "Draft changed before its review could be reloaded.");
    }
    return draft;
  }

  async claimIdempotency(input: {
    operation: string;
    key: string;
    payloadHash: string;
    leaseSeconds?: number;
  }): Promise<IdempotencyClaim> {
    const { data, error } = await this.client.rpc("claim_idempotency_internal", {
      p_actor_kind: "member",
      p_actor_id: this.scope.actorId,
      p_operation: input.operation,
      p_idempotency_key: input.key,
      p_payload_hash: input.payloadHash,
      p_lease_seconds: input.leaseSeconds ?? 90,
    });
    throwDatabaseError(error, "claim idempotency key");
    return IdempotencyClaimSchema.parse(data);
  }

  async prepareSourceAsset(input: {
    assetId: Id;
    jobId: Id;
    kind: UploadAssetKind;
    filename: string;
    mimeType: string;
    byteSize: number;
    idempotencyRecordId: Id;
    idempotencyClaimToken: Id;
  }): Promise<Id> {
    this.requireRole("designer");
    const { data, error } = await this.client.rpc("prepare_source_asset_internal", {
      p_workspace_id: this.scope.workspaceId,
      p_job_id: input.jobId,
      p_actor_id: this.scope.actorId,
      p_asset_id: input.assetId,
      p_kind: input.kind,
      p_filename: input.filename,
      p_mime_type: input.mimeType,
      p_byte_size: input.byteSize,
      p_idempotency_record_id: input.idempotencyRecordId,
      p_idempotency_claim_token: input.idempotencyClaimToken,
    });
    throwDatabaseError(error, "prepare source asset");
    return IdSchema.parse(data);
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
