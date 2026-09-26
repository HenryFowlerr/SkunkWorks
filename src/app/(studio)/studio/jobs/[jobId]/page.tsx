"use client";

import { useParams } from "next/navigation";
import { JobReviewDesk } from "@/features/review/job-review-desk";
import { FacilityCheckPanel } from "@/features/studio/jobs/facility-check-panel";
import { useStudioSession } from "@/features/studio/studio-session";

export default function StudioJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { role } = useStudioSession();
  return <div style={{ display: "grid", gap: 20 }}>
    {role !== "fabricator" ? <FacilityCheckPanel jobId={jobId} /> : null}
    <JobReviewDesk jobId={jobId} role={role} />
  </div>;
}
