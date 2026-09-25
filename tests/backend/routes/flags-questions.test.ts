import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getJobApiContext,
  getWorkspaceApiContext,
  parseRouteId,
  getVerifiedRequestIdentity,
  createSupabaseServiceClient,
  getSupabasePrivilegedConfig,
  resolveVisitorReleaseScope,
  resolveVisitorFlagScope,
  createVisitorReleaseRepository,
  readVisitorSessionToken,
  loadTrustedPdfEvidence,
  createAiAdapter,
  createPrivateStorageAdapter,
  validateContext,
} = vi.hoisted(() => ({
  getJobApiContext: vi.fn(),
  getWorkspaceApiContext: vi.fn(),
  parseRouteId: vi.fn((value: string) => value),
  getVerifiedRequestIdentity: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  getSupabasePrivilegedConfig: vi.fn(),
  resolveVisitorReleaseScope: vi.fn(),
  resolveVisitorFlagScope: vi.fn(),
  createVisitorReleaseRepository: vi.fn(),
  readVisitorSessionToken: vi.fn().mockReturnValue(null),
  loadTrustedPdfEvidence: vi.fn(),
  createAiAdapter: vi.fn(),
  createPrivateStorageAdapter: vi.fn(),
  validateContext: vi.fn((context: unknown) => context),
}));

vi.mock("@/server/api/context", () => ({ getJobApiContext, getWorkspaceApiContext, parseRouteId }));
vi.mock("@/lib/auth/request-identity", () => ({ getVerifiedRequestIdentity }));
vi.mock("@/server/auth/service-client", () => ({ createSupabaseServiceClient, getSupabasePrivilegedConfig }));
vi.mock("@/server/data/tokens", () => ({ resolveVisitorReleaseScope, resolveVisitorFlagScope }));
vi.mock("@/server/data/visitor", () => ({ createVisitorReleaseRepository }));
vi.mock("@/server/access/visitor-cookie", () => ({ readVisitorSessionToken }));
vi.mock("@/server/api/generation", () => ({ loadTrustedPdfEvidence }));
vi.mock("@/server/ai", () => ({ createAiAdapter }));
vi.mock("@/server/data/storage", () => ({ createPrivateStorageAdapter }));
vi.mock("@/server/domain/contexts", () => ({ validateContext }));

import { GET } from "@/app/api/flags/route";
import { POST as createFlag } from "@/app/api/flags/route";
import { POST as respondToFlag } from "@/app/api/flags/[flagId]/response/route";
import { POST as acknowledgeFlag } from "@/app/api/flags/[flagId]/acknowledge/route";
import { POST as askQuestion } from "@/app/api/questions/route";
import { AiProviderError } from "@/server/ai/types";

const flags = [{ id: "flag-1", context: { releaseId: "10000000-0000-4000-8000-000000000001" } }];

function request(query: string) {
  return new Request(`https://skunkworks.example/api/flags${query}`);
}

function jsonRequest(path: string, body: unknown, options: { cookie?: string; idempotencyKey?: string } = {}) {
  return new Request(`https://skunkworks.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://skunkworks.example",
      "content-type": "application/json",
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("flag API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSupabaseServiceClient.mockReturnValue({});
    getSupabasePrivilegedConfig.mockReturnValue({});
    readVisitorSessionToken.mockReturnValue(null);
    validateContext.mockImplementation((context) => context);
  });

  it("requires exactly one filter before touching persistence", async () => {
    const response = await GET(request(""));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_FAILED" },
      meta: { contractVersion: "1.0" },
    });
    expect(getJobApiContext).not.toHaveBeenCalled();
    expect(getWorkspaceApiContext).not.toHaveBeenCalled();
  });

  it("lists a job's flags through the verified workspace repository", async () => {
    const repository = { listFlags: vi.fn().mockResolvedValue(flags) };
    getJobApiContext.mockResolvedValue({ repository, actor: { kind: "member" } });

    const response = await GET(request("?jobId=10000000-0000-4000-8000-000000000002"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: flags, meta: { contractVersion: "1.0" } });
    expect(getJobApiContext).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000002");
    expect(repository.listFlags).toHaveBeenCalledWith({ jobId: "10000000-0000-4000-8000-000000000002" });
  });

  it("resolves a release under the caller's RLS session before listing flags", async () => {
    const releaseId = "10000000-0000-4000-8000-000000000001";
    const repository = { listFlags: vi.fn().mockResolvedValue(flags) };
    const maybeSingle = vi.fn().mockResolvedValue({ data: { workspace_id: "10000000-0000-4000-8000-000000000003" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };
    getVerifiedRequestIdentity.mockResolvedValue({ supabase });
    getWorkspaceApiContext.mockResolvedValue({ repository, actor: { kind: "member" } });

    const response = await GET(request(`?releaseId=${releaseId}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: flags });
    expect(supabase.from).toHaveBeenCalledWith("releases");
    expect(getWorkspaceApiContext).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000003");
    expect(repository.listFlags).toHaveBeenCalledWith({ releaseId });
  });

  it("uses only the visitor's exact release scope when listing floor flags", async () => {
    const releaseId = "10000000-0000-4000-8000-000000000001";
    const repository = { listFlags: vi.fn().mockResolvedValue(flags) };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000004",
      releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000005",
      displayName: "Visitor",
      jobId: "10000000-0000-4000-8000-000000000002",
      workspaceId: "10000000-0000-4000-8000-000000000003",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });
    createVisitorReleaseRepository.mockReturnValue(repository);

    const response = await GET(request(`?releaseId=${releaseId}`));
    expect(response.status).toBe(200);
    expect(resolveVisitorReleaseScope).toHaveBeenCalledWith(expect.objectContaining({
      sessionToken: "visitor-session-token",
      releaseId,
    }));
    expect(createVisitorReleaseRepository).toHaveBeenCalledWith(expect.objectContaining({ sessionId: expect.any(String), releaseId }));
    expect(repository.listFlags).toHaveBeenCalledWith();
    expect(getVerifiedRequestIdentity).not.toHaveBeenCalled();
  });

  it("creates a member flag with the header idempotency key under verified workspace membership", async () => {
    const repository = {
      getRelease: vi.fn().mockResolvedValue({ id: "10000000-0000-4000-8000-000000000001", jobId: "10000000-0000-4000-8000-000000000002" }),
      createFlag: vi.fn().mockResolvedValue(flags[0]),
    };
    getJobApiContext.mockResolvedValue({ repository, actor: { kind: "member" } });
    const context = {
      jobId: "10000000-0000-4000-8000-000000000002",
      releaseId: "10000000-0000-4000-8000-000000000001",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };

    const response = await createFlag(jsonRequest("/api/flags", {
      context,
      question: "Please confirm the bend sequence.",
      photoAssetIds: [],
    }, { idempotencyKey: "flag-create-key-0001" }));
    expect(response.status).toBe(200);
    expect(getJobApiContext).toHaveBeenCalledWith(context.jobId);
    expect(repository.getRelease).toHaveBeenCalledWith(context.releaseId);
    expect(repository.createFlag).toHaveBeenCalledWith({
      context,
      question: "Please confirm the bend sequence.",
      photoAssetIds: [],
      idempotencyKey: "flag-create-key-0001",
    });
  });

  it("creates a visitor flag only in the exact live release and forwards idempotency", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000002",
      releaseId: "10000000-0000-4000-8000-000000000001",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    const sessionId = "10000000-0000-4000-8000-000000000004";
    const repository = {
      getRelease: vi.fn().mockResolvedValue({ id: context.releaseId, jobId: context.jobId }),
      createFlag: vi.fn().mockResolvedValue(flags[0]),
    };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({ sessionId, releaseId: context.releaseId, jobId: context.jobId });
    createVisitorReleaseRepository.mockReturnValue(repository);

    const response = await createFlag(jsonRequest("/api/flags", {
      context,
      question: "Please check this flange before the next operation.",
      photoAssetIds: [],
    }, { cookie: "skw_visitor_session=visitor-session-token", idempotencyKey: "visitor-flag-create-key-01" }));

    expect(response.status).toBe(200);
    expect(resolveVisitorReleaseScope).toHaveBeenCalledWith(expect.objectContaining({
      sessionToken: "visitor-session-token",
      releaseId: context.releaseId,
    }));
    expect(repository.createFlag).toHaveBeenCalledWith({
      context,
      question: "Please check this flange before the next operation.",
      photoAssetIds: [],
      idempotencyKey: "visitor-flag-create-key-01",
    });
    expect(getJobApiContext).not.toHaveBeenCalled();
  });

  it("does not create a visitor flag when its job differs from the release grant", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000099",
      releaseId: "10000000-0000-4000-8000-000000000001",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000004",
      releaseId: context.releaseId,
      jobId: "10000000-0000-4000-8000-000000000002",
    });

    const response = await createFlag(jsonRequest("/api/flags", {
      context,
      question: "Please check this flange.",
      photoAssetIds: [],
    }, { cookie: "skw_visitor_session=visitor-session-token", idempotencyKey: "visitor-flag-create-key-02" }));

    expect(response.status).toBe(404);
    expect(createVisitorReleaseRepository).not.toHaveBeenCalled();
    expect(getJobApiContext).not.toHaveBeenCalled();
  });

  it("resolves member response scope through RLS and enforces designer membership", async () => {
    const flagId = "10000000-0000-4000-8000-000000000006";
    const repository = { respondToFlag: vi.fn().mockResolvedValue(flags[0]) };
    const maybeSingle = vi.fn().mockResolvedValue({ data: { workspace_id: "10000000-0000-4000-8000-000000000003" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };
    getVerifiedRequestIdentity.mockResolvedValue({ supabase });
    getWorkspaceApiContext.mockResolvedValue({ repository, actor: { kind: "member", roles: ["designer"] } });

    const response = await respondToFlag(jsonRequest(`/api/flags/${flagId}/response`, {
      expectedVersion: 1,
      text: "Use the replacement release.",
      kind: "replacement_release",
      replacementReleaseId: "10000000-0000-4000-8000-000000000007",
    }), { params: Promise.resolve({ flagId }) });
    expect(response.status).toBe(200);
    expect(getWorkspaceApiContext).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000003", ["designer"]);
    expect(repository.respondToFlag).toHaveBeenCalledWith({
      flagId,
      expectedVersion: 1,
      text: "Use the replacement release.",
      kind: "replacement_release",
      replacementReleaseId: "10000000-0000-4000-8000-000000000007",
    });
  });

  it("does not write a response when the active member lacks designer permission", async () => {
    const flagId = "10000000-0000-4000-8000-000000000006";
    const maybeSingle = vi.fn().mockResolvedValue({ data: { workspace_id: "10000000-0000-4000-8000-000000000003" }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const supabase = { from: vi.fn().mockReturnValue({ select }) };
    getVerifiedRequestIdentity.mockResolvedValue({ supabase });
    getWorkspaceApiContext.mockRejectedValue(Object.assign(new Error("Designer role required."), {
      name: "DataAdapterError",
      code: "FORBIDDEN",
    }));

    const response = await respondToFlag(jsonRequest(`/api/flags/${flagId}/response`, {
      expectedVersion: 1,
      text: "Clarification.",
      kind: "explanation",
      replacementReleaseId: null,
    }), { params: Promise.resolve({ flagId }) });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
  });

  it("requires a resolved visitor flag scope before acknowledging", async () => {
    const flagId = "10000000-0000-4000-8000-000000000006";
    const repository = { acknowledgeFlag: vi.fn().mockResolvedValue(flags[0]) };
    const releaseId = "10000000-0000-4000-8000-000000000001";
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorFlagScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000004",
      releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000005",
      displayName: "Visitor",
      jobId: "10000000-0000-4000-8000-000000000002",
      workspaceId: "10000000-0000-4000-8000-000000000003",
      expiresAt: "2026-09-26T00:00:00.000Z",
      flagId,
    });
    createVisitorReleaseRepository.mockReturnValue(repository);

    const response = await acknowledgeFlag(jsonRequest(`/api/flags/${flagId}/acknowledge`, {
      expectedVersion: 2,
    }, { cookie: "skw_visitor_session=visitor-session-token" }), { params: Promise.resolve({ flagId }) });
    expect(response.status).toBe(200);
    expect(resolveVisitorFlagScope).toHaveBeenCalledWith(expect.objectContaining({ sessionToken: "visitor-session-token", flagId }));
    expect(createVisitorReleaseRepository).toHaveBeenCalledWith(expect.objectContaining({ sessionId: expect.any(String), releaseId }));
    expect(repository.acknowledgeFlag).toHaveBeenCalledWith({ flagId, expectedVersion: 2 });
  });

  it("answers visitor questions from one release allow-list and persists with the question ID", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000002",
      releaseId: "10000000-0000-4000-8000-000000000001",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    const assetId = "10000000-0000-4000-8000-000000000008";
    const questionId = "10000000-0000-4000-8000-000000000009";
    const repository = {
      getRelease: vi.fn().mockResolvedValue({ id: context.releaseId, jobId: context.jobId, snapshot: {
        sourceAssetIds: [assetId], workshopSnapshotId: null, machineId: null, bends: [], steps: [],
      } }),
      listReleaseSourceAssets: vi.fn().mockResolvedValue([{ id: assetId }]),
      askQuestion: vi.fn().mockResolvedValue({ questionId, context, createdAt: "2026-09-26T00:00:00.000Z" }),
      persistQuestionAnswer: vi.fn().mockImplementation(({ answer }) => Promise.resolve(answer)),
    };
    const authorizedAsset = {
      bucketId: "skunkworks-private",
      objectKey: "private-key",
      asset: { id: assetId, jobId: context.jobId, releaseId: null, kind: "drawing_pdf", status: "ready" },
    };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000004",
      releaseId: context.releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000005",
      displayName: "Visitor",
      jobId: context.jobId,
      workspaceId: "10000000-0000-4000-8000-000000000003",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });
    createVisitorReleaseRepository.mockReturnValue(repository);
    createPrivateStorageAdapter.mockReturnValue({
      authorizeVisitorAsset: vi.fn().mockResolvedValue(authorizedAsset),
    });
    loadTrustedPdfEvidence.mockResolvedValue([{
      assetId,
      filename: "drawing.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1]),
      pageCount: 1,
      pages: [{ page: 1, text: "Drawing note." }],
    }]);
    const answer = {
      id: "10000000-0000-4000-8000-000000000010",
      context,
      evidenceState: "not_found",
      text: "The supplied release does not establish that detail.",
      evidence: [],
      suggestedFlag: null,
    };
    createAiAdapter.mockReturnValue({ answerQuestion: vi.fn().mockResolvedValue({ ...answer, model: "test" }) });

    const response = await askQuestion(jsonRequest("/api/questions", {
      context,
      question: "What is the exact angle?",
    }, {
      cookie: "skw_visitor_session=visitor-session-token",
      idempotencyKey: "question-visitor-key-0001",
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { ...answer, id: questionId } });
    expect(resolveVisitorReleaseScope).toHaveBeenCalledWith(expect.objectContaining({
      sessionToken: "visitor-session-token",
      releaseId: context.releaseId,
    }));
    expect(repository.listReleaseSourceAssets).toHaveBeenCalledWith();
    expect(repository.askQuestion).toHaveBeenCalledWith({
      context,
      question: "What is the exact angle?",
      idempotencyKey: "question-visitor-key-0001",
    });
    expect(repository.persistQuestionAnswer).toHaveBeenCalledWith({
      questionId,
      answer: { ...answer, id: questionId },
      modelIdentifier: "test",
    });
  });

  it("answers a member question from the selected release source allow-list", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000032",
      releaseId: "10000000-0000-4000-8000-000000000031",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    const assetId = "10000000-0000-4000-8000-000000000033";
    const questionId = "10000000-0000-4000-8000-000000000034";
    const question = "What is shown in this drawing?";
    const idempotencyKey = "member-question-idempotency-01";
    const answer = {
      id: questionId,
      context,
      evidenceState: "not_found",
      text: "The drawing does not establish that detail.",
      evidence: [],
      suggestedFlag: null,
    };
    const repository = {
      getRelease: vi.fn().mockResolvedValue({ id: context.releaseId, jobId: context.jobId, snapshot: {
        sourceAssetIds: [assetId], workshopSnapshotId: null, machineId: null, bends: [], steps: [],
      } }),
      listReleaseSourceAssets: vi.fn().mockResolvedValue([{ id: assetId }]),
      authorizeMemberAsset: vi.fn().mockResolvedValue({
        bucketId: "skunkworks-private",
        objectKey: "member-private-key",
        asset: { id: assetId, jobId: context.jobId, releaseId: null, kind: "drawing_pdf", status: "ready" },
      }),
      askQuestion: vi.fn().mockResolvedValue({
        questionId,
        context,
        createdAt: "2026-09-26T00:00:00.000Z",
        answer: null,
      }),
      persistQuestionAnswer: vi.fn().mockResolvedValue(answer),
    };
    getJobApiContext.mockResolvedValue({ repository });
    createPrivateStorageAdapter.mockReturnValue({});
    loadTrustedPdfEvidence.mockResolvedValue([]);
    createAiAdapter.mockReturnValue({ answerQuestion: vi.fn().mockResolvedValue({ ...answer, model: "test" }) });

    const response = await askQuestion(jsonRequest("/api/questions", { context, question }, { idempotencyKey }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: answer });
    expect(getJobApiContext).toHaveBeenCalledWith(context.jobId);
    expect(repository.listReleaseSourceAssets).toHaveBeenCalledWith(context.releaseId);
    expect(repository.authorizeMemberAsset).toHaveBeenCalledWith(context.jobId, assetId);
    expect(repository.askQuestion).toHaveBeenCalledWith({ context, question, idempotencyKey });
    expect(repository.persistQuestionAnswer).toHaveBeenCalledWith({
      questionId,
      answer,
      modelIdentifier: "test",
    });
  });

  it("replays an idempotently saved answer without calling the provider again", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000022",
      releaseId: "10000000-0000-4000-8000-000000000021",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    const assetId = "10000000-0000-4000-8000-000000000023";
    const questionId = "10000000-0000-4000-8000-000000000024";
    const answer = {
      id: questionId,
      context,
      evidenceState: "not_found",
      text: "The supplied release does not establish that detail.",
      evidence: [],
      suggestedFlag: null,
    };
    const repository = {
      getRelease: vi.fn().mockResolvedValue({ id: context.releaseId, jobId: context.jobId, snapshot: {
        sourceAssetIds: [assetId], workshopSnapshotId: null, machineId: null, bends: [], steps: [],
      } }),
      listReleaseSourceAssets: vi.fn().mockResolvedValue([{ id: assetId }]),
      askQuestion: vi.fn().mockResolvedValue({
        questionId,
        context,
        createdAt: "2026-09-26T00:00:00.000Z",
        answer,
      }),
      persistQuestionAnswer: vi.fn(),
    };
    const authorizedAsset = {
      bucketId: "skunkworks-private",
      objectKey: "private-key",
      asset: { id: assetId, jobId: context.jobId, releaseId: null, kind: "drawing_pdf", status: "ready" },
    };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000025",
      releaseId: context.releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000026",
      displayName: "Visitor",
      jobId: context.jobId,
      workspaceId: "10000000-0000-4000-8000-000000000027",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });
    createVisitorReleaseRepository.mockReturnValue(repository);
    createPrivateStorageAdapter.mockReturnValue({
      authorizeVisitorAsset: vi.fn().mockResolvedValue(authorizedAsset),
    });
    loadTrustedPdfEvidence.mockResolvedValue([{
      assetId,
      filename: "drawing.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1]),
      pageCount: 1,
      pages: [{ page: 1, text: "Drawing note." }],
    }]);

    const response = await askQuestion(jsonRequest("/api/questions", {
      context,
      question: "What is the exact angle?",
    }, {
      cookie: "skw_visitor_session=visitor-session-token",
      idempotencyKey: "question-replay-key-0001",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: answer });
    expect(repository.askQuestion).toHaveBeenCalledWith({
      context,
      question: "What is the exact angle?",
      idempotencyKey: "question-replay-key-0001",
    });
    expect(loadTrustedPdfEvidence).not.toHaveBeenCalled();
    expect(createAiAdapter).not.toHaveBeenCalled();
    expect(repository.persistQuestionAnswer).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before creating a question receipt", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000002",
      releaseId: "10000000-0000-4000-8000-000000000001",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };

    const response = await askQuestion(jsonRequest("/api/questions", { context, question: "What is shown here?" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(resolveVisitorReleaseScope).not.toHaveBeenCalled();
    expect(getJobApiContext).not.toHaveBeenCalled();
  });

  it("leaves the same idempotent question unanswered when the provider fails", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000002",
      releaseId: "10000000-0000-4000-8000-000000000001",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    const questionId = "10000000-0000-4000-8000-000000000009";
    const question = "What is the exact angle?";
    const idempotencyKey = "question-provider-retry-key-01";
    const answer = {
      id: questionId,
      context,
      evidenceState: "not_found",
      text: "The supplied release does not establish that detail.",
      evidence: [],
      suggestedFlag: null,
    };
    const repository = {
      getRelease: vi.fn().mockResolvedValue({
        id: context.releaseId,
        jobId: context.jobId,
        snapshot: { sourceAssetIds: [], workshopSnapshotId: null, machineId: null, bends: [], steps: [] },
      }),
      listReleaseSourceAssets: vi.fn().mockResolvedValue([]),
      askQuestion: vi.fn().mockResolvedValue({
        questionId,
        context,
        createdAt: "2026-09-26T00:00:00.000Z",
      }),
      persistQuestionAnswer: vi.fn().mockResolvedValue(answer),
    };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000004",
      releaseId: context.releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000005",
      displayName: "Operator",
      jobId: context.jobId,
      workspaceId: "10000000-0000-4000-8000-000000000003",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });
    createVisitorReleaseRepository.mockReturnValue(repository);
    createPrivateStorageAdapter.mockReturnValue({});
    loadTrustedPdfEvidence.mockResolvedValue([]);
    const answerQuestion = vi.fn()
      .mockRejectedValueOnce(new AiProviderError("PROVIDER_UNAVAILABLE", { retryable: true }))
      .mockResolvedValue({ ...answer, model: "test" });
    createAiAdapter.mockReturnValue({ answerQuestion });

    const response = await askQuestion(jsonRequest("/api/questions", { context, question }, {
      cookie: "skw_visitor_session=visitor-session-token",
      idempotencyKey,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_UNAVAILABLE", retryable: true },
    });
    expect(repository.askQuestion).toHaveBeenCalledWith({ context, question, idempotencyKey });
    expect(repository.persistQuestionAnswer).not.toHaveBeenCalled();

    const retryResponse = await askQuestion(jsonRequest("/api/questions", { context, question }, {
      cookie: "skw_visitor_session=visitor-session-token",
      idempotencyKey,
    }));
    expect(retryResponse.status).toBe(200);
    await expect(retryResponse.json()).resolves.toMatchObject({ data: answer });
    expect(repository.askQuestion).toHaveBeenCalledTimes(2);
    expect(repository.askQuestion).toHaveBeenNthCalledWith(2, { context, question, idempotencyKey });
    expect(answerQuestion).toHaveBeenCalledTimes(2);
    expect(repository.persistQuestionAnswer).toHaveBeenCalledWith({
      questionId,
      answer,
      modelIdentifier: "test",
    });
  });

  it("returns a retryable rate-limit envelope without calling the model", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000042",
      releaseId: "10000000-0000-4000-8000-000000000041",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    const repository = {
      getRelease: vi.fn().mockResolvedValue({
        id: context.releaseId,
        jobId: context.jobId,
        snapshot: { sourceAssetIds: [], workshopSnapshotId: null, machineId: null, bends: [], steps: [] },
      }),
      listReleaseSourceAssets: vi.fn().mockResolvedValue([]),
      askQuestion: vi.fn().mockRejectedValue(Object.assign(new Error("Question limit reached."), {
        name: "DataAdapterError",
        code: "RATE_LIMITED",
      })),
    };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000044",
      releaseId: context.releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000045",
      displayName: "Operator",
      jobId: context.jobId,
      workspaceId: "10000000-0000-4000-8000-000000000043",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });
    createVisitorReleaseRepository.mockReturnValue(repository);
    createPrivateStorageAdapter.mockReturnValue({});

    const response = await askQuestion(jsonRequest("/api/questions", {
      context,
      question: "What is the exact bend angle?",
    }, {
      cookie: "skw_visitor_session=visitor-session-token",
      idempotencyKey: "question-rate-limit-key-01",
    }));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED", retryable: true },
    });
    expect(createAiAdapter).not.toHaveBeenCalled();
  });

  it("does not persist a visitor question when its claimed job differs from the granted release", async () => {
    const context = {
      jobId: "10000000-0000-4000-8000-000000000099",
      releaseId: "10000000-0000-4000-8000-000000000001",
      draftId: null,
      draftVersion: null,
      stepId: null,
      bendId: null,
    };
    readVisitorSessionToken.mockReturnValue("visitor-session-token");
    resolveVisitorReleaseScope.mockResolvedValue({
      sessionId: "10000000-0000-4000-8000-000000000004",
      releaseId: context.releaseId,
      accessLinkId: "10000000-0000-4000-8000-000000000005",
      displayName: "Visitor",
      jobId: "10000000-0000-4000-8000-000000000002",
      workspaceId: "10000000-0000-4000-8000-000000000003",
      expiresAt: "2026-09-26T00:00:00.000Z",
    });

    const response = await askQuestion(jsonRequest("/api/questions", { context, question: "What is the bend angle?" }, {
      cookie: "skw_visitor_session=visitor-session-token",
      idempotencyKey: "question-wrong-job-0001",
    }));
    expect(response.status).toBe(404);
    expect(createVisitorReleaseRepository).not.toHaveBeenCalled();
    expect(createAiAdapter).not.toHaveBeenCalled();
  });
});
