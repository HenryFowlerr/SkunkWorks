import type { Metadata } from "next";
import { ManufacturingWorkspace } from "@/features/prepared-demo/public-workspaces";

export const metadata: Metadata = { title: "Manufacturing demo" };

export default function ManufacturingPage() {
  return <ManufacturingWorkspace />;
}
