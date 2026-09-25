import type { InputHTMLAttributes, ReactNode } from "react";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children?: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children}
      {hint ? <p className="field__hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="field__error" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextInput({ label, hint, error, id, ...props }: TextInputProps) {
  const controlId = id ?? props.name;
  if (!controlId) throw new Error("TextInput requires an id or name");
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  return (
    <Field id={controlId} label={label} hint={hint} error={error}>
      <input
        {...props}
        id={controlId}
        className={["field__control", props.className].filter(Boolean).join(" ")}
        aria-describedby={[hintId, errorId, props["aria-describedby"]].filter(Boolean).join(" ") || undefined}
        aria-invalid={error ? true : props["aria-invalid"]}
      />
    </Field>
  );
}
