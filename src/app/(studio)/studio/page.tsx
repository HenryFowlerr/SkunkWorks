"use client";

import { useRouter } from "next/navigation";
import { ManufacturerJobs } from "@/features/manufacturing/manufacturer-jobs";
import { JobsDashboard } from "@/features/studio/jobs/jobs-dashboard";
import { useStudioSession } from "@/features/studio/studio-session";

export default function StudioJobsPage() {
  const { workspaceId, role } = useStudioSession();
  const router = useRouter();
  if (role === "fabricator") return <ManufacturerJobs key={workspaceId} workspaceId={workspaceId} />;
  return <JobsDashboard
    workspaceId={workspaceId}
    role={role}
    onOpenJob={(job) => router.push(`/studio/jobs/${encodeURIComponent(job.id)}?workspace=${encodeURIComponent(workspaceId)}`)}
  />;
}
