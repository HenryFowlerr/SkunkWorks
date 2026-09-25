"use client";

import { JobsDashboard } from "@/features/studio/jobs/jobs-dashboard";
import { useStudioSession } from "@/features/studio/studio-session";

export default function StudioJobsPage() {
  const { workspaceId } = useStudioSession();
  return <JobsDashboard workspaceId={workspaceId} />;
}
