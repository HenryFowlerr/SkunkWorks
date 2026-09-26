import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ids, job, release, draft, sourceAsset } from '../../../tests/contracts/fixtures';
import { ApiFault } from '@/server/http/api';
import { DataAdapterError } from '@/server/data/errors';
import { resolvePartEntry } from './entry';

const access = vi.hoisted(() => ({ context: vi.fn(), getJobBundle: vi.fn() }));
vi.mock('@/server/api/context', () => ({ getJobApiContext: access.context }));

beforeEach(() => {
  access.context.mockReset().mockResolvedValue({ repository: { getJobBundle: access.getJobBundle } });
  access.getJobBundle.mockReset().mockResolvedValue({ job, releases: [release], draft, assets: [sourceAsset] });
});

describe('stable part entry', () => {
  it('resolves the currently published guide on each visit, exposing only its ID', async () => {
    expect(await resolvePartEntry(ids.job)).toEqual({ state: 'ready', releaseId: ids.release });
    const latestId = ids.flag;
    access.getJobBundle.mockResolvedValue({ job: { ...job, latestReleaseId: latestId }, releases: [release, { ...release, id: latestId, revisionNumber: 2 }], draft, assets: [sourceAsset] });
    expect(await resolvePartEntry(ids.job)).toEqual({ state: 'ready', releaseId: latestId });
    expect(access.context).toHaveBeenCalledTimes(2);
    expect(access.context).toHaveBeenCalledWith(ids.job);
  });

  it('does not load any part data before verified membership authorization', async () => {
    access.context.mockRejectedValue(new ApiFault('UNAUTHENTICATED', 'Sign in.'));
    expect(await resolvePartEntry(ids.job)).toEqual({ state: 'sign-in' });
    expect(access.getJobBundle).not.toHaveBeenCalled();
  });

  it.each(['FORBIDDEN', 'NOT_FOUND'] as const)('does not reveal existence or source data for %s', async (code) => {
    access.context.mockRejectedValue(new DataAdapterError(code, 'Private details'));
    expect(await resolvePartEntry(ids.job)).toEqual({ state: 'unavailable' });
    expect(access.getJobBundle).not.toHaveBeenCalled();
  });

  it('never falls back to the unapproved draft', async () => {
    access.getJobBundle.mockResolvedValue({ job: { ...job, latestReleaseId: null }, releases: [], draft, assets: [sourceAsset] });
    expect(await resolvePartEntry(ids.job)).toEqual({ state: 'unpublished' });
  });

  it('rejects a latest release pointing at another part', async () => {
    access.getJobBundle.mockResolvedValue({ job, releases: [{ ...release, jobId: ids.asset }] });
    expect(await resolvePartEntry(ids.job)).toEqual({ state: 'unavailable' });
  });

  it('rejects malformed IDs without touching the authorization provider', async () => {
    expect(await resolvePartEntry('../studio')).toEqual({ state: 'unavailable' });
    expect(access.context).not.toHaveBeenCalled();
  });

  it('reports service downtime without pretending access was granted', async () => {
    access.context.mockRejectedValue(new ApiFault('PROVIDER_UNAVAILABLE', 'Not configured'));
    expect(await resolvePartEntry(ids.job)).toEqual({ state: 'service-unavailable' });
  });
});
