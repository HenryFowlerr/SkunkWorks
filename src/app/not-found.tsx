import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 640, margin: "16vh auto", padding: 24 }}>
      <p className="eyebrow">404 · Not found</p>
      <h1 style={{ fontSize: "clamp(2rem, 7vw, 4rem)", letterSpacing: "-.05em" }}>This handoff is unavailable.</h1>
      <p style={{ color: "var(--ink-muted)", lineHeight: 1.6 }}>Check the link on the drawing or return to the designer workspace.</p>
      <Link href="/" className="button button-secondary">Return home</Link>
    </main>
  );
}
