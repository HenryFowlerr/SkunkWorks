"use client";

import { useParams } from "next/navigation";
import { ReleasePrintLabel } from "@/features/print/release-print-label";

export default function PrintReleasePage() {
  const { jobId, releaseId } = useParams<{ jobId: string; releaseId: string }>();
  return <ReleasePrintLabel jobId={jobId} releaseId={releaseId} />;
}
