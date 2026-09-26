import { beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseView, ids } from '../../contracts/fixtures';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  jobContext: vi.fn(),
  config: vi.fn(),
  service: vi.fn(),
  rpc: vi.fn(),
  cookies: vi.fn(),
}));
vi.mock('@/lib/auth/request-identity', () => ({ getVerifiedRequestIdentity: mocks.identity }));
vi.mock('@/server/api/context', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getJobApiContext: mocks.jobContext,
}));
vi.mock('@/server/auth/service-client', () => ({
  getSupabasePrivilegedConfig: mocks.config,
  createSupabaseServiceClient: mocks.service,
}));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));

import { GET as list, POST as issue } from '@/app/api/releases/[id]/share-links/route';
import { DELETE as revoke } from '@/app/api/releases/[id]/share-links/[linkId]/route';
import { GET as exchange } from '@/app/access/[token]/route';
import { GET as read } from '@/app/api/releases/[id]/route';
import { GET as assetLink } from '@/app/api/assets/[id]/link/route';
import { deriveReleaseLinkToken, hashReleaseToken, VISITOR_COOKIE } from '@/server/auth/release-token';
import { ApiFault } from '@/server/http/api';

const origin = 'https://chappe.example';
const key = 'release-issue-0001';
const secret = 'service-test-secret';
const linkId = ids.flag;
const token = deriveReleaseLinkToken({ secret, actorId: releaseView.actor.id, releaseId: ids.release, idempotencyKey: key });
const context = { params: Promise.resolve({ id: ids.release }) };
const linkContext = { params: Promise.resolve({ id: ids.release, linkId }) };

function memberQuery(jobId: string | null = ids.job) {
  return { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: jobId ? { job_id: jobId } : null, error: null })) })) })) })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockReturnValue({ serviceRoleKey: secret });
  mocks.identity.mockResolvedValue({ supabase: memberQuery() });
  mocks.jobContext.mockResolvedValue({
    actor: releaseView.actor,
    repository: { getRelease: vi.fn(async () => releaseView.release) },
  });
  mocks.service.mockReturnValue({ rpc: mocks.rpc });
  mocks.cookies.mockResolvedValue({ get: vi.fn(() => undefined) });
});

describe('scoped release QR access', () => {
  it('issues a repeatable token only after member scope and stores only its digest', async () => {
    mocks.rpc.mockResolvedValue({ data: { linkId }, error: null });
    const response = await issue(new Request(`${origin}/api/releases/${ids.release}/share-links`, {
      method: 'POST', headers: { origin, 'idempotency-key': key },
    }), context);
    expect(response.status).toBe(201);
    expect((await response.json()).data.accessUrl).toBe(`${origin}/access/${token}`);
    expect(mocks.jobContext).toHaveBeenCalledWith(ids.job, ['designer']);
    expect(mocks.rpc).toHaveBeenCalledWith('issue_release_access_link_internal', {
      p_release_id: ids.release, p_actor_id: releaseView.actor.id, p_token_hash: hashReleaseToken(token),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });

  it('rejects cross-site issue and unauthorised revocation before privileged write', async () => {
    const badOrigin = new Request(`${origin}/api/releases/${ids.release}/share-links`, {
      method: 'POST', headers: { origin: 'https://attacker.example', 'idempotency-key': key },
    });
    expect((await issue(badOrigin, context)).status).toBe(403);
    mocks.jobContext.mockRejectedValue(new ApiFault('FORBIDDEN', 'No designer role.'));
    expect((await revoke(new Request(`${origin}/api/releases/${ids.release}/share-links/${linkId}`, {
      method: 'DELETE', headers: { origin },
    }), linkContext)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('revokes the exact release link through a designer scoped operation', async () => {
    const revokedAt = '2026-09-26T04:30:00Z';
    mocks.rpc.mockResolvedValue({ data: { linkId, revokedAt }, error: null });
    const response = await revoke(new Request(`${origin}/api/releases/${ids.release}/share-links/${linkId}`, {
      method: 'DELETE', headers: { origin },
    }), linkContext);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ linkId, revokedAt });
    expect(mocks.rpc).toHaveBeenCalledWith('revoke_release_access_link_internal', {
      p_release_id: ids.release, p_link_id: linkId, p_actor_id: releaseView.actor.id,
    });
  });

  it('lists link IDs for revocation without returning bearer tokens', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ linkId, createdAt: '2026-09-26T04:00:00Z', revokedAt: null }], error: null });
    const response = await list(new Request(`${origin}/api/releases/${ids.release}/share-links`), context);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain(token);
    expect(mocks.rpc).toHaveBeenCalledWith('list_release_access_links_internal', {
      p_release_id: ids.release, p_actor_id: releaseView.actor.id,
    });
  });

  it('exchanges the bearer into an HttpOnly cookie and strips it from the destination', async () => {
    mocks.rpc.mockResolvedValue({ data: { releaseId: ids.release, expiresAt: '2026-09-27T00:00:00Z' }, error: null });
    const response = await exchange(new Request(`${origin}/access/${token}`), { params: Promise.resolve({ token }) });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${origin}/floor/${ids.release}`);
    expect(response.headers.get('set-cookie')).toContain(`${VISITOR_COOKIE}=`);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('location')).not.toContain(token);
    expect(mocks.rpc).toHaveBeenCalledWith('exchange_release_access_link_internal', expect.objectContaining({
      p_token_hash: hashReleaseToken(token), p_session_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it('does not issue a session for malformed or revoked QR links', async () => {
    expect((await exchange(new Request(`${origin}/access/invalid`), { params: Promise.resolve({ token: 'invalid' }) })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'RELEASE_REVOKED' } });
    expect((await exchange(new Request(`${origin}/access/${token}`), { params: Promise.resolve({ token }) })).status).toBe(410);
  });

  it('accepts only an exact visitor release grant after session validation', async () => {
    mocks.identity.mockRejectedValue(new ApiFault('UNAUTHENTICATED', 'Sign in to continue.'));
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: token })) });
    mocks.service.mockReturnValue({
      rpc: mocks.rpc,
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) })) })),
    });
    mocks.rpc.mockResolvedValue({ data: {
      sessionId: ids.visitor,
      displayName: 'Shop floor visitor',
      job: releaseView.job,
      release: releaseView.release,
      sourceAssets: releaseView.sourceAssets,
    }, error: null });
    const response = await read(new Request(`${origin}/api/releases/${ids.release}`), context);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.actor.kind).toBe('release_visitor');
    expect(payload.data.permissions.canRespond).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith('read_release_visitor_scope_internal', {
      p_release_id: ids.release, p_session_hash: hashReleaseToken(token),
    });
  });

  it('issues a short-lived source URL only after the visitor asset allow-list check', async () => {
    mocks.identity.mockRejectedValue(new ApiFault('UNAUTHENTICATED', 'Sign in to continue.'));
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: token })) });
    const signed = vi.fn(async () => ({ data: { signedUrl: `${origin}/storage/signed-source` }, error: null }));
    mocks.service.mockReturnValue({
      rpc: mocks.rpc,
      storage: { from: vi.fn(() => ({ createSignedUrl: signed })) },
    });
    mocks.rpc.mockResolvedValueOnce({ data: { objectKey: 'workspaces/scope/assets/source/blob' }, error: null });
    const response = await assetLink(new Request(`${origin}/api/assets/${ids.asset}/link`), {
      params: Promise.resolve({ id: ids.asset }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data.url).toBe(`${origin}/storage/signed-source`);
    expect(mocks.rpc).toHaveBeenCalledWith('read_release_visitor_asset_internal', {
      p_asset_id: ids.asset, p_session_hash: hashReleaseToken(token),
    });
    expect(signed).toHaveBeenCalledWith('workspaces/scope/assets/source/blob', 300);

    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'FORBIDDEN' } });
    const denied = await assetLink(new Request(`${origin}/api/assets/${ids.asset}/link`), {
      params: Promise.resolve({ id: ids.asset }),
    });
    expect(denied.status).toBe(403);
    expect(signed).toHaveBeenCalledTimes(1);
  });
});
