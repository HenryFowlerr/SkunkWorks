import type { ReactNode } from "react";

export function Panel({
  id,
  title,
  eyebrow,
  action,
  children,
  className,
}: {
  id?: string;
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={["panel", className].filter(Boolean).join(" ")}>
      {title ? (
        <header className="panel__header">
          <div className="panel__heading">
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            <h2 className="panel__title">{title}</h2>
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["panel__body", className].filter(Boolean).join(" ")}>{children}</div>;
}
