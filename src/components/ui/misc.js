import { cn } from "@/lib/cn";

export function Panel({ as: Tag = "section", className, children, ...props }) {
  return (
    <Tag className={cn("rounded-panel border border-line bg-surface p-5 sm:p-6", className)} {...props}>
      {children}
    </Tag>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {description ? <p className="mt-2 text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

const badgeTones = {
  neutral: "bg-paper text-ink-muted border-line",
  brand: "bg-brand-soft text-brand-strong border-brand/20",
  ok: "bg-ok-soft text-ok border-ok/25",
  warning: "bg-marigold-soft text-marigold-ink border-marigold/50",
  danger: "bg-danger-soft text-danger border-danger/25",
};

export function Badge({ tone = "neutral", className, children }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", badgeTones[tone], className)}>
      {children}
    </span>
  );
}

/** An empty screen says what will appear here and what to do next. */
export function EmptyState({ title, children, action, className }) {
  return (
    <div className={cn("rounded-panel border border-dashed border-line-strong bg-surface/60 px-5 py-8 text-center", className)}>
      <p className="font-display text-lg font-semibold">{title}</p>
      {children ? <div className="mx-auto mt-1.5 max-w-md text-sm text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-field bg-line/70", className)} />;
}

/** Announces loading to screen readers while skeletons are shown. */
export function LoadingRegion({ label = "Loading", className, children }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}
