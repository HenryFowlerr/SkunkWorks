"use client";

import { useParams } from "next/navigation";
import { JobReviewDesk } from "@/features/review/job-review-desk";
import { useStudioSession } from "@/features/studio/studio-session";

export default function StudioJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { role } = useStudioSession();
  return <JobReviewDesk jobId={jobId} role={role} />;
}
