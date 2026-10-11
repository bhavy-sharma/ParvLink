import { describeAudit } from "@/lib/admin";
import { formatDateTime } from "@/lib/dates";

/**
 * Audit entries as a list. `actorName(entry)`, `subjectFor(entry)` and
 * `collegeName(id)` turn ids into something readable for this viewer (see
 * lib/data/admin-people.js); entries carry no private content.
 */
export function ActivityList({ entries, actorName, subjectFor, collegeName }) {
  return (
    <ol className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
      {entries.map((entry) => {
        const subject = subjectFor(entry);
        const college = collegeName(entry.college_id);
        const reason = entry.metadata?.reason ?? entry.metadata?.note ?? null;
        return (
          <li key={entry.id} className="px-5 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
              <p className="min-w-0">
                <span className="font-semibold">{describeAudit(entry)}</span>
                <span className="break-words text-ink-muted">
                  {college ? `: ${college}` : ""}
                  {subject ? ` (${subject})` : ""} by {actorName(entry)}
                </span>
              </p>
              <time dateTime={entry.created_at} className="shrink-0 text-ink-muted">
                {formatDateTime(entry.created_at)}
              </time>
            </div>
            {reason ? <p className="mt-1 break-words text-ink-muted">Reason: {reason}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
