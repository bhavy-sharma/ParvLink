import Link from "next/link";
import { ActivityList } from "@/components/admin/activity-list";
import { FilterBar } from "@/components/admin/filter-bar";
import { Stat, StatGroup } from "@/components/admin/stat";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { daysAgoIso, formatCount, hrefWith, pickDate } from "@/lib/admin";
import { ROUTES } from "@/lib/auth/routes";
import { getAdminScope } from "@/lib/auth/session";
import { getInboxCounts, getOverviewStats, listAudit } from "@/lib/data/admin";
import { auditNames } from "@/lib/data/admin-people";
import { APP_TIME_ZONE, formatDate, formatDateTime, timeZoneLabel } from "@/lib/dates";
import { pickFilter } from "@/components/events/event-filters";
import { collegeLabel } from "@/lib/format";
import { ADMIN_PERMISSIONS } from "@/lib/validation/limits";

export const metadata = { title: "Overview" };

const PERMISSION_LABEL = Object.fromEntries(ADMIN_PERMISSIONS.map((p) => [p.value, p.label]));

/**
 * The admin overview. Every number comes from admin_overview_stats(), which
 * counts in the database for exactly the colleges and permissions this admin
 * has; nothing is counted in the browser and nothing here is a placeholder.
 */
export default async function AdminOverviewPage({ searchParams }) {
  const scope = await getAdminScope();
  const params = await searchParams;
  const colleges = scope.collegesWith();
  const college = pickFilter(params.college, colleges.map((item) => item.id));
  const from = pickDate(params.from);
  const to = pickDate(params.to);
  const hasPeriod = Boolean(from || to);

  const [{ stats, error }, activity, names, inbox] = await Promise.all([
    getOverviewStats({ college, from, to }),
    listAudit({ pageSize: 8 }),
    auditNames(scope),
    scope.isSuperAdmin ? getInboxCounts() : null,
  ]);
  const collegeNames = new Map(colleges.map((item) => [item.id, item.name]));
  const today = daysAgoIso(0, APP_TIME_ZONE);
  const period = hasPeriod ? `${from ? formatDate(from) : "the beginning"} to ${to ? formatDate(to) : "today"}` : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title={scope.isSuperAdmin ? "Overview" : "Your colleges"}
        description={
          scope.isSuperAdmin ? "You have access to every college." : "You can act only on the colleges listed here, within the permissions shown."
        }
        actions={
          scope.isSuperAdmin ? (
            <>
              <ButtonLink href={ROUTES.adminEvents} variant="secondary" size="sm">
                Manage events
              </ButtonLink>
              <ButtonLink href={ROUTES.adminColleges} variant="secondary" size="sm">
                Manage colleges
              </ButtonLink>
              <ButtonLink href={ROUTES.adminAdmins} variant="secondary" size="sm">
                Manage admins
              </ButtonLink>
            </>
          ) : scope.can("manage_events") ? (
            <ButtonLink href={ROUTES.adminEvents} size="sm">
              Manage events
            </ButtonLink>
          ) : null
        }
      />

      {!scope.isSuperAdmin ? <Assignments assignments={scope.assignments} students={college ? null : stats?.students} /> : null}

      {scope.isSuperAdmin && colleges.length === 0 ? (
        <EmptyState title="Start by adding a college" action={<ButtonLink href={ROUTES.adminColleges}>Add a college</ButtonLink>}>
          Students cannot create a profile until at least one college is open.
        </EmptyState>
      ) : null}

      {colleges.length > 0 ? (
        <>
          <FilterBar
            action={ROUTES.admin}
            label="Overview filters"
            hasFilters={Boolean(college || hasPeriod)}
            fields={[
              ...(colleges.length > 1
                ? [{ type: "select", name: "college", label: "College", value: college, options: [{ value: "", label: "All my colleges" }, ...colleges.map((item) => ({ value: item.id, label: item.name }))] }]
                : []),
              { type: "date", name: "from", label: "Activity from", value: from },
              { type: "date", name: "to", label: "Activity to", value: to },
            ]}
          />
          <p className="-mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span className="text-ink-muted">Quick ranges:</span>
            <Link className="font-semibold text-brand underline" href={hrefWith(ROUTES.admin, { college, from: daysAgoIso(6, APP_TIME_ZONE), to: today })}>
              Last 7 days
            </Link>
            <Link className="font-semibold text-brand underline" href={hrefWith(ROUTES.admin, { college, from: daysAgoIso(29, APP_TIME_ZONE), to: today })}>
              Last 30 days
            </Link>
            <Link className="font-semibold text-brand underline" href={hrefWith(ROUTES.admin, { college })}>
              All time
            </Link>
          </p>

          {error || !stats ? (
            <Alert tone="error">The numbers could not be loaded. Reload the page to try again.</Alert>
          ) : (
            <Numbers stats={stats} period={period} college={college} inbox={inbox} />
          )}
        </>
      ) : null}

      <section aria-labelledby="activity">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="activity" className="text-xl font-semibold">
            Recent admin activity
          </h2>
          {activity.rows.length > 0 ? (
            <Link href={ROUTES.adminActivity} className="text-sm font-semibold text-brand underline">
              Full activity log
            </Link>
          ) : null}
        </div>
        {activity.error ? (
          <Alert tone="error">The activity list could not be loaded.</Alert>
        ) : activity.rows.length === 0 ? (
          <EmptyState title="Nothing recorded yet">
            {scope.isSuperAdmin
              ? "Changes to colleges, admin roles, events, reports and student accounts are listed here as they happen."
              : "Changes to events, reports and student accounts in your colleges are listed here, as far as your permissions cover them."}
          </EmptyState>
        ) : (
          <ActivityList entries={activity.rows} {...names} collegeName={(id) => collegeNames.get(id) ?? null} />
        )}
      </section>

      {stats ? (
        <p className="text-xs text-ink-muted">
          Counted at {formatDateTime(stats.generated_at)} ({timeZoneLabel()}). Dates and day boundaries use {APP_TIME_ZONE}.
        </p>
      ) : null}
    </div>
  );
}

function Assignments({ assignments, students }) {
  if (assignments.length === 0) {
    return (
      <EmptyState title="No colleges assigned yet">
        A Super Admin needs to assign you to a college before you can see anything here. Ask them to do that from their Admins screen.
      </EmptyState>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {assignments.map(({ college, permissions }) => {
        const seesStudents = permissions.some((permission) => ["view_students", "manage_students"].includes(permission));
        return (
          <li key={college.id}>
            <Panel as="article" className="h-full">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-xl font-semibold">{collegeLabel(college) || "College"}</h2>
                {!college.is_active ? <Badge>Closed</Badge> : null}
              </div>
              <p className="mt-2 text-sm text-ink-muted">
                {!seesStudents
                  ? "Your permissions here do not include student profiles."
                  : assignments.length === 1 && students
                    ? Number(students.total) === 1
                      ? "1 student profile"
                      : `${formatCount(students.total)} student profiles`
                    : "Student numbers are in the table on the Analytics page."}
              </p>
              <p className="mt-4 flex flex-wrap gap-1.5">
                {permissions.map((permission) => (
                  <Badge key={permission} tone="brand">
                    {PERMISSION_LABEL[permission] ?? permission}
                  </Badge>
                ))}
              </p>
            </Panel>
          </li>
        );
      })}
    </ul>
  );
}

function Numbers({ stats, period, college, inbox }) {
  const { students, reports, events, participation, interests, matches, accounts, colleges } = stats;
  const reportsHref = (status) => hrefWith(ROUTES.adminReports, { status, college });
  const attention = [
    reports ? { label: "Pending reports", value: reports.pending, note: "Submitted, nobody has started on them.", href: reportsHref("open"), tone: "attention" } : null,
    reports ? { label: "Reports under review", value: reports.in_review, note: "Being looked at, not yet decided.", href: reportsHref("in_review") } : null,
    students ? { label: "Accounts under review", value: students.under_review, note: "Flagged by a moderator. Not restricted.", href: hrefWith(ROUTES.adminUsers, { status: "under_review", college }) } : null,
    { label: "Events to mark completed", value: events.ended_unmarked, note: "End time has passed; status is still published or closed.", href: ROUTES.adminEvents },
    inbox ? { label: "Deletion requests", value: inbox.deletion_requests, note: "Held for a Super Admin’s decision.", href: ROUTES.adminDeletions, tone: "attention" } : null,
    inbox ? { label: "New feedback", value: inbox.feedback_new, note: "Not yet marked as reviewed.", href: hrefWith(ROUTES.adminFeedback, { status: "new" }) } : null,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <StatGroup title="Needs attention">
        {attention.map((item) => (
          <Stat key={item.label} {...item} />
        ))}
      </StatGroup>

      {period ? (
        <StatGroup title="In the selected period" description={`Counted by the day each record was created, ${period}.`} columns="sm:grid-cols-2 lg:grid-cols-5">
          {students ? <Stat label="New student profiles" value={students.in_period} /> : null}
          <Stat label="Event participations" value={participation.in_period} note="Students joining an event." />
          <Stat label="Interests sent" value={interests.in_period} />
          <Stat label="Matches made" value={matches.in_period} note="Pairs, not people." />
          {reports ? <Stat label="Reports submitted" value={reports.in_period} /> : null}
        </StatGroup>
      ) : null}

      {students || accounts ? (
        <StatGroup title="Students" description="Right now. A student is one profile; each belongs to exactly one college.">
          {accounts ? <Stat label="Registered accounts" value={accounts.registered} note={`${formatCount(accounts.email_confirmed)} confirmed their email; ${formatCount(accounts.without_profile)} have no profile yet (includes admins).`} /> : null}
          {students ? (
            <>
              <Stat label="Student profiles" value={students.total} href={hrefWith(ROUTES.adminUsers, { college })} />
              <Stat label="Active" value={students.active} note="Can use the platform." />
              <Stat label="Suspended" value={students.suspended} note="Suspended by an admin." href={hrefWith(ROUTES.adminUsers, { status: "suspended", college })} />
            </>
          ) : null}
        </StatGroup>
      ) : null}

      <StatGroup
        title="Events"
        description={`Events hosted by ${college ? "this college" : colleges.total === 1 ? "your college" : `${formatCount(colleges.total)} colleges (${formatCount(colleges.open)} open)`}. Drafts are not counted.`}
      >
        <Stat label="Published" value={events.published} note="Visible to invited students." />
        <Stat label="Upcoming" value={events.upcoming} note="Published or closed, not started yet." />
        <Stat label="Ongoing" value={events.ongoing} note="Started and not yet ended." />
        <Stat label="Completed" value={events.completed} note="Marked completed by an admin." />
      </StatGroup>

      <StatGroup title="Partner finding" description="All time, for the events above. Participants from invited colleges are included.">
        <Stat label="Participations" value={participation.participations} note={`One per student per event. ${formatCount(participation.participants)} different students.`} />
        <Stat label="Active discovery profiles" value={participation.active_discovery} note="Open right now: profile open, account active, event accepting participants." />
        <Stat label="Interests sent" value={interests.total} note="One per sender, receiver and event." />
        <Stat label="Matches" value={matches.total} note="Mutual interest. One per pair per event — not counted per person." />
      </StatGroup>

      {reports ? (
        <StatGroup title="Reports" description="All time, about students of these colleges. Pending and under-review counts are above.">
          <Stat label="Submitted" value={reports.submitted} href={hrefWith(ROUTES.adminReports, { college })} />
          <Stat label="Resolved" value={reports.resolved} href={reportsHref("resolved")} />
          <Stat label="Dismissed" value={reports.dismissed} href={reportsHref("dismissed")} />
        </StatGroup>
      ) : (
        <p className="text-sm text-ink-muted">Report numbers are not shown: your permissions do not include “Moderate reports”.</p>
      )}

      {!students ? <p className="text-sm text-ink-muted">Student numbers are not shown: your permissions do not include student profiles.</p> : null}
      <p className="text-sm text-ink-muted">Verified-student counts are not shown because student verification is not built yet.</p>
    </div>
  );
}
