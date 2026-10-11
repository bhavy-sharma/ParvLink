import { EventCard } from "@/components/events/event-card";
import { EventFilters, pickFilter, pickQuery } from "@/components/events/event-filters";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireProfile } from "@/lib/auth/session";
import { listStudentEvents } from "@/lib/data/student-events";
import { EVENT_TYPE_VALUES, EVENT_TYPES } from "@/lib/validation/limits";

export const metadata = { title: "Events" };

const WHEN = [
  { value: "", label: "Open and upcoming" },
  { value: "open", label: "Open now" },
  { value: "upcoming", label: "Opening soon" },
  { value: "past", label: "Closed and completed" },
  { value: "all", label: "Everything" },
];
const HOSTS = [
  { value: "", label: "Any college" },
  { value: "mine", label: "My college" },
  { value: "others", label: "Other colleges" },
];

function matchesWhen(phase, when) {
  if (when === "all") return true;
  if (when === "past") return phase === "closed" || phase === "completed";
  if (when === "open" || when === "upcoming") return phase === when;
  return phase === "open" || phase === "upcoming";
}

export default async function EventsPage({ searchParams }) {
  const { profile } = await requireProfile();
  const params = await searchParams;

  const q = pickQuery(params.q);
  const type = pickFilter(params.type, EVENT_TYPE_VALUES);
  const when = pickFilter(params.when, WHEN.map((option) => option.value));
  const host = pickFilter(params.host, HOSTS.map((option) => option.value));
  const hasFilters = Boolean(q || type || when || host);

  const all = await listStudentEvents();
  const needle = q.toLowerCase();
  const events = all.filter(
    (event) =>
      matchesWhen(event.phase, when) &&
      (!type || event.event_type === type) &&
      (!host || (host === "mine") === (event.college_id === profile.college_id)) &&
      (!needle || [event.title, event.description, event.venue, event.colleges?.name].some((field) => field?.toLowerCase().includes(needle))),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Events" description="Events your college is invited to. Open one to see the details and whether you can take part." />

      <EventFilters
        action={ROUTES.events}
        query={q}
        searchLabel="Search events"
        hasFilters={hasFilters}
        selects={[
          { name: "when", label: "Show", value: when, options: WHEN },
          { name: "type", label: "Type", value: type, options: [{ value: "", label: "Any type" }, ...EVENT_TYPES] },
          { name: "host", label: "Hosted by", value: host, options: HOSTS },
        ]}
      />

      {events.length === 0 ? (
        all.length === 0 ? (
          <EmptyState title="No events yet">
            When {profile.colleges?.name ?? "your college"} or a college that invites yours publishes an event, it appears here.
          </EmptyState>
        ) : hasFilters ? (
          <EmptyState title="No events match those filters" action={<ButtonLink href={ROUTES.events} variant="secondary">Clear filters</ButtonLink>}>
            Try a different search, or clear the filters.
          </EmptyState>
        ) : (
          <EmptyState
            title="Nothing open or coming up right now"
            action={<ButtonLink href={`${ROUTES.events}?when=past`} variant="secondary">See closed and completed events</ButtonLink>}
          >
            New events appear here as soon as they are published.
          </EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {events.length === 1 ? "1 event" : `${events.length} events`}
          </p>
          <ul className="grid gap-5 md:grid-cols-2">
            {events.map((event) => (
              <li key={event.id}>
                <EventCard event={event} headingLevel="h2" />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
