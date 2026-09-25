import { OperatorFloor } from '@/features/operator/operator-floor';

export default async function FloorReleasePage({ params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;
  return <OperatorFloor releaseId={releaseId} />;
}
