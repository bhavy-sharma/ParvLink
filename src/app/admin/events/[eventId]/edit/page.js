import Link from "next/link";
import { StatusBadge } from "@/components/events/event-badges";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireManagedEvent } from "@/lib/auth/session";
import { listActiveColleges } from "@/lib/data/colleges";
import { APP_TIME_ZONE, timeZoneLabel } from "@/lib/dates";
import { eventToFormValues } from "@/lib/events";
import { EventForm } from "../../event-form";
import { call } from "@/lib/services";

export const metadata = { title: "Edit event" };

export default async function EditEventPage({ params }) {
  const { eventId } = await params;
  const { event } = await requireManagedEvent(eventId);

  // Open colleges, plus any already-invited college that has since closed, so
  // saving the form does not silently drop it.
  const active = await listActiveColleges();
  const invitedIds = event.eligibility_rules?.colleges?.ids ?? [];
  const missing = invitedIds.filter((id) => !active.some((college) => college.id === id));
  let invitable = active;
  if (missing.length > 0) {
    const { data } = await call("college_names", { ids: missing });
    invitable = [...active, ...(data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  const base = `${ROUTES.adminEvents}/${event.id}`;
  const completed = event.status === "completed";

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href={base} className="text-sm font-semibold text-brand underline">
          Back to the event
        </Link>
        <div className="mt-3">
          <PageHeader title="Edit event" description={event.title} actions={<StatusBadge status={event.status} />} />
        </div>
      </div>

      {completed ? (
        <Alert tone="warning" title="This event is completed">
          Completed events are kept as a record and can no longer be edited.
        </Alert>
      ) : event.status === "published" ? (
        <Alert tone="warning" title="Students can already see this event">
          Changes show up for them as soon as you save. Changing the date, the venue or who can take part affects people who have already made plans — tell them separately.
        </Alert>
      ) : event.status === "closed" ? (
        <Alert tone="info">This event is closed to new participants but still visible to students. Changes show up as soon as you save.</Alert>
      ) : null}

      <EventForm
        mode="edit"
        eventId={event.id}
        hostCollege={event.colleges ?? { id: event.college_id, name: "Host college" }}
        invitableColleges={invitable}
        initialValues={eventToFormValues(event)}
        timeZone={`${timeZoneLabel(event.starts_at)} (${APP_TIME_ZONE})`}
        cancelHref={base}
        locked={completed}
      />
    </div>
  );
}
