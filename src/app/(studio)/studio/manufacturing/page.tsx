'use client';
import { ManufacturerJobs } from '@/features/manufacturing/manufacturer-jobs';
import { useStudioSession } from '@/features/studio/studio-session';
export default function ManufacturingPage() {
  const { workspaceId } = useStudioSession();
  return <ManufacturerJobs key={workspaceId} workspaceId={workspaceId} />;
}
