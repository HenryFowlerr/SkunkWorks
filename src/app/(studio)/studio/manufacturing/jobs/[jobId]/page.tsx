import { redirect } from "next/navigation";

export default async function ManufacturingPartPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  redirect(`/studio/jobs/${encodeURIComponent(jobId)}`);
}
