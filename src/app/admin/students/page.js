import Link from "next/link";
import { DataTable } from "@/components/admin/data-table";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/admin/pagination";
import { pickFilter, pickQuery } from "@/components/events/event-filters";
import { Alert } from "@/components/ui/alert";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { accountState, formatCount, hrefWith, pickPage } from "@/lib/admin";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdminWith } from "@/lib/auth/session";
import { listUsers } from "@/lib/data/admin";
import { formatDate } from "@/lib/dates";
import { yearLabel } from "@/lib/format";
import { ACCOUNT_STATUS_FILTERS, ADMIN_PAGE_SIZE } from "@/lib/validation/limits";

export const metadata = { title: "Students" };

/**
 * Students of the colleges where this admin may see students. Shown: first
 * name, a short account reference, college, course, year, standing. Not shown
 * anywhere in the admin area: email, date of birth, gender, partner
 * preference, messages.
 */
export default async function StudentsPage({ searchParams }) {
  const scope = await requireAdminWith("view_students", "manage_students");
  const params = await searchParams;
  const colleges = scope.collegesWith("view_students", "manage_students");

  const filters = {
    search: pickQuery(params.q),
    college: pickFilter(params.college, colleges.map((item) => item.id)),
    status: pickFilter(params.status, ACCOUNT_STATUS_FILTERS.map((item) => item.value)),
  };
  const page = pickPage(params.page);
  const hasFilters = Object.values(filters).some(Boolean);

  const { rows, total, error } = await listUsers({ ...filters, page });
  const query = { q: filters.search, college: filters.college, status: filters.status };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description={scope.isSuperAdmin ? "Student profiles of every college." : `Student profiles of ${colleges.map((item) => item.name).join(", ")}.`}
      />

      <FilterBar
        action={ROUTES.adminUsers}
        label="Student filters"
        hasFilters={hasFilters}
        fields={[
          { type: "search", name: "q", label: "First name or reference", value: filters.search, placeholder: "Starts with… or U-1A2B3C4D" },
          { type: "select", name: "status", label: "Standing", value: filters.status, options: [{ value: "", label: "Any" }, ...ACCOUNT_STATUS_FILTERS] },
          ...(colleges.length > 1
            ? [{ type: "select", name: "college", label: "College", value: filters.college, options: [{ value: "", label: "Any college" }, ...colleges.map((item) => ({ value: item.id, label: item.name }))] }]
            : []),
        ]}
      />

      {error ? (
        <Alert tone="error">Students could not be loaded. Reload the page to try again.</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={hasFilters ? "No students match these filters" : "No student profiles yet"}>
          {hasFilters ? "Change or clear the filters. Names are matched from their first letters." : "Students appear here once they have registered and created a profile."}
        </EmptyState>
      ) : (
        <>
          <DataTable
            caption="Students"
            columns={[
              { key: "name", header: "Student" },
              { key: "college", header: "College" },
              { key: "course", header: "Course" },
              { key: "standing", header: "Standing" },
              { key: "reports", header: "Open reports", align: "right" },
              { key: "joined", header: "Profile created" },
            ]}
            rows={rows.map((row) => {
              const state = accountState(row);
              return {
                key: row.user_id,
                cells: {
                  name: (
                    <>
                      <Link href={`${ROUTES.adminUsers}/${row.user_id}`} className="font-semibold text-brand underline">
                        {row.first_name}
                      </Link>
                      <span className="block text-xs text-ink-muted">{row.ref}</span>
                    </>
                  ),
                  college: row.college_name,
                  course: `${row.course}, ${yearLabel(row.study_year).toLowerCase()}`,
                  standing: (
                    <>
                      <Badge tone={state.tone}>{state.label}</Badge>
                      {row.status === "suspended" && row.under_review ? <Badge tone="warning" className="ml-1.5">Under review</Badge> : null}
                      {row.suspended_until ? <span className="mt-1 block text-xs text-ink-muted">until {formatDate(row.suspended_until)}</span> : null}
                    </>
                  ),
                  reports: row.open_reports === null ? <span title="Needs the “Moderate reports” permission">—</span> : formatCount(row.open_reports),
                  joined: formatDate(row.joined_at),
                },
              };
            })}
          />
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} hrefFor={(n) => hrefWith(ROUTES.adminUsers, { ...query, page: n })} label="Student pages" />
        </>
      )}
    </div>
  );
}
