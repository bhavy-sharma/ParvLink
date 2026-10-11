import Link from "next/link";
import { EventDetails } from "@/components/events/event-details";
import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { requireManagedEvent } from "@/lib/auth/session";
import { getCollegeNames } from "@/lib/data/events";

export const metadata = { title: "Preview event" };

export default async function PreviewEventPage({ params }) {
  const { eventId } = await params;
  const { event } = await requireManagedEvent(eventId);
  const collegeNames = await getCollegeNames(event);
  const base = `${ROUTES.adminEvents}/${event.id}`;
  const isDraft = event.status === "draft";

  // Only the fields a student is given are passed to the shared view.
  const publicEvent = {
    title: event.title,
    description: event.description,
    event_type: event.event_type,
    venue: event.venue,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    registration_opens_at: event.registration_opens_at,
    registration_closes_at: event.registration_closes_at,
    minimum_age: event.minimum_age,
    eligibility_rules: event.eligibility_rules,
    requirements: event.requirements,
    // A draft is shown as it will look once published.
    status: isDraft ? "published" : event.status,
    college_id: event.college_id,
    colleges: event.colleges,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-marigold/60 bg-marigold-soft px-5 py-4 text-marigold-ink">
        <p className="max-w-xl text-sm">
          <strong>{isDraft ? "Preview." : "Student view."}</strong>{" "}
          {isDraft
            ? "This is how the event will look to students once published. It is not visible to them yet."
            : "This is what students see now."}
        </p>
        <div className="flex flex-wrap gap-2">
          {event.status !== "completed" ? (
            <ButtonLink href={`${base}/edit`} variant="secondary" size="sm">
              Edit
            </ButtonLink>
          ) : null}
          <ButtonLink href={base} size="sm">
            {isDraft ? "Go to publish" : "Manage event"}
          </ButtonLink>
        </div>
      </div>

      <EventDetails event={publicEvent} collegeNames={collegeNames} />

      <p>
        <Link href={ROUTES.adminEvents} className="text-sm font-semibold text-brand underline">
          Back to events
        </Link>
      </p>
    </div>
  );
}
