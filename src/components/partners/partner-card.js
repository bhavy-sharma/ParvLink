import { InterestButton } from "@/components/partners/interest-button";
import { PartnerMenu } from "@/components/partners/partner-menu";
import { Avatar } from "@/components/ui/avatar";
import { eventPaths } from "@/lib/auth/routes";
import { yearLabel } from "@/lib/format";

/**
 * One student in discovery or under "interests received".
 *
 * `person` is exactly what the database function returned: an event-specific
 * handle, first name, course, year, whether a photo exists, and how the viewer
 * relates to them. Received-interest cards may also include the event name.
 * There is no user id, email or other field to leak.
 */
export function PartnerCard({ slug, person, note = null, eventName = null, headingLevel = "h3" }) {
  const Heading = headingLevel;
  const paths = eventPaths(slug);
  return (
    <article className="flex h-full flex-col rounded-panel border border-line bg-surface p-5">
      <div className="flex items-center gap-4">
        <Avatar src={person.has_photo ? paths.photo(person.handle) : null} name={person.first_name} size="md" className="size-16" />
        <div className="min-w-0">
          <Heading className="truncate text-xl font-semibold">{person.first_name}</Heading>
          <p className="text-sm text-ink-muted">
            {person.course}
            {person.study_year ? `, ${yearLabel(person.study_year).toLowerCase()}` : ""}
          </p>
        </div>
      </div>
      {note ? <p className="mt-3 text-sm text-ink-muted">{note}</p> : null}
      {eventName ? (
        <p className="mt-2 text-xs font-semibold text-black ">
          Event: <span className="font-semibold text-ink">{eventName}</span>
        </p>
      ) : null}
      <div className="mt-4 flex flex-1 items-end">
        <InterestButton slug={slug} handle={person.handle} relation={person.relation} available={person.available ?? true} name={person.first_name} />
      </div>
      <div className="-mx-2 mt-4 border-t border-line pt-2">
        <PartnerMenu slug={slug} handle={person.handle} name={person.first_name} />
      </div>
    </article>
  );
}
