import { RevokeShareLinkResultSchema } from '@/contracts';
import { getVerifiedRequestIdentity } from '@/lib/auth/request-identity';
import { getJobApiContext, parseRouteId } from '@/server/api/context';
import { createSupabaseServiceClient } from '@/server/auth/service-client';
import { throwDatabaseError } from '@/server/data/errors';
import { ApiFault, handleApiOperation } from '@/server/http/api';
import { assertSameOrigin } from '@/server/http/request-security';

export async function DELETE(request: Request, context: { params: Promise<{ id: string; linkId: string }> }): Promise<Response> {
  return handleApiOperation(async () => {
    assertSameOrigin(request);
    const { id, linkId: rawLinkId } = await context.params;
    const releaseId = parseRouteId(id);
    const linkId = parseRouteId(rawLinkId);
    const { supabase } = await getVerifiedRequestIdentity();
    const { data: scope, error } = await supabase.from('releases').select('job_id').eq('id', releaseId).maybeSingle();
    if (error) throw new ApiFault('PROVIDER_UNAVAILABLE', 'Release access could not be checked.', { retryable: true });
    if (!scope?.job_id) throw new ApiFault('NOT_FOUND', 'Release not found.');
    const { repository, actor } = await getJobApiContext(scope.job_id, ['designer']);
    const release = await repository.getRelease(releaseId);
    if (release.jobId !== scope.job_id) throw new ApiFault('NOT_FOUND', 'Release not found.');
    const { data, error: revokeError } = await createSupabaseServiceClient().rpc('revoke_release_access_link_internal', {
      p_release_id: releaseId,
      p_link_id: linkId,
      p_actor_id: actor.id,
    });
    throwDatabaseError(revokeError, 'revoke release link');
    return RevokeShareLinkResultSchema.parse(data);
  });
}
