import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiFault } from '@/server/http/api';
import { ids, releaseView } from '../../contracts/fixtures';

const mocks = vi.hoisted(() => ({
  getVerifiedRequestIdentity: vi.fn(),
  getJobApiContext: vi.fn(),
}));

vi.mock('@/lib/auth/request-identity', () => ({ getVerifiedRequestIdentity: mocks.getVerifiedRequestIdentity }));
vi.mock('@/server/api/context', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/server/api/context')>(),
  getJobApiContext: mocks.getJobApiContext,
}));

import { GET as getRelease } from '@/app/api/releases/[id]/route';
import { GET as getFlags } from '@/app/api/flags/route';

const member = { id: ids.member, displayName: 'Workshop member', kind: 'member', roles: ['fabricator'] };

function releaseLookup() {
  const query = { maybeSingle: vi.fn().mockResolvedValue({ data: { job_id: ids.job }, error: null }) };
  const eq = vi.fn().mockReturnValue(query);
  const select = vi.fn().mockReturnValue({ eq });
  return { from: vi.fn().mockReturnValue({ select }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getVerifiedRequestIdentity.mockResolvedValue({ supabase: releaseLookup() });
  mocks.getJobApiContext.mockResolvedValue({
    actor: member,
    repository: {
      getJobBundle: vi.fn().mockResolvedValue({
        job: releaseView.job,
        assets: releaseView.sourceAssets,
        releases: [releaseView.release],
        draft: null,
      }),
      listFlags: vi.fn().mockResolvedValue([]),
    },
  });
});

describe('member-scoped operator reads', () => {
  it('returns only immutable release source assets with member feedback controls enabled', async () => {
    const response = await getRelease(new Request('https://chappe.example/api/releases/' + ids.release), {
      params: Promise.resolve({ id: ids.release }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: {
      release: { id: ids.release },
      sourceAssets: [{ id: ids.asset }],
      actor: { kind: 'member' },
      permissions: { canAsk: true, canFlag: true, canRespond: false },
    } });
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job);
  });

  it('does not load a release when workspace membership is denied', async () => {
    mocks.getJobApiContext.mockRejectedValue(new ApiFault('FORBIDDEN', 'No active workspace membership.'));
    const response = await getRelease(new Request('https://chappe.example/api/releases/' + ids.release), {
      params: Promise.resolve({ id: ids.release }),
    });
    expect(response.status).toBe(403);
  });

  it('checks a release through the session before listing its flags', async () => {
    const response = await getFlags(new Request('https://chappe.example/api/flags?releaseId=' + ids.release));
    expect(response.status).toBe(200);
    expect(mocks.getVerifiedRequestIdentity).toHaveBeenCalledOnce();
    expect(mocks.getJobApiContext).toHaveBeenCalledWith(ids.job);
  });
});
