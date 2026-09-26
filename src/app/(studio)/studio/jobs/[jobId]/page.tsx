import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreparedPartDetail } from "@/features/prepared-demo/public-workspaces";
import { getPreparedPart } from "@/features/prepared-demo/public-data";

export const metadata: Metadata = { title: "Source packet" };

export default async function StudioJobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const part = getPreparedPart(jobId);
  if (!part) notFound();
  return <PreparedPartDetail part={part} />;
}
