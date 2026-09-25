"use client";

import { useRouter } from "next/navigation";
import { NewJobIntake } from "@/features/studio/jobs/new-job-intake";
import { useStudioSession } from "@/features/studio/studio-session";

export default function NewJobPage() {
  const { workspaceId } = useStudioSession();
  const router = useRouter();
  return <NewJobIntake workspaceId={workspaceId} onCreated={(job) => router.push(`/studio/jobs/${job.id}`)} />;
}
