import Link from "next/link";
import { formatCount } from "@/lib/admin";
import { cn } from "@/lib/cn";

/**
 * One number with its label and, underneath, what exactly it counts.
 * A null value means the admin's permissions do not cover it — shown as "—".
 */
export function Stat({ label, value, note, href, tone }) {
  const body = (
    <>
      <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
      <dd className={cn("mt-1 font-display text-3xl font-bold tabular-nums", tone === "attention" && Number(value) > 0 && "text-danger")}>{formatCount(value)}</dd>
      {note ? <dd className="mt-1 text-xs leading-snug text-ink-muted">{note}</dd> : null}
    </>
  );
  const frame = "block h-full rounded-panel border border-line bg-surface px-4 py-3.5";
  return href ? (
    <div>
      <Link href={href} className={cn(frame, "hover:border-brand")}>
        {body}
      </Link>
    </div>
  ) : (
    <div className={frame}>{body}</div>
  );
}

export function StatGroup({ title, description, children, columns = "sm:grid-cols-2 lg:grid-cols-4" }) {
  const id = `stats-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-xl font-semibold">
        {title}
      </h2>
      {description ? <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p> : null}
      <dl className={cn("mt-3 grid gap-3", columns)}>{children}</dl>
    </section>
  );
}
