'use client';
import { useParams } from 'next/navigation';
import { ManufacturerPart } from '@/features/manufacturing/manufacturer-part';
import { useStudioSession } from '@/features/studio/studio-session';
export default function ManufacturingPartPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { workspaceId } = useStudioSession();
  return <ManufacturerPart key={`${workspaceId}:${jobId}`} jobId={jobId} workspaceId={workspaceId} />;
}
