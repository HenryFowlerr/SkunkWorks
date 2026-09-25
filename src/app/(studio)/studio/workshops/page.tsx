"use client";

import { WorkshopsManager } from "@/features/workshops/workshops-manager";
import { useStudioSession } from "@/features/studio/studio-session";

export default function WorkshopsPage() {
  const { workspaceId, role } = useStudioSession();
  return <WorkshopsManager workspaceId={workspaceId} role={role} />;
}
