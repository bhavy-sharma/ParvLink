import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireEventManager } from "@/lib/auth/session";
import { listActiveColleges } from "@/lib/data/colleges";
import { APP_TIME_ZONE, timeZoneLabel } from "@/lib/dates";
import { blankEventFormValues } from "@/lib/events";
import { EventForm } from "../event-form";

export const metadata = { title: "Create event" };

export default async function NewEventPage() {
  const { colleges } = await requireEventManager();
  const hostColleges = colleges.filter((college) => college.is_active);
  const invitableColleges = await listActiveColleges();

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href={ROUTES.adminEvents} className="text-sm font-semibold text-brand underline">
          Back to events
        </Link>
        <div className="mt-3">
          <PageHeader title="Create event" description="It is saved as a draft. Students see nothing until you publish." />
        </div>
      </div>

      {hostColleges.length === 0 ? (
        <EmptyState title="No open college to host an event">You can only create events for an open college you manage.</EmptyState>
      ) : (
        <EventForm
          mode="create"
          hostColleges={hostColleges}
          invitableColleges={invitableColleges}
          initialValues={blankEventFormValues(hostColleges.length === 1 ? hostColleges[0].id : "")}
          timeZone={`${timeZoneLabel()} (${APP_TIME_ZONE})`}
          cancelHref={ROUTES.adminEvents}
        />
      )}
    </div>
  );
}
