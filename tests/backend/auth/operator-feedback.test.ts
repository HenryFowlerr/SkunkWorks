import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ids, openFlag, releaseContext } from '../../contracts/fixtures';
import { DomainError } from '@/server/domain/errors';

const mocks = vi.hoisted(() => ({ getJobApiContext: vi.fn(), assertReleaseFeedbackContext: vi.fn(), claimIdempotency: vi.fn(), recordReleaseQuestion: vi.fn(), createMemberReleaseFlag: vi.fn(), getFlagForRelease: vi.fn() }));

vi.mock('@/server/api/context', () => ({ getJobApiContext: mocks.getJobApiContext }));

import { POST as askQuestion } from '@/app/api/questions/route';
import { POST as createFlag } from '@/app/api/flags/route';

const url = 'https://chappe.example';
const claim = { state: 'claimed', recordId: ids.generation, claimToken: ids.review };
const answer = {
  id: ids.review,
  context: releaseContext,
  evidenceState: 'not_found',
  text: 'Chappe has not verified an answer from this release.',
  evidence: [],
  suggestedFlag: 'Please clarify this operation.',
};

function request(path: string, body: unknown, key = 'floor-feedback-key-0001') {
  return new Request(url + path, {
    method: 'POST',
    headers: { origin: url, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getJobApiContext.mockResolvedValue({ repository: mocks, actor: { displayName: 'Floor member' } });
  mocks.claimIdempotency.mockResolvedValue(claim);
  mocks.recordReleaseQuestion.mockResolvedValue(answer);
  mocks.createMemberReleaseFlag.mockResolvedValue(openFlag);
  mocks.getFlagForRelease.mockResolvedValue(openFlag);
});

describe('member feedback routes', () => {
  it('records an uncertain release question with a reusable idempotency key', async () => {
    const response = await askQuestion(request('/api/questions', { context: releaseContext, question: 'Which face is the reference side?' }));
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ data: answer });
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job);
    expect(mocks.claimIdempotency).toHaveBeenCalledWith(expect.objectContaining({ operation: 'question.ask', key: 'floor-feedback-key-0001' }));
    expect(mocks.recordReleaseQuestion).toHaveBeenCalledWith(expect.objectContaining({ context: releaseContext, idempotencyRecordId: ids.generation }));
  });

  it('replays a completed question without recording it twice', async () => {
    mocks.claimIdempotency.mockResolvedValue({ state: 'completed', response: answer, resourceId: answer.id });
    const response = await askQuestion(request('/api/questions', { context: releaseContext, question: 'Which face is the reference side?' }));
    expect(response.status).toBe(201);
    expect(mocks.recordReleaseQuestion).not.toHaveBeenCalled();
  });

  it('creates a release-scoped flag and rejects an unavailable photo before claiming', async () => {
    const body = { context: releaseContext, question: 'The orientation is unclear.', photoAssetIds: [] };
    const response = await createFlag(request('/api/flags', body));
    expect(response.status).toBe(201);
    expect(mocks.createMemberReleaseFlag).toHaveBeenCalledWith(expect.objectContaining({ context: releaseContext, displayName: 'Floor member' }));

    vi.clearAllMocks();
    const withPhoto = await createFlag(request('/api/flags', { ...body, photoAssetIds: [ids.asset] }));
    expect(withPhoto.status).toBe(415);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
  });

  it('rejects cross-origin feedback before touching the workspace', async () => {
    const crossOrigin = new Request(url + '/api/questions', {
      method: 'POST',
      headers: { origin: 'https://other.example', 'content-type': 'application/json', 'idempotency-key': 'floor-feedback-key-0001' },
      body: JSON.stringify({ context: releaseContext, question: 'Which face is the reference side?' }),
    });
    const response = await askQuestion(crossOrigin);
    expect(response.status).toBe(403);
    expect(mocks.getJobApiContext).not.toHaveBeenCalled();
  });

  it('rejects a stale or mismatched step before claiming the request key', async () => {
    mocks.assertReleaseFeedbackContext.mockRejectedValue(new DomainError('VALIDATION_FAILED', 'The step is not part of this release.'));
    const response = await createFlag(request('/api/flags', {
      context: { ...releaseContext, stepId: ids.finding },
      question: 'Which orientation is approved?',
      photoAssetIds: [],
    }));
    expect(response.status).toBe(400);
    expect(mocks.claimIdempotency).not.toHaveBeenCalled();
  });
});
