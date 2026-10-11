import { PhaseBadge, TypeBadge } from "@/components/events/event-badges";
import { Panel } from "@/components/ui/misc";
import { formatDateTimeLong, formatEventRange, timeZoneLabel } from "@/lib/dates";
import { describeEligibility, phaseSentence } from "@/lib/events";
import { collegeLabel } from "@/lib/format";

/**
 * The event exactly as a student sees it. Used by the student details page
 * and by the admin preview, so the two can never drift apart.
 *
 * Receives only public fields; `aside` is the participation panel (student
 * page) or nothing (preview).
 */
export function EventDetails({ event, collegeNames, aside = null }) {
  const eligibility = describeEligibility(event, collegeNames);
  const hasWindow = event.registration_opens_at || event.registration_closes_at;

  return (
    <article className="space-y-8">
      <header>
        <p className="flex flex-wrap items-center gap-2">
          <TypeBadge type={event.event_type} />
          <PhaseBadge event={event} />
        </p>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{event.title}</h1>
        <p className="mt-2 text-ink-muted">Hosted by {collegeLabel(event.colleges) || "a college on ParvLink"}</p>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Panel>
            <dl className="grid gap-5 sm:grid-cols-2">
              <div>
                <dt className="text-sm font-semibold text-ink-muted">When</dt>
                <dd className="mt-0.5 font-semibold">{formatEventRange(event.starts_at, event.ends_at)}</dd>
                <dd className="text-sm text-ink-muted">Times are in {timeZoneLabel(event.starts_at)}.</dd>
              </div>
              <div>
                <dt className="text-sm font-semibold text-ink-muted">Where</dt>
                <dd className="mt-0.5 font-semibold">{event.venue || "To be announced"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm font-semibold text-ink-muted">Status</dt>
                <dd className="mt-0.5">{phaseSentence(event)}</dd>
                {hasWindow ? (
                  <dd className="text-sm text-ink-muted">
                    {event.registration_opens_at ? `Participation opens ${formatDateTimeLong(event.registration_opens_at)}. ` : ""}
                    {event.registration_closes_at ? `It closes ${formatDateTimeLong(event.registration_closes_at)}.` : ""}
                  </dd>
                ) : null}
              </div>
            </dl>
          </Panel>

          <Panel aria-labelledby="about-heading">
            <h2 id="about-heading" className="text-xl font-semibold">
              About this event
            </h2>
            <p className="mt-3 max-w-prose whitespace-pre-line">{event.description || "No description yet."}</p>
          </Panel>

          {event.requirements ? (
            <Panel aria-labelledby="requirements-heading">
              <h2 id="requirements-heading" className="text-xl font-semibold">
                What you need
              </h2>
              <p className="mt-3 max-w-prose whitespace-pre-line">{event.requirements}</p>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-5">
          <Panel aria-labelledby="eligibility-heading">
            <h2 id="eligibility-heading" className="text-xl font-semibold">
              Who can take part
            </h2>
            <dl className="mt-3 space-y-3 text-sm">
              {eligibility.map((line) => (
                <div key={line.label}>
                  <dt className="font-semibold">{line.label}</dt>
                  <dd className="text-ink-muted">{line.text}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          {aside}
        </div>
      </div>
    </article>
  );
}
