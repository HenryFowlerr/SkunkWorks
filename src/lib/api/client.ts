import { NativePreviewSchema, type NativePreview } from "@/contracts/native-preview";
import { FlagReplySuggestionSchema, SuggestFlagReplyBodySchema, type FlagReplySuggestion } from "@/contracts/ai";
import { z } from "zod";
import {
  AcknowledgeFlagInputSchema,
  AnswerSchema,
  ApiErrorEnvelopeSchema,
  ApiSuccessEnvelopeSchema,
  AskQuestionInputSchema,
  AssetLinkSchema,
  AssetSchema,
  AuthSessionViewSchema,
  ConfirmWorkshopInputSchema,
  CreateDraftFromReleaseInputSchema,
  CreateFlagInputSchema,
  CreateGenerationInputSchema,
  CreateJobInputSchema,
  CreateJobResultSchema,
  CreateShareLinkInputSchema,
  CreateShareLinkResultSchema,
  CreateWorkshopInputSchema,
  CreateWorkspaceInputSchema,
  CreateWorkspaceResultSchema,
  DecideProposalInputSchema,
  DraftSchema,
  EvidenceRefSchema,
  FacilityCheckBodySchema,
  FacilityCheckResultSchema,
  FlagSchema,
  FollowReplacementInputSchema,
  GenerationResultSchema,
  GenerationSchema,
  GetJobResultSchema,
  IdSchema,
  InviteWorkspaceMemberInputSchema,
  JobSchema,
  ListFlagsInputSchema,
  PublishReleaseInputSchema,
  PitchAnalysisResultSchema,
  PitchRequestBodySchema,
  RedeemInviteInputSchema,
  RecordClarificationInputSchema,
  ReleaseSchema,
  ReleaseViewSchema,
  ResolveFindingInputSchema,
  RespondToFlagInputSchema,
  RevokeShareLinkInputSchema,
  RevokeShareLinkResultSchema,
  ReviewDraftInputSchema,
  SaveDraftInputSchema,
  SaveWorkshopVersionInputSchema,
  SignInInputSchema,
  SignUpInputSchema,
  SignUpResultSchema,
  UpdateJobInputsSchema,
  UploadAssetKindSchema,
  UploadPreparationSchema,
  UploadReleasePhotoPreparationBodySchema,
  UploadAssetPreparationBodySchema,
  WorkshopSnapshotSchema,
  WorkspaceInviteSchema,
  WorkspaceMembershipSchema,
} from "@/contracts";
import type {
  AcknowledgeFlagInput,
  ApiErrorCode,
  Answer,
  AskQuestionInput,
  Asset,
  AssetLink,
  AuthSessionView,
  ConfirmWorkshopInput,
  CreateDraftFromReleaseInput,
  CreateFlagInput,
  CreateGenerationInput,
  CreateJobInput,
  CreateShareLinkInput,
  CreateShareLinkResult,
  CreateWorkshopInput,
  CreateWorkspaceResult,
  CreateWorkspaceInput,
  DecideProposalInput,
  Draft,
  EvidenceRef,
  FacilityCheckBody,
  FacilityCheckResult,
  Flag,
  FollowReplacementInput,
  Generation,
  Id,
  InviteWorkspaceMemberInput,
  Job,
  ListFlagsInput,
  PublishReleaseInput,
  RedeemInviteInput,
  RecordClarificationInput,
  Release,
  ReleaseView,
  ResolveFindingInput,
  RespondToFlagInput,
  RevokeShareLinkInput,
  RevokeShareLinkResult,
  ReviewDraftInput,
  SaveDraftInput,
  SaveWorkshopVersionInput,
  SignInInput,
  SignUpInput,
  SignUpResult,
  UpdateJobInputs,
  PitchAnalysisResult,
  PitchRequestBody,
  UploadAssetKind,
  WorkspaceInvite,
  WorkspaceMembership,
  WorkshopSnapshot,
} from "@/contracts";

export type ApiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiTransportRequest = {
  method: ApiHttpMethod;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
};

export type ApiUploadRequest = {
  url: string;
  method: "PUT" | "POST";
  headers: Record<string, string>;
  file: File;
  onProgress?: (progress: number) => void;
};

/**
 * Injectable browser-safe boundary for same-origin API requests and short-lived
 * private-storage uploads. The contract-only build ships no fake implementation.
 */
export type ApiTransport = {
  request(request: ApiTransportRequest): Promise<unknown>;
  upload(request: ApiUploadRequest): Promise<void>;
};

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly fieldErrors?: Record<string, string[]>;
  readonly status?: number;

  constructor(input: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
    fieldErrors?: Record<string, string[]>;
    status?: number;
  }) {
    super(input.message);
    this.name = "ApiClientError";
    this.code = input.code;
    this.retryable = input.retryable;
    this.fieldErrors = input.fieldErrors;
    this.status = input.status;
  }
}

const unavailableMessage = "The SkunkWorks API endpoint is not implemented in this contract-only build.";

/** Explicit unavailable transport; it never returns fixture or success data. */
export const unavailableApiTransport: ApiTransport = {
  async request(request: ApiTransportRequest): Promise<unknown> {
    throw new ApiClientError({
      code: "ENDPOINT_UNAVAILABLE",
      message: `${unavailableMessage} (${request.method} ${request.path})`,
      retryable: false,
    });
  },
  async upload(request: ApiUploadRequest) {
    throw new ApiClientError({
      code: "ENDPOINT_UNAVAILABLE",
      message: `${unavailableMessage} (private storage upload to ${new URL(request.url).origin})`,
      retryable: false,
    });
  },
};

export type FetchTransportOptions = {
  /** Injectable fetch for deterministic transport tests; production uses `fetch`. */
  fetchImpl?: typeof fetch;
};

/**
 * Real same-origin JSON transport plus credentialless upload to a short-lived
 * private-storage URL. It never supplies fixture data. Fetch does not expose
 * upload byte progress, so onProgress receives 1 only after completion.
 */
export function createFetchApiTransport(options: FetchTransportOptions = {}): ApiTransport {
  const fetchImpl = options.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) =>
    globalThis.fetch(input, init));

  return {
    async request(request) {
      if (!request.path.startsWith("/api/") || request.path.startsWith("//")) {
        throw new ApiClientError({
          code: "VALIDATION_FAILED",
          message: "API requests must use a same-origin /api route.",
          retryable: false,
        });
      }

      const headers: Record<string, string> = {
        Accept: "application/json",
        ...request.headers,
      };
      const init: RequestInit = {
        method: request.method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      };
      if (request.body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(request.body);
      }

      let response: Response;
      try {
        response = await fetchImpl(request.path, init);
      } catch {
        throw new ApiClientError({
          code: "ENDPOINT_UNAVAILABLE",
          message: "The same-origin API could not be reached.",
          retryable: true,
        });
      }

      if (!response.headers.get("content-type")?.toLowerCase().includes("json")) {
        throw new ApiClientError({
          code: response.status === 404 ? "ENDPOINT_UNAVAILABLE" : "VALIDATION_FAILED",
          message: response.status === 404
            ? "This same-origin API route is not implemented."
            : "The API returned a non-JSON response outside contract version 1.0.",
          retryable: response.status >= 500,
          status: response.status,
        });
      }

      try {
        return await response.json() as unknown;
      } catch {
        throw new ApiClientError({
          code: "VALIDATION_FAILED",
          message: "The API returned invalid JSON outside contract version 1.0.",
          retryable: false,
          status: response.status,
        });
      }
    },

    async upload(request) {
      const url = new URL(request.url);
      const localHost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
      if ((url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) || url.username || url.password) {
        throw new ApiClientError({
          code: "VALIDATION_FAILED",
          message: "The private upload URL must use HTTPS or a loopback development host.",
          retryable: false,
        });
      }

      let response: Response;
      const body = new FormData();
      // Match Supabase StorageFileApi.uploadToSignedUrl for Blob/File uploads:
      // it sends the default cacheControl field alongside the unnamed file part.
      body.append("cacheControl", "3600");
      body.append("", request.file);
      // The multipart boundary is generated by fetch. The file part retains
      // its own MIME type from the File object.
      const headers = Object.fromEntries(
        Object.entries(request.headers).filter(([name]) => name.toLowerCase() !== "content-type"),
      );
      try {
        response = await fetchImpl(url.toString(), {
          method: request.method,
          headers,
          body,
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });
      } catch {
        throw new ApiClientError({
          code: "ENDPOINT_UNAVAILABLE",
          message: "The private storage upload could not be reached.",
          retryable: true,
        });
      }

      if (!response.ok) {
        const status = response.status;
        throw new ApiClientError({
          code: status === 401 || status === 403
            ? "FORBIDDEN"
            : status === 413 || status === 415
              ? "UNSUPPORTED_ASSET"
              : status >= 500
                ? "PROVIDER_UNAVAILABLE"
                : "VALIDATION_FAILED",
          message: "Private storage rejected the upload.",
          retryable: status === 408 || status === 429 || status >= 500,
          status,
        });
      }

      request.onProgress?.(1);
    },
  };
}

async function requestData<TData>(
  transport: ApiTransport,
  request: ApiTransportRequest,
  dataSchema: z.ZodType<TData>,
): Promise<TData> {
  let raw: unknown;
  try {
    raw = await transport.request(request);
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError({
      code: "ENDPOINT_UNAVAILABLE",
      message: "The API request could not be completed because its endpoint was unavailable.",
      retryable: true,
    });
  }

  const errorEnvelope = ApiErrorEnvelopeSchema.safeParse(raw);
  if (errorEnvelope.success) {
    throw new ApiClientError({
      ...errorEnvelope.data.error,
    });
  }

  const successEnvelope = ApiSuccessEnvelopeSchema(dataSchema).safeParse(raw);
  if (!successEnvelope.success) {
    throw new ApiClientError({
      code: "VALIDATION_FAILED",
      message: "The API returned a response outside contract version 1.0.",
      retryable: false,
    });
  }
  return successEnvelope.data.data;
}

function idempotencyHeaders(idempotencyKey: string) {
  return { "Idempotency-Key": idempotencyKey };
}

function queryPath(path: string, entries: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function createApiClient(transport: ApiTransport = unavailableApiTransport) {
  const call = <TData>(request: ApiTransportRequest, schema: z.ZodType<TData>) =>
    requestData(transport, request, schema);

  return {
    auth: {
      signUp(input: SignUpInput): Promise<SignUpResult> {
        const body = SignUpInputSchema.parse(input);
        return call({ method: "POST", path: "/api/auth/sign-up", body }, SignUpResultSchema);
      },
      signIn(input: SignInInput): Promise<AuthSessionView> {
        const body = SignInInputSchema.parse(input);
        return call({ method: "POST", path: "/api/auth/sign-in", body }, AuthSessionViewSchema);
      },
      signOut(): Promise<{ signedOut: true }> {
        return call({ method: "POST", path: "/api/auth/sign-out" }, z.object({ signedOut: z.literal(true) }).strict());
      },
      me(): Promise<AuthSessionView> {
        return call({ method: "GET", path: "/api/me" }, AuthSessionViewSchema);
      },
    },
    workspaces: {
      create(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
        const { idempotencyKey, ...body } = CreateWorkspaceInputSchema.parse(input);
        return call({ method: "POST", path: "/api/workspaces", headers: idempotencyHeaders(idempotencyKey), body }, CreateWorkspaceResultSchema);
      },
      invite(input: InviteWorkspaceMemberInput): Promise<WorkspaceInvite> {
        const parsed = InviteWorkspaceMemberInputSchema.parse(input);
        const { workspaceId, idempotencyKey, ...body } = parsed;
        return call({
          method: "POST",
          path: `/api/workspaces/${encodeURIComponent(workspaceId)}/invites`,
          headers: idempotencyHeaders(idempotencyKey),
          body,
        }, WorkspaceInviteSchema);
      },
      redeemInvite(input: RedeemInviteInput): Promise<WorkspaceMembership> {
        const { idempotencyKey, ...body } = RedeemInviteInputSchema.parse(input);
        return call({ method: "POST", path: "/api/invites/redeem", headers: idempotencyHeaders(idempotencyKey), body }, WorkspaceMembershipSchema);
      },
    },
    workshops: {
      list(input: { workspaceId: Id }): Promise<WorkshopSnapshot[]> {
        const parsed = z.object({ workspaceId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: queryPath("/api/workshops", parsed) }, z.array(WorkshopSnapshotSchema));
      },
      create(input: CreateWorkshopInput): Promise<WorkshopSnapshot> {
        const { idempotencyKey, ...body } = CreateWorkshopInputSchema.parse(input);
        return call({ method: "POST", path: "/api/workshops", headers: idempotencyHeaders(idempotencyKey), body }, WorkshopSnapshotSchema);
      },
      get(input: { workshopId: Id }): Promise<WorkshopSnapshot> {
        const parsed = z.object({ workshopId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: `/api/workshops/${encodeURIComponent(parsed.workshopId)}` }, WorkshopSnapshotSchema);
      },
      saveVersion(input: SaveWorkshopVersionInput): Promise<WorkshopSnapshot> {
        const { workshopId, idempotencyKey, ...body } = SaveWorkshopVersionInputSchema.parse(input);
        return call({ method: "POST", path: `/api/workshops/${encodeURIComponent(workshopId)}/versions`, headers: idempotencyHeaders(idempotencyKey), body }, WorkshopSnapshotSchema);
      },
      confirm(input: ConfirmWorkshopInput): Promise<WorkshopSnapshot> {
        const { workshopId, snapshotId } = ConfirmWorkshopInputSchema.parse(input);
        return call({ method: "POST", path: `/api/workshops/${encodeURIComponent(workshopId)}/versions/${encodeURIComponent(snapshotId)}/confirm` }, WorkshopSnapshotSchema);
      },
    },
    jobs: {
      list(input: { workspaceId: Id }): Promise<Job[]> {
        const parsed = z.object({ workspaceId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: queryPath("/api/jobs", parsed) }, z.array(JobSchema));
      },
      create(input: CreateJobInput): Promise<Job> {
        const { idempotencyKey, ...body } = CreateJobInputSchema.parse(input);
        return call({ method: "POST", path: "/api/jobs", headers: idempotencyHeaders(idempotencyKey), body }, CreateJobResultSchema);
      },
      get(input: { jobId: Id }): Promise<{ job: Job; assets: Asset[]; draft: Draft | null; releases: Release[] }> {
        const parsed = z.object({ jobId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: `/api/jobs/${encodeURIComponent(parsed.jobId)}` }, GetJobResultSchema);
      },
      updateInputs(input: UpdateJobInputs): Promise<Job> {
        const { jobId, ...body } = UpdateJobInputsSchema.parse(input);
        return call({ method: "PATCH", path: `/api/jobs/${encodeURIComponent(jobId)}`, body }, JobSchema);
      },
      checkFacility(input: { jobId: Id } & FacilityCheckBody): Promise<FacilityCheckResult> {
        const jobId = IdSchema.parse(input.jobId);
        const body = FacilityCheckBodySchema.parse({ expectedJobVersion: input.expectedJobVersion, requirements: input.requirements });
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/facility-check`, body }, FacilityCheckResultSchema);
      },
      pitch(input: { jobId: Id } & PitchRequestBody): Promise<PitchAnalysisResult> {
        const jobId = IdSchema.parse(input.jobId);
        const parsed = PitchRequestBodySchema.parse(input.action === "triage"
          ? { expectedJobVersion: input.expectedJobVersion, action: input.action, issue: input.issue }
          : input.action === "preview_question"
            ? { expectedJobVersion: input.expectedJobVersion, action: input.action, preview: input.preview }
            : { expectedJobVersion: input.expectedJobVersion, action: input.action });
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/pitch`, body: parsed }, PitchAnalysisResultSchema);
      },
    },
    assets: {
      getPreview(input: { assetId: Id }): Promise<NativePreview> {
        const assetId = IdSchema.parse(input.assetId);
        return call({ method: "GET", path: `/api/assets/${encodeURIComponent(assetId)}/preview` }, NativePreviewSchema);
      },
      async uploadAsset(input: {
        jobId: Id;
        kind: UploadAssetKind;
        file: File;
        idempotencyKey: string;
        onProgress?: (progress: number) => void;
      }): Promise<Asset> {
        const { jobId, kind, file, idempotencyKey, onProgress } = input;
        IdSchema.parse(jobId);
        UploadAssetKindSchema.parse(kind);
        if (!(file instanceof File)) throw new TypeError("assets.uploadAsset requires a browser File.");
        const key = z.string().min(16).max(128).parse(idempotencyKey);
        const body = UploadAssetPreparationBodySchema.parse({ kind, filename: file.name, mimeType: kind === "native_part" || kind === "native_drawing" ? "application/octet-stream" : file.type || "application/octet-stream", byteSize: file.size });
        const prepared = await call({
          method: "POST",
          path: `/api/jobs/${encodeURIComponent(jobId)}/assets`,
          headers: idempotencyHeaders(key),
          body,
        }, UploadPreparationSchema);
        await transport.upload({ ...prepared.upload, file, onProgress });
        return call({
          method: "POST",
          path: `/api/assets/${encodeURIComponent(prepared.assetId)}/complete`,
          body: {},
        }, AssetSchema);
      },
      async uploadReleasePhoto(input: {
        releaseId: Id;
        file: File;
        idempotencyKey: string;
        onProgress?: (progress: number) => void;
      }): Promise<Asset> {
        const { releaseId, file, idempotencyKey, onProgress } = input;
        IdSchema.parse(releaseId);
        if (!(file instanceof File)) throw new TypeError("assets.uploadReleasePhoto requires a browser File.");
        const key = z.string().min(16).max(128).parse(idempotencyKey);
        const body = UploadReleasePhotoPreparationBodySchema.parse({ filename: file.name, mimeType: file.type, byteSize: file.size });
        const prepared = await call({
          method: "POST",
          path: `/api/releases/${encodeURIComponent(releaseId)}/photos`,
          headers: idempotencyHeaders(key),
          body,
        }, UploadPreparationSchema);
        await transport.upload({ ...prepared.upload, file, onProgress });
        return call({
          method: "POST",
          path: `/api/assets/${encodeURIComponent(prepared.assetId)}/complete`,
          body: {},
        }, AssetSchema);
      },
      getLink(input: { assetId: Id }): Promise<AssetLink> {
        const parsed = z.object({ assetId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: `/api/assets/${encodeURIComponent(parsed.assetId)}/link` }, AssetLinkSchema);
      },
    },
    generations: {
      create(input: CreateGenerationInput): Promise<Generation> {
        const { jobId, idempotencyKey, ...body } = CreateGenerationInputSchema.parse(input);
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/generate`, headers: idempotencyHeaders(idempotencyKey), body }, GenerationSchema);
      },
      get(input: { generationId: Id }): Promise<{ generation: Generation; draft: Draft | null }> {
        const parsed = z.object({ generationId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: `/api/generations/${encodeURIComponent(parsed.generationId)}` }, GenerationResultSchema);
      },
    },
    drafts: {
      createFromRelease(input: CreateDraftFromReleaseInput): Promise<Draft> {
        const { jobId, releaseId, idempotencyKey, ...body } = CreateDraftFromReleaseInputSchema.parse(input);
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/draft/from-release`, headers: idempotencyHeaders(idempotencyKey), body: { releaseId, ...body } }, DraftSchema);
      },
      recordClarification(input: RecordClarificationInput): Promise<EvidenceRef> {
        const { jobId, idempotencyKey, ...body } = RecordClarificationInputSchema.parse(input);
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/clarifications`, headers: idempotencyHeaders(idempotencyKey), body }, EvidenceRefSchema);
      },
      resolveFinding(input: ResolveFindingInput): Promise<Draft> {
        const { jobId, findingId, ...body } = ResolveFindingInputSchema.parse(input);
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/draft/findings/${encodeURIComponent(findingId)}/resolve`, body }, DraftSchema);
      },
      get(input: { jobId: Id }): Promise<Draft> {
        const parsed = z.object({ jobId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: `/api/jobs/${encodeURIComponent(parsed.jobId)}/draft` }, DraftSchema);
      },
      save(input: SaveDraftInput): Promise<Draft> {
        const { jobId, ...body } = SaveDraftInputSchema.parse(input);
        return call({ method: "PUT", path: `/api/jobs/${encodeURIComponent(jobId)}/draft`, body }, DraftSchema);
      },
      decideProposal(input: DecideProposalInput): Promise<Draft> {
        const { jobId, proposalId, ...body } = DecideProposalInputSchema.parse(input);
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/draft/proposals/${encodeURIComponent(proposalId)}/decision`, body }, DraftSchema);
      },
      review(input: ReviewDraftInput): Promise<Draft> {
        const { jobId, ...body } = ReviewDraftInputSchema.parse(input);
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/draft/reviews`, body }, DraftSchema);
      },
    },
    releases: {
      publish(input: PublishReleaseInput): Promise<Release> {
        const { jobId, idempotencyKey, ...body } = PublishReleaseInputSchema.parse(input);
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/publish`, headers: idempotencyHeaders(idempotencyKey), body }, ReleaseSchema);
      },
      get(input: { releaseId: Id }): Promise<ReleaseView> {
        const parsed = z.object({ releaseId: IdSchema }).strict().parse(input);
        return call({ method: "GET", path: `/api/releases/${encodeURIComponent(parsed.releaseId)}` }, ReleaseViewSchema);
      },
      followReplacement(input: FollowReplacementInput): Promise<ReleaseView> {
        const { releaseId, replacementReleaseId } = FollowReplacementInputSchema.parse(input);
        return call({ method: "POST", path: `/api/releases/${encodeURIComponent(releaseId)}/follow-replacement`, body: { replacementReleaseId } }, ReleaseViewSchema);
      },
      createShareLink(input: CreateShareLinkInput): Promise<CreateShareLinkResult> {
        const { releaseId, idempotencyKey } = CreateShareLinkInputSchema.parse(input);
        return call({ method: "POST", path: `/api/releases/${encodeURIComponent(releaseId)}/share-links`, headers: idempotencyHeaders(idempotencyKey) }, CreateShareLinkResultSchema);
      },
      revokeShareLink(input: RevokeShareLinkInput): Promise<RevokeShareLinkResult> {
        const { releaseId, linkId } = RevokeShareLinkInputSchema.parse(input);
        return call({ method: "DELETE", path: `/api/releases/${encodeURIComponent(releaseId)}/share-links/${encodeURIComponent(linkId)}` }, RevokeShareLinkResultSchema);
      },
    },
    questions: {
      ask(input: AskQuestionInput): Promise<Answer> {
        const body = AskQuestionInputSchema.parse(input);
        return call({ method: "POST", path: "/api/questions", body }, AnswerSchema);
      },
    },
    flags: {
      suggestReply(input: { jobId: Id; flagId: Id; expectedVersion: number }): Promise<FlagReplySuggestion> {
        const jobId = IdSchema.parse(input.jobId);
        const body = SuggestFlagReplyBodySchema.parse({ flagId: input.flagId, expectedVersion: input.expectedVersion });
        return call({ method: "POST", path: `/api/jobs/${encodeURIComponent(jobId)}/flags/suggest`, body }, FlagReplySuggestionSchema);
      },
      list(input: ListFlagsInput): Promise<Flag[]> {
        const parsed = ListFlagsInputSchema.parse(input);
        return call({ method: "GET", path: queryPath("/api/flags", parsed) }, z.array(FlagSchema));
      },
      create(input: CreateFlagInput): Promise<Flag> {
        const { idempotencyKey, ...body } = CreateFlagInputSchema.parse(input);
        return call({ method: "POST", path: "/api/flags", headers: idempotencyHeaders(idempotencyKey), body }, FlagSchema);
      },
      respond(input: RespondToFlagInput): Promise<Flag> {
        const { flagId, ...body } = RespondToFlagInputSchema.parse(input);
        return call({ method: "POST", path: `/api/flags/${encodeURIComponent(flagId)}/response`, body }, FlagSchema);
      },
      acknowledge(input: AcknowledgeFlagInput): Promise<Flag> {
        const { flagId, ...body } = AcknowledgeFlagInputSchema.parse(input);
        return call({ method: "POST", path: `/api/flags/${encodeURIComponent(flagId)}/acknowledge`, body }, FlagSchema);
      },
    },
  };
}

// The default client uses real same-origin API routes and private upload URLs.
// Missing handlers fail explicitly; local fixtures never become application state.
export const api = createApiClient(createFetchApiTransport());
export type ApiClient = ReturnType<typeof createApiClient>;
