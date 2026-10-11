import { actorLabel, describeAudit } from "@/lib/admin";
import { formatDate, formatDateTime } from "@/lib/dates";

/**
 * A timeline of actions as the admin functions return them:
 * [{ action, created_at, by, reason?, note?, until?, report_ref?, from?, to?, automatic? }]
 */
export function History({ entries, empty, label }) {
  if (entries.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ol aria-label={label} className="space-y-3 border-l-2 border-line pl-4">
      {entries.map((entry, index) => {
        const text = entry.reason ?? entry.note ?? null;
        return (
          <li key={`${entry.created_at}-${index}`} className="text-sm">
            <p>
              <span className="font-semibold">{describeAudit(entry)}</span>
              {entry.until ? <span> until {formatDate(entry.until)}</span> : null}
              <span className="text-ink-muted">
                {" "}
                · {actorLabel(entry.by)} · <time dateTime={entry.created_at}>{formatDateTime(entry.created_at)}</time>
                {entry.report_ref ? ` · follows report ${entry.report_ref}` : ""}
              </span>
            </p>
            {text ? <p className="mt-0.5 whitespace-pre-wrap break-words text-ink-muted">{text}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
