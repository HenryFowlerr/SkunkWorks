import { cookies } from 'next/headers';
import { ActorSchema, ReleaseViewSchema, type ReleaseView } from '@/contracts';
import { getVerifiedRequestIdentity } from '@/lib/auth/request-identity';
import { getJobApiContext, parseRouteId } from '@/server/api/context';
import { releaseViewAccess } from '@/server/access/release-access';
import { createSupabaseServiceClient } from '@/server/auth/service-client';
import { hashReleaseToken, TOKEN_PATTERN, VISITOR_COOKIE } from '@/server/auth/release-token';
import { throwDatabaseError } from '@/server/data/errors';
import { ApiFault, handleApiOperation } from '@/server/http/api';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleApiOperation(async () => {
    const releaseId = parseRouteId((await context.params).id);
    let unauthenticated = false;
    try {
      const { supabase } = await getVerifiedRequestIdentity();
      const { data, error } = await supabase.from('releases').select('job_id').eq('id', releaseId).maybeSingle();
      if (error) throw new ApiFault('PROVIDER_UNAVAILABLE', 'Release access could not be checked.', { retryable: true });
      if (data?.job_id) {
        const { repository, actor } = await getJobApiContext(data.job_id);
        const bundle = await repository.getJobBundle(data.job_id);
        const release = bundle.releases.find((item) => item.id === releaseId);
        if (!release) throw new ApiFault('NOT_FOUND', 'Release not found.');
        const sourceAssets = release.snapshot.sourceAssetIds.map((assetId) => bundle.assets.find((asset) => asset.id === assetId));
        if (sourceAssets.some((asset) => !asset)) throw new ApiFault('INTERNAL_ERROR', 'A release source asset is unavailable.');
        const successor = bundle.releases.find((item) => item.supersedesReleaseId === release.id) ?? null;
        const replacement = releaseViewAccess(release, successor);
        return ReleaseViewSchema.parse({
          job: bundle.job, release, sourceAssets,
          replacementReleaseId: replacement.replacementReleaseId,
          canFollowReplacement: false, actor,
          permissions: { canAsk: false, canFlag: false, canRespond: false },
        });
      }
      // A signed-in account outside the workspace can still have separately
      // authorized floor access through a QR session, but never member rights.
    } catch (error) {
      if (!(error instanceof ApiFault) || error.code !== 'UNAUTHENTICATED') throw error;
      unauthenticated = true;
    }
    const sessionToken = (await cookies()).get(VISITOR_COOKIE)?.value;
    if (!sessionToken || !TOKEN_PATTERN.test(sessionToken)) {
      throw new ApiFault(unauthenticated ? 'UNAUTHENTICATED' : 'NOT_FOUND', 'Open the authorized QR link for this release.');
    }
    return readVisitorRelease(releaseId, sessionToken);
  });
}

async function readVisitorRelease(releaseId: string, sessionToken: string): Promise<ReleaseView> {
  const service = createSupabaseServiceClient();
  const { data, error } = await service.rpc('read_release_visitor_scope_internal', {
    p_release_id: releaseId,
    p_session_hash: hashReleaseToken(sessionToken),
  });
  throwDatabaseError(error, 'read visitor release');
  if (!data || typeof data !== 'object') throw new ApiFault('NOT_FOUND', 'Release not found.');
  const scope = data as { sessionId?: string; displayName?: string; job?: unknown; release?: unknown; sourceAssets?: unknown };
  if (!scope.sessionId) throw new ApiFault('INTERNAL_ERROR', 'Visitor scope has no session.');
  const release = ReleaseViewSchema.shape.release.parse(scope.release);
  const { data: successor, error: successorError } = await service.from('releases')
    .select('id,allow_predecessor_visitors')
    .eq('supersedes_release_id', releaseId)
    .eq('job_id', release.jobId)
    .maybeSingle();
  if (successorError) throw new ApiFault('PROVIDER_UNAVAILABLE', 'Replacement status could not be checked.', { retryable: true });
  return ReleaseViewSchema.parse({
    job: scope.job,
    release,
    sourceAssets: scope.sourceAssets,
    replacementReleaseId: successor?.id ?? null,
    // Following a replacement requires its own atomic grant endpoint.
    canFollowReplacement: false,
    actor: ActorSchema.parse({
      id: scope.sessionId,
      displayName: scope.displayName || 'Shop floor visitor',
      kind: 'release_visitor',
      roles: [],
    }),
    permissions: { canAsk: false, canFlag: false, canRespond: false },
  });
}
