"use client";

import { useRouter } from "next/navigation";
import { JobsDashboard } from "@/features/studio/jobs/jobs-dashboard";
import { useStudioSession } from "@/features/studio/studio-session";

export default function StudioJobsPage() {
  const { workspaceId, role } = useStudioSession();
  const router = useRouter();
  return <JobsDashboard
    workspaceId={workspaceId}
    role={role}
    onOpenJob={(job) => router.push(`/studio/jobs/${encodeURIComponent(job.id)}?workspace=${encodeURIComponent(workspaceId)}`)}
  />;
}
