import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonTone = "primary" | "secondary" | "quiet" | "danger";

export function buttonClassName(options: { tone?: ButtonTone; small?: boolean; className?: string } = {}) {
  const { tone = "primary", small = false, className = "" } = options;
  return ["button", `button--${tone}`, small && "button--small", className]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  small?: boolean;
  icon?: ReactNode;
};

export function Button({ tone = "primary", small = false, icon, className, children, ...props }: ButtonProps) {
  return (
    <button className={buttonClassName({ tone, small, className })} {...props}>
      {children}
      {icon ? <span aria-hidden="true">{icon}</span> : null}
    </button>
  );
}
