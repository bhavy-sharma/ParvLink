import Link from "next/link";
import { StatusBadge, TypeBadge } from "@/components/events/event-badges";
import { EventFilters, pickFilter, pickQuery } from "@/components/events/event-filters";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { requireEventManager } from "@/lib/auth/session";
import { formatDate, formatEventRange } from "@/lib/dates";
import { EVENT_STATUS_VALUES, EVENT_STATUSES, EVENT_TYPE_VALUES, EVENT_TYPES, ROLES } from "@/lib/validation/limits";
import { call } from "@/lib/services";

export const metadata = { title: "Events" };

const PAGE_LIMIT = 100;

export default async function AdminEventsPage({ searchParams }) {
  const { role, colleges } = await requireEventManager();
  const params = await searchParams;

  if (colleges.length === 0) {
    return (
      <div className="space-y-8">
        <PageHeader title="Events" />
        <EmptyState title={role === ROLES.SUPER_ADMIN ? "Add a college first" : "You cannot manage events yet"}>
          {role === ROLES.SUPER_ADMIN
            ? "Events belong to a host college. Add a college, then come back to create its first event."
            : "A Super Admin needs to assign you a college with the “Manage events” permission."}
        </EmptyState>
      </div>
    );
  }

  const collegeIds = colleges.map((college) => college.id);
  const q = pickQuery(params.q);
  const status = pickFilter(params.status, EVENT_STATUS_VALUES);
  const type = pickFilter(params.type, EVENT_TYPE_VALUES);
  const college = pickFilter(params.college, collegeIds);
  const hasFilters = Boolean(q || status || type || college);

  // Scoped twice: to this admin's colleges here, and again by the service.
  const { data: events, error } = await call("admin_list_events", { college: college || null, status: status || null, type: type || null, search: q || null, limit: PAGE_LIMIT });
  if (error) throw new Error("Events could not be loaded.");

  const canCreate = colleges.some((item) => item.is_active);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description={
          role === ROLES.SUPER_ADMIN ? "Events for every college." : `Events for ${colleges.map((item) => item.name).join(", ")}.`
        }
        actions={canCreate ? <ButtonLink href={`${ROUTES.adminEvents}/new`}>Create event</ButtonLink> : null}
      />

      <EventFilters
        action={ROUTES.adminEvents}
        query={q}
        searchLabel="Search by title"
        hasFilters={hasFilters}
        selects={[
          { name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...EVENT_STATUSES] },
          { name: "college", label: "Host college", value: college, options: [{ value: "", label: "Any college" }, ...colleges.map((item) => ({ value: item.id, label: item.name }))] },
          { name: "type", label: "Type", value: type, options: [{ value: "", label: "Any type" }, ...EVENT_TYPES] },
        ]}
      />

      {events.length === 0 ? (
        hasFilters ? (
          <EmptyState title="No events match those filters" action={<ButtonLink href={ROUTES.adminEvents} variant="secondary">Clear filters</ButtonLink>}>
            Try a different search, or clear the filters to see everything.
          </EmptyState>
        ) : (
          <EmptyState
            title="No events yet"
            action={canCreate ? <ButtonLink href={`${ROUTES.adminEvents}/new`}>Create the first event</ButtonLink> : null}
          >
            Events you create are saved as drafts first. Students see them once you publish.
          </EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {events.length === 1 ? "1 event" : `${events.length} events`}
            {events.length === PAGE_LIMIT ? ` (showing the ${PAGE_LIMIT} most recent by date — narrow the filters to see others)` : ""}
          </p>
          <div className="overflow-hidden rounded-panel border border-line bg-surface">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Events you can manage</caption>
              <thead className="hidden border-b border-line bg-paper text-ink-muted md:table-header-group">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">Event</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Host college</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Event date</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Created</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.map((event) => {
                  const href = `${ROUTES.adminEvents}/${event.id}`;
                  return (
                    <tr key={event.id} className="flex flex-col gap-1.5 px-5 py-4 md:table-row md:p-0">
                      <th scope="row" className="font-normal md:px-5 md:py-4">
                        <Link href={href} className="text-base font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                          {event.title}
                        </Link>
                        <span className="mt-1 block">
                          <TypeBadge type={event.event_type} />
                        </span>
                      </th>
                      <td className="md:px-3 md:py-4">
                        <span className="text-ink-muted md:hidden">Host: </span>
                        {event.colleges?.name ?? "—"}
                      </td>
                      <td className="md:px-3 md:py-4">{formatEventRange(event.starts_at, event.ends_at)}</td>
                      <td className="md:px-3 md:py-4">
                        <StatusBadge status={event.status} />
                      </td>
                      <td className="text-ink-muted md:px-3 md:py-4">
                        <span className="md:hidden">Created </span>
                        {formatDate(event.created_at)}
                      </td>
                      <td className="md:px-5 md:py-4 md:text-right">
                        <span className="flex flex-wrap gap-x-4 gap-y-1 font-semibold md:justify-end">
                          <Link href={href} className="text-brand underline">
                            Manage<span className="sr-only"> {event.title}</span>
                          </Link>
                          {event.status !== "completed" ? (
                            <Link href={`${href}/edit`} className="text-brand underline">
                              Edit<span className="sr-only"> {event.title}</span>
                            </Link>
                          ) : null}
                          <Link href={`${href}/preview`} className="text-brand underline">
                            {event.status === "draft" ? "Preview" : "View"}
                            <span className="sr-only"> {event.title}</span>
                          </Link>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
