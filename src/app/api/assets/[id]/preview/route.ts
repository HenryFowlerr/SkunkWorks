import { createHash } from 'node:crypto';
import { NativePreviewSchema } from '@/contracts/native-preview';
import { getVerifiedRequestIdentity } from '@/lib/auth/request-identity';
import { getJobApiContext, parseRouteId } from '@/server/api/context';
import { createSupabaseServiceClient } from '@/server/auth/service-client';
import { extractSolidWorksPreview } from '@/server/data/solidworks-preview';
import { ApiFault, handleApiOperation } from '@/server/http/api';

type RouteContext = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return handleApiOperation(async () => {
    const assetId = parseRouteId((await context.params).id);
    const { supabase } = await getVerifiedRequestIdentity();
    const { data: scope, error } = await supabase.from('assets').select('workspace_id,job_id').eq('id', assetId).maybeSingle();
    if (error) throw new ApiFault('PROVIDER_UNAVAILABLE', 'Asset access could not be checked.');
    if (!scope?.job_id || !scope.workspace_id) throw new ApiFault('NOT_FOUND', 'Source not found.');
    const { repository } = await getJobApiContext(scope.job_id);
    if (repository.workspaceId !== scope.workspace_id) throw new ApiFault('NOT_FOUND', 'Source not found.');
    const authorized = await repository.authorizeMemberAsset(scope.job_id, assetId);
    const asset = authorized.asset;
    if (!['native_part', 'native_drawing'].includes(asset.kind) || asset.status !== 'ready' || !asset.sha256) {
      throw new ApiFault('UNSUPPORTED_ASSET', 'Choose a verified native SolidWorks source.');
    }
    if (asset.byteSize > 50 * 1024 * 1024) throw new ApiFault('UNSUPPORTED_ASSET', 'This source exceeds the preview limit.');
    const service = createSupabaseServiceClient();
    const { data, error: downloadError } = await service.storage.from(authorized.bucketId).download(authorized.objectKey, {}, { cache: 'no-store' });
    if (downloadError || !data) throw new ApiFault('PROVIDER_UNAVAILABLE', 'The private source could not be read.');
    if (data.size !== asset.byteSize) throw new ApiFault('VERSION_CONFLICT', 'Source bytes changed after verification.');
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new ApiFault('VERSION_CONFLICT', 'Source bytes changed after verification.');
    const preview = extractSolidWorksPreview(bytes);
    if (!preview) throw new ApiFault('UNSUPPORTED_ASSET', 'No supported cached preview is available. The original source is still retained.');
    return NativePreviewSchema.parse({ mimeType: 'image/png', imageBase64: preview.bytes.toString('base64'),
      width: preview.width, height: preview.height, label: `Cached ${asset.kind === 'native_part' ? 'model' : 'drawing'} preview · not verified manufacturing evidence` });
  });
}
