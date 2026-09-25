import type { ReactNode } from "react";

export function SourceReference({
  label,
  detail,
  href,
}: {
  label: string;
  detail?: string;
  href?: string;
}) {
  const content: ReactNode = (
    <>
      <span className="source-reference__icon" aria-hidden="true">↗</span>
      <span className="source-reference__text">
        <span>{label}</span>
        {detail ? <span className="source-reference__detail">{detail}</span> : null}
      </span>
    </>
  );

  return href ? (
    <a className="source-reference" href={href}>{content}</a>
  ) : (
    <span className="source-reference">{content}</span>
  );
}
