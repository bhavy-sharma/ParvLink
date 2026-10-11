import Link from "next/link";
import { PhaseBadge, TypeBadge } from "@/components/events/event-badges";
import { CalendarIcon, PinIcon } from "@/components/ui/icons-extra";
import { ROUTES } from "@/lib/auth/routes";
import { formatEventRange } from "@/lib/dates";

function excerpt(text, max = 150) {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", max) > 60 ? flat.lastIndexOf(" ", max) : max)}…`;
}

/** One event in a student list. The whole card is one link. */
export function EventCard({ event, headingLevel = "h3" }) {
  const Heading = headingLevel;
  return (
    <article className="relative flex h-full flex-col rounded-panel border border-line bg-surface p-5 transition-colors focus-within:border-brand hover:border-line-strong">
      <p className="flex flex-wrap items-center gap-2">
        <TypeBadge type={event.event_type} />
        <PhaseBadge event={event} />
      </p>
      <Heading className="mt-3 text-xl font-semibold">
        <Link href={`${ROUTES.events}/${event.slug}`} className="after:absolute after:inset-0 after:rounded-panel focus-visible:outline-none">
          {event.title}
        </Link>
      </Heading>
      <p className="mt-1 text-sm text-ink-muted">Hosted by {event.colleges?.name ?? "a college on Campus Partner Finder"}</p>
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt>
            <CalendarIcon className="mt-0.5 size-4 text-ink-muted" />
            <span className="sr-only">When</span>
          </dt>
          <dd>{formatEventRange(event.starts_at, event.ends_at)}</dd>
        </div>
        <div className="flex gap-2">
          <dt>
            <PinIcon className="mt-0.5 size-4 text-ink-muted" />
            <span className="sr-only">Where</span>
          </dt>
          <dd>{event.venue || "Venue to be announced"}</dd>
        </div>
      </dl>
      {event.description ? <p className="mt-3 text-sm text-ink-muted">{excerpt(event.description)}</p> : null}
    </article>
  );
}
