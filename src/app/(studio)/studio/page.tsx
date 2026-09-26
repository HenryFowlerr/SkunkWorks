import type { Metadata } from "next";
import { EngineeringWorkspace } from "@/features/prepared-demo/public-workspaces";

export const metadata: Metadata = { title: "Engineering demo" };

export default function StudioJobsPage() {
  return <EngineeringWorkspace />;
}
