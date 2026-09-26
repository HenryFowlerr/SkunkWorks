"use client";

import { useParams } from "next/navigation";
import { ManufacturerPart } from "@/features/manufacturing/manufacturer-part";
import { JobReviewDesk } from "@/features/review/job-review-desk";
import { FacilityCheckPanel } from "@/features/studio/jobs/facility-check-panel";
import { useStudioSession } from "@/features/studio/studio-session";

export default function StudioJobPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { role, workspaceId } = useStudioSession();
  if (role === "fabricator") return <ManufacturerPart key={`${workspaceId}:${jobId}`} jobId={jobId} workspaceId={workspaceId} />;
  return <div style={{ display: "grid", gap: 20 }}>
    <JobReviewDesk jobId={jobId} role={role} />
    <section id="facility-check"><details><summary>Check documented facility requirements</summary><FacilityCheckPanel jobId={jobId} /></details></section>
  </div>;
}
