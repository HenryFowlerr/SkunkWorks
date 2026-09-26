import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiFault } from '@/server/http/api';
import { ids, sourceAsset } from '../../contracts/fixtures';
const mocks = vi.hoisted(() => ({ identity: vi.fn(), context: vi.fn(), authorize: vi.fn(), download: vi.fn(), extract: vi.fn() }));
vi.mock('@/lib/auth/request-identity', () => ({ getVerifiedRequestIdentity: mocks.identity }));
vi.mock('@/server/api/context', async original => ({ ...await original<typeof import('@/server/api/context')>(), getJobApiContext: mocks.context }));
vi.mock('@/server/auth/service-client', () => ({ createSupabaseServiceClient: () => ({ storage: { from: () => ({ download: mocks.download }) } }) }));
vi.mock('@/server/data/solidworks-preview', () => ({ extractSolidWorksPreview: mocks.extract }));
import { GET } from '@/app/api/assets/[id]/preview/route';
const bytes = Buffer.from('native source');
const params = { params: Promise.resolve({ id: ids.asset }) };
const request = new Request(`https://chappe.example/api/assets/${ids.asset}/preview`);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.identity.mockResolvedValue({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { workspace_id: ids.workspace, job_id: ids.job }, error: null }) }) }) }) } });
  mocks.context.mockResolvedValue({ repository: { workspaceId: ids.workspace, authorizeMemberAsset: mocks.authorize } });
  mocks.authorize.mockResolvedValue({ bucketId: 'skunkworks-private', objectKey: 'private/source', asset: { ...sourceAsset, kind: 'native_part', byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
  mocks.download.mockResolvedValue({ data: { size: bytes.length, arrayBuffer: async () => bytes }, error: null });
  mocks.extract.mockReturnValue({ bytes: Buffer.from('png'), width: 640, height: 480, section: 'PreviewPNG' });
});
describe('private native preview', () => {
  it('authorizes and verifies stored bytes before extracting a labelled no-store preview', async () => {
    const response = await GET(request, params);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authorize).toHaveBeenCalledWith(ids.job, ids.asset);
    expect(await response.json()).toMatchObject({ data: { mimeType: 'image/png', width: 640, label: expect.stringContaining('not verified manufacturing evidence') } });
  });
  it('never reads private bytes when membership fails', async () => {
    mocks.context.mockRejectedValue(new ApiFault('FORBIDDEN', 'Membership required.'));
    expect((await GET(request, params)).status).toBe(403);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it('rejects modified storage bytes before decompression', async () => {
    mocks.download.mockResolvedValue({ data: { size: bytes.length, arrayBuffer: async () => Buffer.alloc(bytes.length) }, error: null });
    expect((await GET(request, params)).status).toBe(409);
    expect(mocks.extract).not.toHaveBeenCalled();
  });
  it('reports unsupported formats without fabricating a preview', async () => {
    mocks.extract.mockReturnValue(null);
    expect((await GET(request, params)).status).toBe(415);
  });
});
