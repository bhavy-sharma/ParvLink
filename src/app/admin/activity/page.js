import { ActivityList } from "@/components/admin/activity-list";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/admin/pagination";
import { pickFilter } from "@/components/events/event-filters";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { AUDIT_CATEGORIES, hrefWith, pickDate, pickPage } from "@/lib/admin";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdminWith } from "@/lib/auth/session";
import { listAudit } from "@/lib/data/admin";
import { auditNames } from "@/lib/data/admin-people";
import { zonedInputToDate } from "@/lib/dates";
import { ADMIN_PAGE_SIZE } from "@/lib/validation/limits";

export const metadata = { title: "Activity" };

const nextDay = (day) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

/**
 * The audit log, newest first. Which entries come back is decided by row level
 * security on audit_logs: a Super Admin reads all of them; a college admin
 * reads those of their own colleges, of the kinds their permissions cover.
 * Entries can be read here, never changed.
 */
export default async function ActivityPage({ searchParams }) {
  const scope = await requireAdminWith("manage_events", "moderate_reports", "manage_students");
  const params = await searchParams;
  const colleges = scope.collegesWith();
  const categories = AUDIT_CATEGORIES.filter((item) => scope.isSuperAdmin || !item.superOnly);

  const filters = {
    category: pickFilter(params.category, categories.map((item) => item.value)),
    college: pickFilter(params.college, colleges.map((item) => item.id)),
    from: pickDate(params.from),
    to: pickDate(params.to),
  };
  const page = pickPage(params.page);
  const hasFilters = Object.values(filters).some(Boolean);

  const [{ rows, total, error }, names] = await Promise.all([
    listAudit({
      category: filters.category,
      college: filters.college,
      // Calendar days in the app's time zone → instants.
      from: filters.from ? zonedInputToDate(`${filters.from}T00:00`)?.toISOString() : null,
      to: filters.to ? zonedInputToDate(`${nextDay(filters.to)}T00:00`)?.toISOString() : null,
      page,
    }),
    auditNames(scope),
  ]);
  const collegeNames = new Map(colleges.map((item) => [item.id, item.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description={
          scope.isSuperAdmin
            ? "Every recorded administrative action. Entries are added by the database and cannot be edited or removed from the app."
            : "Recorded actions in your colleges, as far as your permissions cover them. Entries cannot be edited or removed."
        }
      />

      <FilterBar
        action={ROUTES.adminActivity}
        label="Activity filters"
        hasFilters={hasFilters}
        fields={[
          { type: "select", name: "category", label: "About", value: filters.category, options: [{ value: "", label: "Everything" }, ...categories] },
          ...(colleges.length > 1
            ? [{ type: "select", name: "college", label: "College", value: filters.college, options: [{ value: "", label: "Any college" }, ...colleges.map((item) => ({ value: item.id, label: item.name }))] }]
            : []),
          { type: "date", name: "from", label: "From", value: filters.from },
          { type: "date", name: "to", label: "To", value: filters.to },
        ]}
      />

      {error ? (
        <Alert tone="error">The activity log could not be loaded. Reload the page to try again.</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={hasFilters ? "Nothing matches these filters" : "Nothing recorded yet"}>
          {hasFilters ? "Change or clear the filters." : "Actions on events, reports and student accounts are listed here as they happen."}
        </EmptyState>
      ) : (
        <>
          <ActivityList entries={rows} {...names} collegeName={(id) => collegeNames.get(id) ?? null} />
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} hrefFor={(n) => hrefWith(ROUTES.adminActivity, { ...filters, page: n })} label="Activity pages" />
        </>
      )}
    </div>
  );
}
