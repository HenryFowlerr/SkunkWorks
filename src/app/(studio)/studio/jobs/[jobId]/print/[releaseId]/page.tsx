"use client";

import { useParams } from "next/navigation";
import { ReleasePrintLabel } from "@/features/print/release-print-label";

export default function PrintReleasePage() {
  const { releaseId } = useParams<{ releaseId: string }>();
  return <ReleasePrintLabel releaseId={releaseId} />;
}
