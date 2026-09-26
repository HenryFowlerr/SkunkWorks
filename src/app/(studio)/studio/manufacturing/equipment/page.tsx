'use client';
import { WorkshopsManager } from '@/features/workshops/workshops-manager';
import { useStudioSession } from '@/features/studio/studio-session';
export default function ManufacturingEquipmentPage() {
  const { workspaceId, role } = useStudioSession();
  return <WorkshopsManager key={workspaceId} workspaceId={workspaceId} role={role} />;
}
