import Link from "next/link";
import { StatusBadge, TypeBadge } from "@/components/events/event-badges";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireManagedEvent } from "@/lib/auth/session";
import { Stat } from "@/components/admin/stat";
import { getEventStats } from "@/lib/data/admin";
import { getCollegeNames } from "@/lib/data/events";
import { formatDateTimeLong, formatEventRange, timeZoneLabel } from "@/lib/dates";
import { describeEligibility, phaseSentence, STATUS_ACTIONS } from "@/lib/events";
import { collegeLabel } from "@/lib/format";
import { StatusActions } from "./status-actions";

export const metadata = { title: "Manage event" };

export default async function ManageEventPage({ params, searchParams }) {
  const { eventId } = await params;
  const { event } = await requireManagedEvent(eventId);
  const { saved } = await searchParams;

  const [collegeNames, numbers] = await Promise.all([getCollegeNames(event), getEventStats({ event: event.id, pageSize: 1 })]);
  const stats = numbers.rows[0] ?? null;
  const base = `${ROUTES.adminEvents}/${event.id}`;
  const editable = event.status !== "completed";

  return (
    <div className="space-y-8">
      <div>
        <Link href={ROUTES.adminEvents} className="text-sm font-semibold text-brand underline">
          Back to events
        </Link>
        <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge status={event.status} />
              <TypeBadge type={event.event_type} />
            </p>
            <h1 className="mt-2 break-words text-3xl font-bold sm:text-4xl">{event.title}</h1>
            <p className="mt-2 text-ink-muted">Hosted by {collegeLabel(event.colleges)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {editable ? (
              <ButtonLink href={`${base}/edit`} variant="secondary" size="sm">
                Edit
              </ButtonLink>
            ) : null}
            <ButtonLink href={`${base}/preview`} variant="secondary" size="sm">
              {event.status === "draft" ? "Preview" : "View as a student"}
            </ButtonLink>
          </div>
        </header>
      </div>

      {saved === "created" ? (
        <Alert tone="success">Draft saved. Preview it, then publish when it is ready.</Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
        <Panel aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="text-xl font-semibold">
            Summary
          </h2>
          <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-semibold">When</dt>
              <dd className="text-ink-muted">
                {formatEventRange(event.starts_at, event.ends_at)} ({timeZoneLabel(event.starts_at)})
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Venue</dt>
              <dd className="text-ink-muted">{event.venue || "Not set"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Participation window</dt>
              <dd className="text-ink-muted">
                {event.registration_opens_at ? `Opens ${formatDateTimeLong(event.registration_opens_at)}` : "Opens when published"}
                {"; "}
                {event.registration_closes_at ? `closes ${formatDateTimeLong(event.registration_closes_at)}` : "closes when the event ends"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">For students right now</dt>
              <dd className="text-ink-muted">{phaseSentence(event)}</dd>
            </div>
            {describeEligibility(event, collegeNames).map((line) => (
              <div key={line.label}>
                <dt className="font-semibold">{line.label}</dt>
                <dd className="text-ink-muted">{line.text}</dd>
              </div>
            ))}
            <div className="sm:col-span-2">
              <dt className="font-semibold">Description</dt>
              <dd className="mt-0.5 line-clamp-4 whitespace-pre-line text-ink-muted">{event.description || "Not written yet."}</dd>
            </div>
          </dl>

          <h3 className="mt-6 border-t border-line pt-4 font-sans text-sm font-semibold">Record</h3>
          <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm text-ink-muted sm:grid-cols-3">
            <div>
              <dt className="inline">Created </dt>
              <dd className="inline">{formatDateTimeLong(event.created_at)}</dd>
            </div>
            <div>
              <dt className="inline">Last edited </dt>
              <dd className="inline">{formatDateTimeLong(event.updated_at)}</dd>
            </div>
            <div>
              <dt className="inline">First published </dt>
              <dd className="inline">{event.published_at ? formatDateTimeLong(event.published_at) : "never"}</dd>
            </div>
          </dl>
          {event.status !== "draft" ? (
            <p className="mt-4 break-all text-sm">
              <span className="font-semibold">Student link: </span>
              <Link href={`${ROUTES.events}/${event.slug}`} className="text-brand underline">
                {ROUTES.events}/{event.slug}
              </Link>
            </p>
          ) : null}
        </Panel>

        <Panel aria-labelledby="status-heading">
          <h2 id="status-heading" className="text-xl font-semibold">
            Status
          </h2>
          <p className="mb-4 mt-1 flex items-center gap-2 text-sm">
            Currently <StatusBadge status={event.status} />
          </p>
          <StatusActions eventId={event.id} actions={STATUS_ACTIONS[event.status] ?? []} />
        </Panel>
      </div>

      {event.status !== "draft" && stats ? (
        <section aria-labelledby="numbers-heading">
          <h2 id="numbers-heading" className="text-xl font-semibold">
            Partner finding so far
          </h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Participants" value={stats.participants} note={`Students who joined. ${stats.active_discovery} are discoverable right now.`} />
            <Stat label="Interests sent" value={stats.interests} />
            <Stat label="Matches" value={stats.matches} note="Pairs with mutual interest." />
            <Stat label="Students matched" value={stats.matched_participants} note="Participants with at least one match." />
          </dl>
          <p className="mt-2 text-xs text-ink-muted">Counts only. Who joined, who matched with whom, and what they wrote are not available to admins.</p>
        </section>
      ) : null}
    </div>
  );
}
