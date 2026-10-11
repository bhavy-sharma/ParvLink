import Link from "next/link";
import { DataTable } from "@/components/admin/data-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/admin/pagination";
import { pickFilter, pickQuery } from "@/components/events/event-filters";
import { Alert } from "@/components/ui/alert";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { accountState, hrefWith, pickDate, pickPage, reportReasonLabel, reportStatus } from "@/lib/admin";
import { describeDbError } from "@/lib/auth/errors";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdminWith } from "@/lib/auth/session";
import { listReportEvents, listReports } from "@/lib/data/admin";
import { formatDateTime } from "@/lib/dates";
import { ADMIN_PAGE_SIZE, ALL_REPORT_REASON_VALUES, ALL_REPORT_REASONS, REPORT_STATUS_VALUES, REPORT_STATUSES } from "@/lib/validation/limits";

export const metadata = { title: "Reports" };

/**
 * Reports about students of the colleges this admin moderates. Filtering,
 * searching and paging all happen in the database (admin_list_reports); this
 * page never holds more than one page of rows, and no report text.
 */
export default async function ReportsPage({ searchParams }) {
  const scope = await requireAdminWith("moderate_reports");
  const params = await searchParams;
  const colleges = scope.collegesWith("moderate_reports");
  const events = await listReportEvents();

  const filters = {
    search: pickQuery(params.q),
    status: pickFilter(params.status, REPORT_STATUS_VALUES),
    reason: pickFilter(params.reason, ALL_REPORT_REASON_VALUES),
    college: pickFilter(params.college, colleges.map((item) => item.id)),
    event: pickFilter(params.event, events.map((item) => item.event_id)),
    assigned: pickFilter(params.assigned, ["me", "none"]),
    from: pickDate(params.from),
    to: pickDate(params.to),
  };
  const page = pickPage(params.page);
  const hasFilters = Object.values(filters).some(Boolean);
  const { rows, total, error } = await listReports({ ...filters, page });
  const query = { q: filters.search, status: filters.status, reason: filters.reason, college: filters.college, event: filters.event, assigned: filters.assigned, from: filters.from, to: filters.to };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={
          scope.isSuperAdmin
            ? "Reports about students of every college."
            : `Reports about students of ${colleges.map((item) => item.name).join(", ")}. Reports you filed yourself, or that are about you, are handled by someone else and are not listed.`
        }
      />

      <FilterBar
        action={ROUTES.adminReports}
        label="Report filters"
        hasFilters={hasFilters}
        fields={[
          { type: "search", name: "q", label: "Reference or reported student", value: filters.search, placeholder: "R-1A2B3C4D or a first name" },
          { type: "select", name: "status", label: "Status", value: filters.status, options: [{ value: "", label: "Any status" }, ...REPORT_STATUSES] },
          { type: "select", name: "reason", label: "Category", value: filters.reason, options: [{ value: "", label: "Any category" }, ...ALL_REPORT_REASONS] },
          { type: "select", name: "assigned", label: "Assigned", value: filters.assigned, options: [{ value: "", label: "Anyone or nobody" }, { value: "me", label: "Assigned to me" }, { value: "none", label: "Unassigned" }] },
          ...(colleges.length > 1
            ? [{ type: "select", name: "college", label: "College", value: filters.college, options: [{ value: "", label: "Any college" }, ...colleges.map((item) => ({ value: item.id, label: item.name }))] }]
            : []),
          ...(events.length > 0
            ? [{ type: "select", name: "event", label: "Event", value: filters.event, options: [{ value: "", label: "Any event" }, ...events.map((item) => ({ value: item.event_id, label: item.title }))] }]
            : []),
          { type: "date", name: "from", label: "Submitted from", value: filters.from },
          { type: "date", name: "to", label: "Submitted to", value: filters.to },
        ]}
      />

      {error ? (
        <Alert tone="error">{error.message === "invalid_date_range" ? describeDbError(error) : "Reports could not be loaded. Reload the page to try again."}</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={hasFilters ? "No reports match these filters" : "No reports"}>
          {hasFilters ? "Change or clear the filters." : "When a student reports a profile or a conversation, it appears here for the moderators of the reported student’s college."}
        </EmptyState>
      ) : (
        <>
          <DataTable
            caption="Reports"
            columns={[
              { key: "ref", header: "Reference" },
              { key: "submitted", header: "Submitted" },
              { key: "category", header: "Category" },
              { key: "status", header: "Status" },
              { key: "reported", header: "Reported account" },
              { key: "reporter", header: "Reported by" },
              { key: "where", header: "College and event" },
              { key: "assigned", header: "Assigned" },
            ]}
            rows={rows.map((row) => {
              const status = reportStatus(row.status);
              return {
                key: row.report_id,
                cells: {
                  ref: (
                    <Link href={`${ROUTES.adminReports}/${row.report_id}`} className="font-semibold text-brand underline">
                      {row.ref}
                    </Link>
                  ),
                  submitted: <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time>,
                  category: (
                    <>
                      {reportReasonLabel(row.reason)}
                      <span className="block text-xs text-ink-muted">{row.kind === "chat" ? (row.has_evidence ? "From a chat, messages shared" : "From a chat") : "Profile"}</span>
                    </>
                  ),
                  status: <Badge tone={status.tone}>{status.label}</Badge>,
                  reported: row.reported_ref ? (
                    <>
                      {row.reported_name} <span className="text-ink-muted">({row.reported_ref})</span>
                      {row.reported_status === "suspended" ? <Badge tone={accountState({ status: "suspended" }).tone} className="ml-2">Suspended</Badge> : null}
                    </>
                  ) : (
                    <span className="text-ink-muted">Account deleted</span>
                  ),
                  reporter: row.reporter_ref ? (
                    <>
                      {row.reporter_name} <span className="text-ink-muted">({row.reporter_ref})</span>
                    </>
                  ) : (
                    <span className="text-ink-muted">Account deleted</span>
                  ),
                  where: (
                    <>
                      {row.college_name}
                      <span className="block text-xs text-ink-muted">{row.event_title ?? "No event"}</span>
                    </>
                  ),
                  assigned: row.assigned_to_me ? "You" : row.assigned ? "Another moderator" : <span className="text-ink-muted">Nobody</span>,
                },
              };
            })}
          />
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} hrefFor={(n) => hrefWith(ROUTES.adminReports, { ...query, page: n })} label="Report pages" />
        </>
      )}
    </div>
  );
}
