import Link from "next/link";
import { EventCard } from "@/components/events/event-card";
import { DashboardRefresh } from "@/components/layout/dashboard-refresh";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { Badge, EmptyState, Panel } from "@/components/ui/misc";
import { eventPaths, ROUTES } from "@/lib/auth/routes";
import { requireProfile } from "@/lib/auth/session";
import { getMyReceivedInterestCounts } from "@/lib/data/partners";
import { listStudentEvents } from "@/lib/data/student-events";
import { yearLabel } from "@/lib/format";
import { call } from "@/lib/services";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { profile } = await requireProfile();
  const collegeName = profile.colleges?.name ?? "your college";

  const setup = [
    { done: true, label: "Create your profile" },
    { done: Boolean(profile.avatar_path), label: "Add a photo", href: ROUTES.profile },
    { done: Boolean(profile.bio), label: "Write a line about yourself", href: ROUTES.profile },
  ];
  const remaining = setup.filter((step) => !step.done).length;

  const [events, { data: summary }, received] = await Promise.all([
    listStudentEvents(),
    call("my_partner_summary"),
    getMyReceivedInterestCounts(),
  ]);
  const current = events.filter((event) => event.phase === "open" || event.phase === "upcoming");

  return (
    <div className="space-y-8">
      <DashboardRefresh />
      <header>
        <h1 className="text-3xl font-bold sm:text-4xl">Hi, {profile.first_name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-ink-muted">
          <span>
            {profile.course}, {yearLabel(profile.study_year).toLowerCase()} at {collegeName}
          </span>
          {profile.is_verified ? <Badge tone="ok">Verified by your college</Badge> : null}
        </p>
      </header>

      {profile.status === "suspended" ? (
        <Alert tone="warning" title="Your profile is suspended">
          Other students cannot see you, and you cannot edit your profile. Contact your college admin to find out why.
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 md:grid-cols-5">
        <Panel className="md:col-span-2">
          <h2 id="received-interests-heading" className="mb-3 text-xl font-semibold">
            Pending requests by event
          </h2>
          {received.error || received.events.length > 0 ? (
            <section aria-labelledby="received-interests-heading">
              {/* <h2 id="received-interests-heading" className="mb-3 text-xl font-semibold">
                Pending requests by event
              </h2> */}
              {received.error ? (
                <Alert tone="error" title="We could not load your received interests">
                  Refresh the dashboard to try again.
                </Alert>
              ) : (
                <ul className="grid gap-3">
                  {received.events.map((event) => (
                    <li key={event.event_id}>
                      <Link
                        href={eventPaths(event.event_slug).partners}
                        className="flex items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3 transition-colors hover:border-brand/40 hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{event.event_title}</span>
                          <span className="text-sm text-ink-muted">
                            {event.pending_count === 1 ? "Pending request" : "Pending requests"}
                          </span>
                        </span>
                        <Badge tone="brand" className="shrink-0">
                          {event.pending_count}
                        </Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </Panel>

        <div className="space-y-5 md:col-span-3">
          <section aria-labelledby="events-heading">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="events-heading" className="text-xl font-semibold">
                Events for you
              </h2>
              {events.length > 0 ? (
                <Link href={ROUTES.events} className="text-sm font-semibold text-brand underline">
                  See all events
                </Link>
              ) : null}
            </div>
            {current.length > 0 ? (
              <ul className="space-y-4">
                {current.slice(0, 3).map((event) => (
                  <li key={event.id}>
                    <EventCard event={event} />
                  </li>
                ))}
              </ul>
            ) : events.length > 0 ? (
              <EmptyState
                title="Nothing open or coming up right now"
                action={
                  <ButtonLink href={`${ROUTES.events}?when=past`} variant="secondary" size="sm">
                    See past events
                  </ButtonLink>
                }
              >
                New events appear here as soon as they are published.
              </EmptyState>
            ) : (
              <EmptyState title="No events yet">
                When {collegeName} or a college that invites yours publishes an event, it appears here.
              </EmptyState>
            )}
          </section>

          <section aria-labelledby="partners-heading">
            <h2 id="partners-heading" className="mb-3 text-xl font-semibold">
              Your partner search
            </h2>
            {summary && (summary.events_joined > 0 || summary.matches > 0 || summary.waiting_interests > 0) ? (
              <Panel as="div">
                <dl className="grid grid-cols-3 gap-4 text-center">
                  {[
                    ["Waiting for your answer", summary.waiting_interests],
                    ["Matches", summary.matches],
                    ["Events joined", summary.events_joined],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dd className="font-display text-3xl font-bold tabular-nums">{value}</dd>
                      <dt className="text-sm text-ink-muted">{label}</dt>
                    </div>
                  ))}
                </dl>
                <p className="mt-4 text-sm text-ink-muted">
                  {summary.waiting_interests > 0
                    ? "Someone has sent you interest. Open the event to send interest back."
                    : "Open an event you joined to see who is looking for a partner."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ButtonLink href={ROUTES.matches} variant="secondary" size="sm">
                    My matches
                  </ButtonLink>
                  <ButtonLink href={ROUTES.events} variant="secondary" size="sm">
                    Events
                  </ButtonLink>
                </div>
              </Panel>
            ) : (
              <EmptyState title="You have not joined an event yet">
                Open an event and choose “Find Your Partner”. Interest you receive and your matches are counted here.
              </EmptyState>
            )}
          </section>


        </div>
      </div>
    </div>
  );
}
