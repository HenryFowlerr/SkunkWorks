import { cookies } from 'next/headers';
import { AssetLinkSchema } from '@/contracts';
import { getVerifiedRequestIdentity } from '@/lib/auth/request-identity';
import { getJobApiContext, parseRouteId } from '@/server/api/context';
import { createSupabaseServiceClient } from '@/server/auth/service-client';
import { hashReleaseToken, TOKEN_PATTERN, VISITOR_COOKIE } from '@/server/auth/release-token';
import { createPrivateStorageAdapter } from '@/server/data/storage';
import { throwDatabaseError } from '@/server/data/errors';
import { ApiFault, handleApiOperation } from '@/server/http/api';

type RouteContext = { params: Promise<{ id: string }> };
const LINK_TTL_SECONDS = 300;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const assetId = parseRouteId((await context.params).id);
    let memberObjectKey: string | null = null;
    try {
      const { supabase } = await getVerifiedRequestIdentity();
      const { data: scope, error } = await supabase
        .from('assets').select('workspace_id,job_id').eq('id', assetId).maybeSingle();
      if (error) throw new ApiFault('PROVIDER_UNAVAILABLE', 'Asset access could not be checked.', { retryable: true });
      if (scope?.job_id && scope.workspace_id) {
        const { repository } = await getJobApiContext(scope.job_id);
        if (repository.workspaceId !== scope.workspace_id) throw new ApiFault('NOT_FOUND', 'Asset not found.');
        const storage = createPrivateStorageAdapter({ serviceClient: createSupabaseServiceClient() });
        const asset = await storage.authorizeMemberAsset({
          workspaceId: repository.workspaceId, jobId: scope.job_id, assetId,
        });
        memberObjectKey = asset.objectKey;
      }
    } catch (error) {
      if (!(error instanceof ApiFault) || error.code !== 'UNAUTHENTICATED') throw error;
    }

    const service = createSupabaseServiceClient();
    let objectKey = memberObjectKey;
    if (!objectKey) {
      const token = (await cookies()).get(VISITOR_COOKIE)?.value;
      if (!token || !TOKEN_PATTERN.test(token)) throw new ApiFault('UNAUTHENTICATED', 'Open the authorized QR link to view this asset.');
      const { data, error } = await service.rpc('read_release_visitor_asset_internal', {
        p_asset_id: assetId, p_session_hash: hashReleaseToken(token),
      });
      throwDatabaseError(error, 'read visitor release asset');
      objectKey = (data as { objectKey?: string } | null)?.objectKey ?? null;
      if (!objectKey) throw new ApiFault('NOT_FOUND', 'Asset not found.');
    }
    const { data: signed, error: signError } = await service.storage
      .from('skunkworks-private').createSignedUrl(objectKey, LINK_TTL_SECONDS);
    if (signError || !signed?.signedUrl) {
      throw new ApiFault('PROVIDER_UNAVAILABLE', 'The asset link could not be created.', { retryable: true });
    }
    return AssetLinkSchema.parse({
      url: signed.signedUrl,
      expiresAt: new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString(),
    });
  });
}
