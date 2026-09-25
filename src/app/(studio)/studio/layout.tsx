import { Suspense, type ReactNode } from "react";
import { StudioSessionProvider } from "@/features/studio/studio-session";

export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main aria-live="polite" style={{ padding: 28 }}>Loading designer workspace…</main>}>
      <StudioSessionProvider>{children}</StudioSessionProvider>
    </Suspense>
  );
}
