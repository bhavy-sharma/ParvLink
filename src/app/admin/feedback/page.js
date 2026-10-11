import { FilterBar } from "@/components/admin/filter-bar";
import { Pagination } from "@/components/admin/pagination";
import { pickFilter } from "@/components/events/event-filters";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui/misc";
import { hrefWith, pickPage } from "@/lib/admin";
import { ROUTES } from "@/lib/auth/routes";
import { requireSuperAdmin } from "@/lib/auth/session";
import { listFeedback } from "@/lib/data/admin";
import { formatDateTime } from "@/lib/dates";
import { ADMIN_PAGE_SIZE, FEEDBACK_CATEGORIES, FEEDBACK_CATEGORY_VALUES } from "@/lib/validation/limits";
import { setFeedbackReviewedAction } from "../moderation-actions";

export const metadata = { title: "Feedback" };

const CATEGORY_LABEL = Object.fromEntries(FEEDBACK_CATEGORIES.map((item) => [item.value, item.label]));

/** Super Admin only: what beta users sent through the feedback form. Read, then mark as reviewed. */
export default async function FeedbackInboxPage({ searchParams }) {
  await requireSuperAdmin();
  const params = await searchParams;
  const filters = { status: pickFilter(params.status, ["new", "reviewed"]), category: pickFilter(params.category, FEEDBACK_CATEGORY_VALUES) };
  const page = pickPage(params.page);
  const { rows, total, error } = await listFeedback({ ...filters, page });
  const hasFilters = Boolean(filters.status || filters.category);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Feedback"
        description="Sent by signed-in users through the feedback form. Only Super Admins can read it. The sender is shown as a reference code, not a name or email address."
      />
      <FilterBar
        action={ROUTES.adminFeedback}
        label="Feedback filters"
        hasFilters={hasFilters}
        fields={[
          { type: "select", name: "status", label: "Status", value: filters.status, options: [{ value: "", label: "New and reviewed" }, { value: "new", label: "New" }, { value: "reviewed", label: "Reviewed" }] },
          { type: "select", name: "category", label: "Category", value: filters.category, options: [{ value: "", label: "Any category" }, ...FEEDBACK_CATEGORIES] },
        ]}
      />

      {error ? (
        <Alert tone="error">Feedback could not be loaded. Reload the page to try again.</Alert>
      ) : rows.length === 0 ? (
        <EmptyState title={hasFilters ? "No feedback matches these filters" : "No feedback yet"}>
          {hasFilters ? "Change or clear the filters." : "When someone uses “Send feedback”, it appears here."}
        </EmptyState>
      ) : (
        <>
          <ul className="space-y-4">
            {rows.map((row) => (
              <li key={row.feedback_id}>
                <Panel as="article">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge tone={row.category === "safety" ? "danger" : row.category === "bug" ? "warning" : "brand"}>{CATEGORY_LABEL[row.category] ?? row.category}</Badge>
                    <Badge tone={row.status === "new" ? "warning" : "ok"}>{row.status === "new" ? "New" : "Reviewed"}</Badge>
                    <span className="text-ink-muted">
                      <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time> · {row.from_ref ?? "Account since deleted"}
                      {row.college_name ? ` · ${row.college_name}` : ""}
                    </span>
                  </div>
                  {/* Rendered as text: React escapes it, and line breaks are kept by CSS. */}
                  <p className="mt-3 whitespace-pre-wrap break-words">{row.description}</p>
                  {row.steps ? (
                    <>
                      <h3 className="mt-4 text-sm font-semibold">Steps to reproduce</h3>
                      <p className="mt-1 whitespace-pre-wrap break-words text-ink-muted">{row.steps}</p>
                    </>
                  ) : null}
                  <InlineActionForm
                    action={setFeedbackReviewedAction}
                    fields={{ feedbackId: row.feedback_id, reviewed: row.status === "new" ? "true" : "false" }}
                    className="mt-4"
                  >
                    <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
                      {row.status === "new" ? "Mark as reviewed" : "Mark as new again"}
                    </SubmitButton>
                  </InlineActionForm>
                </Panel>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={total} hrefFor={(n) => hrefWith(ROUTES.adminFeedback, { ...filters, page: n })} label="Feedback pages" />
        </>
      )}
    </div>
  );
}
