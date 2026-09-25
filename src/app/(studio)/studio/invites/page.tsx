"use client";

import { WorkspaceInvites } from "@/features/studio/invites/workspace-invites";
import { useStudioSession } from "@/features/studio/studio-session";

export default function WorkspaceInvitesPage() {
  const { workspaceId, role } = useStudioSession();
  return <WorkspaceInvites workspaceId={workspaceId} role={role} />;
}
