import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { formatCount } from "@/lib/admin";

/** "Showing 21–40 of 57" with previous / next links. `hrefFor(page)` builds the link for a page. */
export function Pagination({ page, pageSize, total, hrefFor, label = "Pages" }) {
  if (total === 0) return null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = Math.min((page - 1) * pageSize + 1, total);
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-ink-muted">
        Showing {formatCount(first)}–{formatCount(last)} of {formatCount(total)}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Previous
            </Link>
          ) : null}
          <span className="text-ink-muted">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} className={buttonClasses({ variant: "secondary", size: "sm" })}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}
