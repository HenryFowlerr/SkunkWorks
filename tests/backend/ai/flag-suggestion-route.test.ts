import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiFault } from "@/server/http/api";
import { ids, openFlag, releaseContext } from "../../contracts/fixtures";
const mocks = vi.hoisted(() => ({ context: vi.fn(), list: vi.fn(), load: vi.fn(), suggest: vi.fn() }));
vi.mock("@/server/api/context", async (original) => ({
  ...await original<typeof import('@/server/api/context')>(), getJobApiContext: mocks.context,
}));
vi.mock("@/server/api/load-question-input", () => ({ loadQuestionInput: mocks.load }));
vi.mock("@/server/ai", () => ({ createAiAdapter: () => ({ suggestEngineerReply: mocks.suggest }) }));
import { POST } from "@/app/api/jobs/[id]/flags/suggest/route";
const route = { params: Promise.resolve({ id: ids.job }) };
function request(body: object = { flagId: ids.flag, expectedVersion: 1 }, origin = 'https://chappe.example') {
  return new Request(`https://chappe.example/api/jobs/${ids.job}/flags/suggest`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({ repository: { listFlags: mocks.list } });
  mocks.list.mockResolvedValue([openFlag]);
  mocks.load.mockResolvedValue({ context: releaseContext, question: openFlag.question });
  mocks.suggest.mockResolvedValue({ id: ids.flag, context: releaseContext, evidenceState: 'not_found',
    text: 'Ask engineering to confirm. Hold the affected work.', evidence: [], suggestedFlag: null, model: 'test' });
});
describe('engineer reply proposal', () => {
  it('uses the persisted issue with designer authorization and returns only a draft', async () => {
    const response = await POST(request(), route);
    expect(response.status).toBe(200);
    expect(mocks.context).toHaveBeenCalledWith(ids.job, ['designer']);
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), { context: openFlag.context, question: openFlag.question });
    expect(await response.json()).toMatchObject({ data: { flagId: ids.flag, flagVersion: 1, approvalState: 'draft', promptVersion: 'engineer-reply.v1' } });
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('rejects stale issues before invoking AI', async () => {
    expect((await POST(request({ flagId: ids.flag, expectedVersion: 99 }), route)).status).toBe(409);
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
