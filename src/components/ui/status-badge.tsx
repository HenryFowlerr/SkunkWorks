export type StatusTone = "neutral" | "info" | "review" | "blocked" | "complete";

export function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: StatusTone }) {
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>;
}
