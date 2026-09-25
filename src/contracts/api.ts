import { z } from "zod";
import {
  ActorSchema,
  AssetSchema,
  ContextRefSchema,
  DraftContentInputSchema,
  DraftSchema,
  GenerationSchema,
  IdSchema,
  JobSchema,
  MachineSchema,
  ReleaseSchema,
  RoleSchema,
  WorkshopSnapshotSchema,
  WorkspaceMembershipSchema,
  WorkspaceSchema,
} from "./domain";

export const CONTRACT_VERSION = "1.0" as const;

export const ApiWireErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "VERSION_CONFLICT",
  "UNSUPPORTED_ASSET",
  "MAPPING_REQUIRED",
  "REVIEW_REQUIRED",
  "GENERATION_RUNNING",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "RATE_LIMITED",
  "RELEASE_REVOKED",
  "IDEMPOTENCY_KEY_REUSED",
  "INTERNAL_ERROR",
]);
export type ApiWireErrorCode = z.infer<typeof ApiWireErrorCodeSchema>;

// ENDPOINT_UNAVAILABLE is local client state, never a wire/API response code.
export const ApiErrorCodeSchema = z.union([
  ApiWireErrorCodeSchema,
  z.literal("ENDPOINT_UNAVAILABLE"),
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiMetaSchema = z.object({
  requestId: z.string().min(1),
  contractVersion: z.literal(CONTRACT_VERSION),
}).strict();
export type ApiMeta = z.infer<typeof ApiMetaSchema>;

export function ApiSuccessEnvelopeSchema<TData extends z.ZodType>(dataSchema: TData) {
  return z.object({ data: dataSchema, meta: ApiMetaSchema }).strict();
}

export type ApiSuccessEnvelope<TData> = {
  data: TData;
  meta: ApiMeta;
};

export const FieldErrorsSchema = z.record(z.string(), z.array(z.string()));

export const ApiErrorBodySchema = z.object({
  code: ApiWireErrorCodeSchema,
  message: z.string().min(1),
  fieldErrors: FieldErrorsSchema.optional(),
  retryable: z.boolean(),
}).strict();
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const ApiErrorEnvelopeSchema = z.object({
  error: ApiErrorBodySchema,
  meta: ApiMetaSchema,
}).strict();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

export const IdempotencyKeySchema = z.string().min(16).max(128);
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

const nonEmptyString = z.string().trim().min(1);
const safeReturnPathSchema = z.string().startsWith("/").refine((path) => !path.startsWith("//") && !path.startsWith("/\\"), "Return path must stay on this origin.");

export const SignUpInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: nonEmptyString.optional(),
}).strict();
export type SignUpInput = z.infer<typeof SignUpInputSchema>;

export const SignInInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).strict();
export type SignInInput = z.infer<typeof SignInInputSchema>;

export const AuthSessionViewSchema = z.object({
  actor: ActorSchema,
  memberships: z.array(WorkspaceMembershipSchema),
}).strict();
export type AuthSessionView = z.infer<typeof AuthSessionViewSchema>;

export const CreateWorkspaceResultSchema = z.object({
  workspace: WorkspaceSchema,
  membership: WorkspaceMembershipSchema,
}).strict();
export type CreateWorkspaceResult = z.infer<typeof CreateWorkspaceResultSchema>;

export const SignUpResultSchema = z.object({
  verificationRequired: z.boolean(),
}).strict();
export type SignUpResult = z.infer<typeof SignUpResultSchema>;

export const CreateWorkspaceInputSchema = z.object({
  name: nonEmptyString,
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInputSchema>;

export const InviteWorkspaceMemberInputSchema = z.object({
  workspaceId: IdSchema,
  role: RoleSchema,
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type InviteWorkspaceMemberInput = z.infer<typeof InviteWorkspaceMemberInputSchema>;

export const RedeemInviteInputSchema = z.object({
  token: nonEmptyString,
  returnPath: safeReturnPathSchema.optional(),
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type RedeemInviteInput = z.infer<typeof RedeemInviteInputSchema>;

export const CreateWorkshopInputSchema = z.object({
  workspaceId: IdSchema,
  name: nonEmptyString,
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type CreateWorkshopInput = z.infer<typeof CreateWorkshopInputSchema>;

export const SaveWorkshopVersionInputSchema = z.object({
  workshopId: IdSchema,
  expectedVersion: z.number().int().positive(),
  machines: z.array(MachineSchema),
  name: nonEmptyString,
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type SaveWorkshopVersionInput = z.infer<typeof SaveWorkshopVersionInputSchema>;

export const ConfirmWorkshopInputSchema = z.object({
  workshopId: IdSchema,
  snapshotId: IdSchema,
}).strict();
export type ConfirmWorkshopInput = z.infer<typeof ConfirmWorkshopInputSchema>;

export const CreateJobInputSchema = z.object({
  workspaceId: IdSchema,
  title: nonEmptyString,
  partNumber: nonEmptyString,
  partFamily: nonEmptyString,
  workshopSnapshotId: IdSchema.nullable(),
  machineId: IdSchema.nullable(),
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type CreateJobInput = z.infer<typeof CreateJobInputSchema>;

export const UpdateJobInputsSchema = z.object({
  jobId: IdSchema,
  expectedVersion: z.number().int().positive(),
  workshopSnapshotId: IdSchema,
  machineId: IdSchema,
  sourceAssetIds: z.array(IdSchema),
  partFamily: nonEmptyString,
}).strict();
export type UpdateJobInputs = z.infer<typeof UpdateJobInputsSchema>;

export const UploadAssetKindSchema = z.enum(["drawing_pdf", "model_glb", "bend_manifest"]);
export type UploadAssetKind = z.infer<typeof UploadAssetKindSchema>;

export const UploadPreparationSchema = z.object({
  assetId: IdSchema,
  upload: z.object({
    url: z.string().url(),
    method: z.enum(["PUT", "POST"]),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string().datetime({ offset: true }),
  }).strict(),
}).strict();
export type UploadPreparation = z.infer<typeof UploadPreparationSchema>;

export const ResumeAssetUploadResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("ready"), asset: AssetSchema }).strict(),
  z.object({ state: z.literal("upload_required"), preparation: UploadPreparationSchema }).strict(),
]);
export type ResumeAssetUploadResult = z.infer<typeof ResumeAssetUploadResultSchema>;

export const UploadAssetPreparationBodySchema = z.object({
  kind: UploadAssetKindSchema,
  filename: nonEmptyString,
  mimeType: nonEmptyString,
  byteSize: z.number().int().nonnegative(),
}).strict();

export const UploadReleasePhotoPreparationBodySchema = z.object({
  filename: nonEmptyString,
  mimeType: z.string().regex(/^image\//),
  byteSize: z.number().int().positive(),
}).strict();

export const GetAssetLinkInputSchema = z.object({ assetId: IdSchema }).strict();
export type GetAssetLinkInput = z.infer<typeof GetAssetLinkInputSchema>;

export const AssetLinkSchema = z.object({
  url: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();
export type AssetLink = z.infer<typeof AssetLinkSchema>;

export const CreateGenerationInputSchema = z.object({
  jobId: IdSchema,
  expectedJobVersion: z.number().int().positive(),
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type CreateGenerationInput = z.infer<typeof CreateGenerationInputSchema>;

export const CreateDraftFromReleaseInputSchema = z.object({
  jobId: IdSchema,
  releaseId: IdSchema,
  expectedJobVersion: z.number().int().positive(),
  expectedDraftVersion: z.number().int().positive().nullable(),
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type CreateDraftFromReleaseInput = z.infer<typeof CreateDraftFromReleaseInputSchema>;

export const RecordClarificationInputSchema = z.object({
  jobId: IdSchema,
  text: nonEmptyString,
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type RecordClarificationInput = z.infer<typeof RecordClarificationInputSchema>;

export const ResolveFindingInputSchema = z.object({
  jobId: IdSchema,
  findingId: IdSchema,
  expectedVersion: z.number().int().positive(),
  recordId: IdSchema,
}).strict();
export type ResolveFindingInput = z.infer<typeof ResolveFindingInputSchema>;

export const SaveDraftInputSchema = z.object({
  jobId: IdSchema,
  expectedVersion: z.number().int().positive(),
  content: DraftContentInputSchema,
}).strict();
export type SaveDraftInput = z.infer<typeof SaveDraftInputSchema>;

export const DecideProposalInputSchema = z.object({
  jobId: IdSchema,
  proposalId: IdSchema,
  expectedVersion: z.number().int().positive(),
  decision: z.enum(["accept", "reject"]),
}).strict();
export type DecideProposalInput = z.infer<typeof DecideProposalInputSchema>;

export const ReviewDraftInputSchema = z.object({
  jobId: IdSchema,
  expectedVersion: z.number().int().positive(),
  kind: z.enum(["design", "process"]),
}).strict();
export type ReviewDraftInput = z.infer<typeof ReviewDraftInputSchema>;

export const PublishReleaseInputSchema = z.object({
  jobId: IdSchema,
  expectedDraftVersion: z.number().int().positive(),
  supersedesReleaseId: IdSchema.nullable(),
  allowPredecessorVisitors: z.boolean(),
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type PublishReleaseInput = z.infer<typeof PublishReleaseInputSchema>;

export const FollowReplacementInputSchema = z.object({
  releaseId: IdSchema,
  replacementReleaseId: IdSchema,
}).strict();
export type FollowReplacementInput = z.infer<typeof FollowReplacementInputSchema>;

export const CreateShareLinkInputSchema = z.object({
  releaseId: IdSchema,
  idempotencyKey: IdempotencyKeySchema,
}).strict();
export type CreateShareLinkInput = z.infer<typeof CreateShareLinkInputSchema>;

export const CreateShareLinkResultSchema = z.object({
  linkId: IdSchema,
  accessUrl: z.string().url(),
}).strict();
export type CreateShareLinkResult = z.infer<typeof CreateShareLinkResultSchema>;

export const RevokeShareLinkInputSchema = z.object({
  releaseId: IdSchema,
  linkId: IdSchema,
}).strict();
export type RevokeShareLinkInput = z.infer<typeof RevokeShareLinkInputSchema>;

export const RevokeShareLinkResultSchema = z.object({
  linkId: IdSchema,
  revokedAt: z.string().datetime({ offset: true }),
}).strict();
export type RevokeShareLinkResult = z.infer<typeof RevokeShareLinkResultSchema>;

export const AskQuestionInputSchema = z.object({
  context: ContextRefSchema,
  question: nonEmptyString,
  // Optional for v1.0 source compatibility. The typed client creates a key
  // when omitted; callers should retain and reuse one for explicit retries.
  idempotencyKey: IdempotencyKeySchema.optional(),
}).strict();
export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;

export const ListFlagsInputSchema = z.object({
  jobId: IdSchema.optional(),
  releaseId: IdSchema.optional(),
}).strict().superRefine((query, ctx) => {
  if ((query.jobId === undefined) === (query.releaseId === undefined)) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one of jobId or releaseId." });
  }
});
export type ListFlagsInput = z.infer<typeof ListFlagsInputSchema>;

export const CreateFlagInputSchema = z.object({
  context: ContextRefSchema,
  question: nonEmptyString,
  photoAssetIds: z.array(IdSchema),
  idempotencyKey: IdempotencyKeySchema,
}).strict().superRefine((input, ctx) => {
  if (input.context.releaseId === null) {
    ctx.addIssue({ code: "custom", path: ["context", "releaseId"], message: "Flag creation is release-scoped." });
  }
});
export type CreateFlagInput = z.infer<typeof CreateFlagInputSchema>;

export const RespondToFlagInputSchema = z.object({
  flagId: IdSchema,
  expectedVersion: z.number().int().positive(),
  text: nonEmptyString,
  kind: z.enum(["explanation", "replacement_release"]),
  replacementReleaseId: IdSchema.nullable(),
}).strict().superRefine((input, ctx) => {
  if ((input.kind === "replacement_release") !== (input.replacementReleaseId !== null)) {
    ctx.addIssue({ code: "custom", path: ["replacementReleaseId"], message: "Replacement responses require a release ID; explanations cannot carry one." });
  }
});
export type RespondToFlagInput = z.infer<typeof RespondToFlagInputSchema>;

export const AcknowledgeFlagInputSchema = z.object({
  flagId: IdSchema,
  expectedVersion: z.number().int().positive(),
}).strict();
export type AcknowledgeFlagInput = z.infer<typeof AcknowledgeFlagInputSchema>;

export const CompleteAssetInputSchema = z.object({ assetId: IdSchema }).strict();
export const CompleteAssetResultSchema = AssetSchema;
export const CreateJobResultSchema = JobSchema;
export const CreateWorkshopResultSchema = WorkshopSnapshotSchema;
export const GenerationResultSchema = z.object({
  generation: GenerationSchema,
  draft: DraftSchema.nullable(),
}).strict();
export const GetJobResultSchema = z.object({
  job: JobSchema,
  assets: z.array(AssetSchema),
  draft: DraftSchema.nullable(),
  releases: z.array(ReleaseSchema),
}).strict();
