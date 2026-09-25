"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The digest identifies this render failure without logging user content.
    if (error.digest) console.error("SkunkWorks render failure", { digest: error.digest });
  }, [error]);

  return (
    <main style={{ maxWidth: 640, margin: "16vh auto", padding: 24 }}>
      <p className="eyebrow">Something went wrong</p>
      <h1 style={{ fontSize: "clamp(2rem, 7vw, 4rem)", letterSpacing: "-.05em" }}>Your guide is still safe.</h1>
      <p style={{ color: "var(--ink-muted)", lineHeight: 1.6 }}>The screen could not be loaded. Try again; no change is confirmed until the server says it is saved.</p>
      <button type="button" className="button button--primary" onClick={reset}>Try again</button>
    </main>
  );
}
