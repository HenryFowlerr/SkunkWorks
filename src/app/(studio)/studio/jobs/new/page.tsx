"use client";

import { useRouter } from "next/navigation";
import { NewJobIntake } from "@/features/studio/jobs/new-job-intake";
import { useStudioSession } from "@/features/studio/studio-session";

export default function NewJobPage() {
  const { workspaceId, role } = useStudioSession();
  const router = useRouter();
  return <NewJobIntake
    workspaceId={workspaceId}
    role={role}
    onCreated={(job) => router.push(`/studio/jobs/${encodeURIComponent(job.id)}?workspace=${encodeURIComponent(workspaceId)}`)}
  />;
}
