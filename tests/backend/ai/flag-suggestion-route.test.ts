import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFault } from "@/server/http/api";
import { ids, openFlag, releaseContext } from "../../contracts/fixtures";
const mocks = vi.hoisted(() => ({
  context: vi.fn(), list: vi.fn(), load: vi.fn(), suggest: vi.fn(),
  assertFloorRequestQuotaAvailable: vi.fn(), consumeFloorRequestQuota: vi.fn(),
  getCachedFloorReport: vi.fn(), getOrCreateFloorReport: vi.fn(),
}));
vi.mock("@/server/api/context", async (original) => ({
  ...await original<typeof import('@/server/api/context')>(), getJobApiContext: mocks.context,
}));
vi.mock("@/server/api/load-question-input", () => ({ loadQuestionInput: mocks.load }));
vi.mock("@/server/ai", () => ({ createAiAdapter: () => ({ suggestEngineerReply: mocks.suggest }) }));
vi.mock("@/server/ai/floor-guardrails", () => ({
  assertFloorRequestQuotaAvailable: mocks.assertFloorRequestQuotaAvailable,
  consumeFloorRequestQuota: mocks.consumeFloorRequestQuota,
}));
vi.mock("@/server/ai/floor-report-cache", () => ({
  getCachedFloorReport: mocks.getCachedFloorReport,
  getOrCreateFloorReport: mocks.getOrCreateFloorReport,
}));
import { POST } from "@/app/api/jobs/[id]/flags/suggest/route";
const route = { params: Promise.resolve({ id: ids.job }) };
function request(body: object = { flagId: ids.flag, expectedVersion: 1 }, origin = 'https://chappe.example') {
  return new Request(`https://chappe.example/api/jobs/${ids.job}/flags/suggest`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({
    actor: { id: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd" },
    repository: { listFlags: mocks.list },
  });
  mocks.list.mockResolvedValue([openFlag]);
  mocks.getCachedFloorReport.mockReturnValue(null);
  mocks.getOrCreateFloorReport.mockImplementation(async (_key: unknown, create: () => Promise<unknown>) => create());
  mocks.load.mockResolvedValue({ context: releaseContext, question: openFlag.question });
  mocks.suggest.mockResolvedValue({ id: ids.flag, context: releaseContext, evidenceState: 'not_found',
    text: 'Ask engineering to confirm. Hold the affected work.', evidence: [], suggestedFlag: null, model: 'test' });
});
describe('engineer reply proposal', () => {
  it('uses the persisted issue with designer authorization and returns only a draft', async () => {
    const response = await POST(request(), route);
    expect(response.status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith(ids.job, ['designer']);
    expect(mocks.assertFloorRequestQuotaAvailable).toHaveBeenCalledWith({
      actorId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd", jobId: ids.job, action: "engineer_report",
    });
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), { context: openFlag.context, question: openFlag.question });
    expect(mocks.consumeFloorRequestQuota).toHaveBeenCalledWith({
      actorId: "f0a7e622-c0e0-4d6e-a9bb-1b86e991d0fd", jobId: ids.job, action: "engineer_report",
    });
    expect(mocks.getOrCreateFloorReport).toHaveBeenCalledWith({
      jobId: ids.job, flagId: ids.flag, flagVersion: openFlag.version,
    }, expect.any(Function));
    expect(await response.json()).toMatchObject({ data: { flagId: ids.flag, flagVersion: 1, approvalState: 'draft', promptVersion: 'engineer-reply.v1' } });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('rejects stale issues before invoking AI', async () => {
    expect((await POST(request({ flagId: ids.flag, expectedVersion: 99 }), route)).status).toBe(409);
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it('returns a retryable 429 before loading evidence or invoking Luna when the report quota is exhausted', async () => {
    mocks.assertFloorRequestQuotaAvailable.mockImplementation(() => {
      throw new ApiFault('RATE_LIMITED', 'Luna report requests are temporarily limited.', {
        retryable: true, retryAfterSeconds: 60,
      });
    });
    const response = await POST(request(), route);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'RATE_LIMITED', retryable: true } });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it('reuses an exact cached report without spending another Luna request', async () => {
    const cached = {
      flagId: ids.flag,
      flagVersion: openFlag.version,
      approvalState: 'draft' as const,
      promptVersion: 'engineer-reply.v1',
      answer: { id: ids.flag, context: releaseContext, evidenceState: 'not_found' as const, text: 'Hold for engineering.', evidence: [], suggestedFlag: null },
    };
    mocks.getCachedFloorReport.mockReturnValue(Promise.resolve(cached));

    const response = await POST(request(), route);

    expect(response.status).toBe(200);
    expect(mocks.assertFloorRequestQuotaAvailable).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.consumeFloorRequestQuota).not.toHaveBeenCalled();
    expect(mocks.suggest).not.toHaveBeenCalled();
  });
  it('discards the proposal if an engineer answered during generation', async () => {
    mocks.list.mockResolvedValueOnce([openFlag]).mockResolvedValueOnce([{ ...openFlag, version: 2, status: 'responded' }]);
    expect((await POST(request(), route)).status).toBe(409);
  });
  it('cannot use an issue from another part or caller-supplied source text', async () => {
    mocks.list.mockResolvedValue([{ ...openFlag, context: { ...openFlag.context, jobId: ids.asset } }]);
    expect((await POST(request(), route)).status).toBe(404);
    expect((await POST(request({ flagId: ids.flag, expectedVersion: 1, sources: ['invented'] }), route)).status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('rejects foreign origins and unauthorized members without source access', async () => {
    expect((await POST(request(undefined, 'https://other.example'), route)).status).toBe(403);
    mocks.context.mockRejectedValue(new ApiFault('FORBIDDEN', 'Engineering access required.'));
    expect((await POST(request(), route)).status).toBe(403);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
