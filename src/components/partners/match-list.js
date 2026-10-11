import Link from "next/link";
import { PartnerMenu } from "@/components/partners/partner-menu";
import { Avatar } from "@/components/ui/avatar";
import { ButtonLink } from "@/components/ui/button";
import { ChatIcon } from "@/components/ui/icons-extra";
import { Badge } from "@/components/ui/misc";
import { chatPath, eventPaths } from "@/lib/auth/routes";
import { formatDate, formatDateTime } from "@/lib/dates";
import { yearLabel } from "@/lib/format";

/**
 * The caller's matches, each with its conversation (rows from
 * list_my_conversations()). With `showEvent`, each row names its event.
 * Only what the database returned is shown: no online status, no unread count.
 */
export function MatchList({ matches, showEvent = false }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
      {matches.map((match) => {
        const paths = eventPaths(match.event_slug);
        return (
          <li key={match.conversation} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-5 py-4">
            <Avatar src={match.has_photo ? paths.photo(match.handle) : null} name={match.first_name} size="md" />
            <div className="min-w-0 flex-1 basis-56">
              <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                {match.first_name}
                <Badge tone="ok">Matched</Badge>
                {match.blocked_by_me ? <Badge>Blocked by you</Badge> : null}
              </p>
              <p className="text-sm text-ink-muted">
                {match.course}
                {match.study_year ? `, ${yearLabel(match.study_year).toLowerCase()}` : ""}
              </p>
              <p className="text-sm text-ink-muted">
                {showEvent ? (
                  <>
                    <Link href={paths.partners} className="font-semibold text-brand underline">
                      {match.event_title}
                    </Link>
                    {", "}
                  </>
                ) : null}
                matched on {formatDate(match.matched_at)}
              </p>
              {match.last_body ? (
                <p className="mt-2 flex items-baseline gap-2 text-sm" data-testid="last-message">
                  <span className="min-w-0 flex-1 truncate text-ink">
                    <span className="text-ink-muted">{match.last_mine ? "You: " : `${match.first_name}: `}</span>
                    {match.last_body}
                  </span>
                  <time dateTime={match.last_at} className="shrink-0 text-xs text-ink-muted">
                    {formatDateTime(match.last_at)}
                  </time>
                </p>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">No messages yet.</p>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
              <ButtonLink href={chatPath(match.conversation)} size="sm" variant={match.last_body ? "secondary" : "primary"}>
                <ChatIcon className="size-4" />
                {match.last_body ? "Open chat" : "Say hello"}
                <span className="sr-only"> with {match.first_name}</span>
              </ButtonLink>
              <PartnerMenu slug={match.event_slug} handle={match.handle} name={match.first_name} showBlock={!match.blocked_by_me} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
