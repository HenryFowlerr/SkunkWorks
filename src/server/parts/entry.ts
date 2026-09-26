import 'server-only';

import { IdSchema } from '@/contracts';
import { getJobApiContext } from '@/server/api/context';
import { DataAdapterError } from '@/server/data/errors';
import { ApiFault } from '@/server/http/api';

export type PartEntry =
  | { state: 'ready'; releaseId: string }
  | { state: 'sign-in' | 'unavailable' | 'unpublished' | 'service-unavailable' };

/** Resolve on every scan under membership authorization; never serialize the draft or sources. */
export async function resolvePartEntry(jobId: string): Promise<PartEntry> {
  const parsed = IdSchema.safeParse(jobId);
  if (!parsed.success) return { state: 'unavailable' };

  try {
    const { repository } = await getJobApiContext(parsed.data);
    const { job, releases } = await repository.getJobBundle(parsed.data);
    if (job.id !== parsed.data) return { state: 'unavailable' };
    if (!job.latestReleaseId) return { state: 'unpublished' };
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
