import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreparedPartPhone } from "@/components/prepared-part-phone";
import { getPreparedPart, preparedParts } from "@/features/prepared-demo/public-data";

export const dynamicParams = false;

export function generateStaticParams() {
  return preparedParts.map(({ id }) => ({ jobId: id }));
}

export async function generateMetadata({ params }: { params: Promise<{ jobId: string }> }): Promise<Metadata> {
  const { jobId } = await params;
  const part = getPreparedPart(jobId);
  return { title: part ? `${part.name} · Source part view` : "Part not found", robots: { index: false, follow: false } };
}

export default async function PartPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const part = getPreparedPart(jobId);
  if (!part) notFound();
  return <PreparedPartPhone part={part} />;
}
