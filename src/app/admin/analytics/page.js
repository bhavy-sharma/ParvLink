import Link from "next/link";
import { DataTable } from "@/components/admin/data-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/admin/pagination";
import { StatusBadge } from "@/components/events/event-badges";
import { pickFilter, pickQuery } from "@/components/events/event-filters";
import { Alert } from "@/components/ui/alert";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { formatCount, hrefWith, pickDate, pickPage } from "@/lib/admin";
import { describeDbError } from "@/lib/auth/errors";
import { ROUTES } from "@/lib/auth/routes";
import { getAdminScope } from "@/lib/auth/session";
import { getCollegeStats, getEventStats } from "@/lib/data/admin";
import { APP_TIME_ZONE, formatDate } from "@/lib/dates";
import { ADMIN_PAGE_SIZE, EVENT_STATUS_VALUES, EVENT_STATUSES } from "@/lib/validation/limits";

export const metadata = { title: "Analytics" };

/**
 * College and event numbers. Both tables are aggregated in the database
 * (admin_college_stats, admin_event_stats) for the colleges this admin is
 * assigned to; a cell the admin's permissions do not cover comes back empty
 * and is shown as "—". No row describes an individual student.
 */
export default async function AnalyticsPage({ searchParams }) {
  const scope = await getAdminScope();
  const params = await searchParams;
  const colleges = scope.collegesWith();
  const manages = new Set(scope.collegesWith("manage_events").map((item) => item.id));

  const from = pickDate(params.from);
  const to = pickDate(params.to);
  const filters = {
    college: pickFilter(params.college, colleges.map((item) => item.id)),
    status: pickFilter(params.status, EVENT_STATUS_VALUES),
    search: pickQuery(params.q),
  };
  const page = pickPage(params.page);
  const hasFilters = Boolean(from || to || filters.college || filters.status || filters.search);

  if (colleges.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Analytics" />
        <EmptyState title={scope.isSuperAdmin ? "Add a college first" : "No colleges assigned yet"}>
          {scope.isSuperAdmin ? "Numbers appear once there is a college with events." : "A Super Admin needs to assign you to a college."}
        </EmptyState>
      </div>
    );
  }

  const [collegeStats, eventStats] = await Promise.all([getCollegeStats({ from, to }), getEventStats({ ...filters, page })]);
  const period = from || to ? `${from ? formatDate(from) : "the beginning"} to ${to ? formatDate(to) : "today"}` : "all time";
  const query = { from, to, college: filters.college, status: filters.status, q: filters.search };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Analytics"
        description={scope.isSuperAdmin ? "Every college and its events." : `For ${colleges.map((item) => item.name).join(", ")}.`}
      />

      <FilterBar
        action={ROUTES.adminAnalytics}
        label="Analytics filters"
        hasFilters={hasFilters}
        fields={[
          { type: "date", name: "from", label: "Activity from", value: from },
          { type: "date", name: "to", label: "Activity to", value: to },
          { type: "search", name: "q", label: "Event title contains", value: filters.search },
          { type: "select", name: "status", label: "Event status", value: filters.status, options: [{ value: "", label: "Any status" }, ...EVENT_STATUSES] },
          ...(colleges.length > 1
            ? [{ type: "select", name: "college", label: "Events hosted by", value: filters.college, options: [{ value: "", label: "Any college" }, ...colleges.map((item) => ({ value: item.id, label: item.name }))] }]
            : []),
        ]}
      />

      <section aria-labelledby="by-college" className="space-y-3">
        <h2 id="by-college" className="text-xl font-semibold">
          By college
        </h2>
        {collegeStats.error ? (
          <Alert tone="error">{collegeStats.error.message === "invalid_date_range" ? describeDbError(collegeStats.error) : "College numbers could not be loaded."}</Alert>
        ) : (
          <>
            <DataTable
              caption="Numbers by college"
              columns={[
                { key: "college", header: "College" },
                { key: "students", header: "Students", align: "right" },
                { key: "suspended", header: "Suspended", align: "right" },
                { key: "published", header: "Published events", align: "right" },
                { key: "completed", header: "Completed events", align: "right" },
                { key: "active", header: "Active discovery", align: "right" },
                { key: "participations", header: "Participations*", align: "right" },
                { key: "interests", header: "Interests*", align: "right" },
                { key: "matches", header: "Matches*", align: "right" },
                { key: "reports", header: "Reports*", align: "right" },
                { key: "closed", header: "Decided*", align: "right" },
              ]}
              rows={collegeStats.rows.map((row) => ({
                key: row.college_id,
                cells: {
                  college: (
                    <>
                      <span className="font-semibold">{row.college_name}</span>
                      {!row.is_active ? <Badge className="ml-2">Closed</Badge> : null}
                    </>
                  ),
                  students: formatCount(row.students),
                  suspended: formatCount(row.students_suspended),
                  published: formatCount(row.events_published),
                  completed: formatCount(row.events_completed),
                  active: formatCount(row.active_discovery),
                  participations: formatCount(row.participations),
                  interests: formatCount(row.interests),
                  matches: formatCount(row.matches),
                  reports: formatCount(row.reports_submitted),
                  closed: formatCount(row.reports_closed),
                },
              }))}
            />
            <Definitions period={period} />
          </>
        )}
      </section>

      <section aria-labelledby="by-event" className="space-y-3">
        <h2 id="by-event" className="text-xl font-semibold">
          By event
        </h2>
        {eventStats.error ? (
          <Alert tone="error">Event numbers could not be loaded.</Alert>
        ) : eventStats.rows.length === 0 ? (
          <EmptyState title={filters.college || filters.status || filters.search ? "No events match these filters" : "No events yet"}>
            {filters.college || filters.status || filters.search ? "Change or clear the filters." : "Numbers appear here once an event has been created."}
          </EmptyState>
        ) : (
          <>
            <DataTable
              caption="Numbers by event (all time)"
              columns={[
                { key: "event", header: "Event" },
                { key: "status", header: "Status" },
                { key: "participants", header: "Participants", align: "right" },
                { key: "active", header: "Active discovery", align: "right" },
                { key: "interests", header: "Interests sent", align: "right" },
                { key: "matches", header: "Matches (pairs)", align: "right" },
                { key: "matched", header: "Students matched", align: "right" },
                { key: "reports", header: "Reports", align: "right" },
              ]}
              rows={eventStats.rows.map((row) => ({
                key: row.event_id,
                cells: {
                  event: (
                    <>
                      {manages.has(row.college_id) ? (
                        <Link href={`${ROUTES.adminEvents}/${row.event_id}`} className="font-semibold text-brand underline">
                          {row.title}
                        </Link>
                      ) : (
                        <span className="font-semibold">{row.title}</span>
                      )}
                      <span className="block text-xs text-ink-muted">
                        {row.college_name} · {formatDate(row.starts_at)}
                      </span>
                    </>
                  ),
                  status: <StatusBadge status={row.status} />,
                  participants: formatCount(row.participants),
                  active: formatCount(row.active_discovery),
                  interests: formatCount(row.interests),
                  matches: formatCount(row.matches),
                  matched: formatCount(row.matched_participants),
                  reports: formatCount(row.reports),
                },
              }))}
            />
            <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={eventStats.total} hrefFor={(n) => hrefWith(ROUTES.adminAnalytics, { ...query, page: n })} label="Event pages" />
            <p className="text-sm text-ink-muted">
              Event numbers are totals since the event was created; the date filter does not apply to this table. A participation rate is not shown:
              the number of students who <em>could</em> have joined depends on course wording in profiles and cannot be counted reliably.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Definitions({ period }) {
  return (
    <details className="rounded-field border border-line bg-surface px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold">What these numbers mean</summary>
      <dl className="mt-3 grid gap-x-8 gap-y-2 text-ink-muted sm:grid-cols-2">
        <div>
          <dt className="inline font-semibold text-ink">Students, Suspended: </dt>
          <dd className="inline">profiles of that college, right now.</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">Published / Completed events: </dt>
          <dd className="inline">events hosted by that college with that status, right now. Drafts are not counted.</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">Active discovery: </dt>
          <dd className="inline">event profiles open right now — profile open, account active, event accepting participants.</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">Participations: </dt>
          <dd className="inline">students joining an event hosted by that college (one per student per event, any college).</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">Interests: </dt>
          <dd className="inline">one per sender, receiver and event.</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">Matches: </dt>
          <dd className="inline">mutual interest, counted once per pair per event — never once per person.</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">Reports, Decided: </dt>
          <dd className="inline">reports about students of that college; “decided” are those now resolved or dismissed.</dd>
        </div>
        <div>
          <dt className="inline font-semibold text-ink">—: </dt>
          <dd className="inline">not covered by your permissions for that college.</dd>
        </div>
      </dl>
      <p className="mt-3 text-ink-muted">
        * Counted by creation day, for {period}. Days are calendar days in {APP_TIME_ZONE}. The other columns are the state right now.
      </p>
    </details>
  );
}
