import { cn } from "@/lib/cn";

const control =
  "block w-full rounded-field border bg-surface px-3.5 text-ink placeholder:text-ink-muted/70 " +
  "transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-brand " +
  "disabled:bg-paper disabled:text-ink-muted";
const okBorder = "border-line-strong hover:border-ink-muted";
const errorBorder = "border-danger";

/**
 * Label + control + hint + error, wired together for assistive technology.
 * `children` is a function receiving the props the control needs.
 */
export function Field({ id, label, hint, error, optional = false, className, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-sm font-semibold text-ink">
        <span>{label}</span>
        {optional ? <span className="font-normal text-ink-muted">Optional</span> : null}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        className: cn(control, error ? errorBorder : okBorder),
      })}
      {error ? (
        <p id={errorId} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }) {
  return <input className={cn("min-h-11", className)} {...props} />;
}

export function Select({ className, children, ...props }) {
  return (
    <select className={cn("min-h-11 pr-9", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, rows = 4, ...props }) {
  return <textarea rows={rows} className={cn("py-2.5 leading-relaxed", className)} {...props} />;
}

export function Checkbox({ id, label, description, className, ...props }) {
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 rounded-field px-1 py-1.5", className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-5 shrink-0 rounded accent-brand" {...props} />
      <span className="text-sm">
        <span className="font-semibold text-ink">{label}</span>
        {description ? <span className="block text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}
