import 'server-only';

import { IdSchema, type Asset } from '@/contracts';
import { getJobApiContext } from '@/server/api/context';
import { DataAdapterError } from '@/server/data/errors';
import { ApiFault } from '@/server/http/api';

export type PartEntry =
  | { state: 'ready'; releaseId: string }
  | { state: 'unpublished'; title: string; assets: Asset[] }
  | { state: 'sign-in' | 'unavailable' | 'service-unavailable' };

/** Resolve on every scan under membership authorization; never serialize draft guidance. Native sources are visible only after authorization. */
export async function resolvePartEntry(jobId: string): Promise<PartEntry> {
  const parsed = IdSchema.safeParse(jobId);
  if (!parsed.success) return { state: 'unavailable' };

  try {
    const { repository } = await getJobApiContext(parsed.data);
    const { job, releases, assets } = await repository.getJobBundle(parsed.data);
    if (job.id !== parsed.data) return { state: 'unavailable' };
    if (!job.latestReleaseId) return { state: 'unpublished', title: job.title, assets: assets.filter(asset => job.sourceAssetIds.includes(asset.id) && ['native_part', 'native_drawing'].includes(asset.kind)) };
    const latest = releases.find((release) => release.id === job.latestReleaseId && release.jobId === job.id);
    if (!latest) return { state: 'unavailable' };
    return { state: 'ready', releaseId: latest.id };
  } catch (error) {
    if (error instanceof ApiFault || error instanceof DataAdapterError) {
      if (error.code === 'UNAUTHENTICATED') return { state: 'sign-in' };
      if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') return { state: 'unavailable' };
      if (error.code === 'PROVIDER_UNAVAILABLE') return { state: 'service-unavailable' };
    }
    throw error;
  }
}
