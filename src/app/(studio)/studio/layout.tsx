import type { ReactNode } from "react";

// The prepared public demo intentionally has no session or auth wrapper.
export default function StudioLayout({ children }: { children: ReactNode }) {
  return children;
}
