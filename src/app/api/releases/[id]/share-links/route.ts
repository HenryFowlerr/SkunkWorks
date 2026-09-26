import { CreateShareLinkResultSchema, ShareLinkSummarySchema } from '@/contracts';
import { z } from 'zod';
import { getVerifiedRequestIdentity } from '@/lib/auth/request-identity';
import { getJobApiContext, parseRouteId } from '@/server/api/context';
import { createSupabaseServiceClient, getSupabasePrivilegedConfig } from '@/server/auth/service-client';
import { deriveReleaseLinkToken, hashReleaseToken } from '@/server/auth/release-token';
import { throwDatabaseError } from '@/server/data/errors';
import { ApiFault, handleApiOperation, readIdempotencyKey } from '@/server/http/api';
import { assertSameOrigin } from '@/server/http/request-security';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleApiOperation(async () => {
    assertSameOrigin(request);
    const releaseId = parseRouteId((await context.params).id);
    const key = readIdempotencyKey(request);
    const { supabase } = await getVerifiedRequestIdentity();
    const { data: scope, error } = await supabase.from('releases').select('job_id').eq('id', releaseId).maybeSingle();
    if (error) throw new ApiFault('PROVIDER_UNAVAILABLE', 'Release access could not be checked.', { retryable: true });
    if (!scope?.job_id) throw new ApiFault('NOT_FOUND', 'Release not found.');
    const { repository, actor } = await getJobApiContext(scope.job_id, ['designer']);
    const release = await repository.getRelease(releaseId);
    if (release.jobId !== scope.job_id) throw new ApiFault('NOT_FOUND', 'Release not found.');
    const origin = new URL(request.url).origin;
    if (!origin.startsWith('https://') && !origin.startsWith('http://localhost:')) {
      throw new ApiFault('PROVIDER_UNAVAILABLE', 'A secure public URL is needed for QR links.');
    }
    const config = getSupabasePrivilegedConfig();
    const token = deriveReleaseLinkToken({ secret: config.serviceRoleKey, actorId: actor.id, releaseId, idempotencyKey: key });
    const { data, error: issueError } = await createSupabaseServiceClient(config).rpc('issue_release_access_link_internal', {
      p_release_id: releaseId,
      p_actor_id: actor.id,
      p_token_hash: hashReleaseToken(token),
    });
    throwDatabaseError(issueError, 'issue release link');
    const linkId = (data as { linkId?: string } | null)?.linkId;
    if (!linkId) throw new ApiFault('INTERNAL_ERROR', 'The release link was not issued.');
    return CreateShareLinkResultSchema.parse({
      linkId,
      accessUrl: new URL(`/access/${token}`, origin).toString(),
    });
  }, { status: 201 });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleApiOperation(async () => {
    const releaseId = parseRouteId((await context.params).id);
    const { supabase } = await getVerifiedRequestIdentity();
    const { data: scope, error } = await supabase.from('releases').select('job_id').eq('id', releaseId).maybeSingle();
    if (error) throw new ApiFault('PROVIDER_UNAVAILABLE', 'Release access could not be checked.', { retryable: true });
    if (!scope?.job_id) throw new ApiFault('NOT_FOUND', 'Release not found.');
    const { repository, actor } = await getJobApiContext(scope.job_id, ['designer']);
    const release = await repository.getRelease(releaseId);
    if (release.jobId !== scope.job_id) throw new ApiFault('NOT_FOUND', 'Release not found.');
    const { data, error: listError } = await createSupabaseServiceClient().rpc('list_release_access_links_internal', {
      p_release_id: releaseId, p_actor_id: actor.id,
    });
    throwDatabaseError(listError, 'list release links');
    return z.array(ShareLinkSummarySchema).parse(data);
  });
}
