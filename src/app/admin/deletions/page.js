import { DataTable } from "@/components/admin/data-table";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, EmptyState, PageHeader } from "@/components/ui/misc";
import { DONE_MESSAGES } from "@/lib/admin";
import { requireSuperAdmin } from "@/lib/auth/session";
import { listDeletionRequests } from "@/lib/data/admin";
import { formatDateTime } from "@/lib/dates";
import { completeAccountDeletionAction } from "../moderation-actions";

export const metadata = { title: "Account deletions" };

/**
 * Super Admin only: deletion requests that were held because the account was
 * suspended or had undecided reports — a person has to decide these.
 * A student whose deletion went through at once never appears here.
 */
export default async function DeletionsPage({ searchParams }) {
  await requireSuperAdmin();
  const params = await searchParams;
  const { rows, error } = await listDeletionRequests();
  const pending = rows.filter((row) => row.state === "pending");
  const done = params.done === "account_deleted" ? DONE_MESSAGES.account_deleted : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Account deletions"
        description="Students delete their own accounts. A request only waits here when the account was suspended, or had reports that were not yet decided, at the moment the student asked."
      />
      {done ? <Alert tone="success">{done}</Alert> : null}
      {error ? <Alert tone="error">The requests could not be loaded. Reload the page to try again.</Alert> : null}

      <section aria-labelledby="held" className="space-y-3">
        <h2 id="held" className="text-xl font-semibold">
          Waiting for your decision
        </h2>
        {pending.length === 0 ? (
          <EmptyState title="No requests are waiting">Held deletion requests appear here.</EmptyState>
        ) : (
          <>
            <p className="max-w-3xl text-sm text-ink-muted">
              Decide the open reports first if you need the conversation or the account for that. Deleting removes the profile, matches and conversations for good; the reports
              themselves, with any messages attached to them, and the activity log are kept.
            </p>
            <DataTable
              caption="Held deletion requests"
              columns={[
                { key: "who", header: "Student" },
                { key: "college", header: "College" },
                { key: "asked", header: "Requested" },
                { key: "why", header: "Held because" },
                { key: "act", header: "Decision" },
              ]}
              rows={pending.map((row) => ({
                key: row.user_id,
                cells: {
                  who: (
                    <>
                      {row.first_name ?? "No profile"} <span className="text-ink-muted">({row.user_ref})</span>
                    </>
                  ),
                  college: row.college_name ?? <span className="text-ink-muted">None</span>,
                  asked: <time dateTime={row.requested_at}>{formatDateTime(row.requested_at)}</time>,
                  why: (
                    <span className="flex flex-wrap gap-1.5">
                      {row.hold_reason === "suspended" ? <Badge tone="danger">Suspended</Badge> : null}
                      {Number(row.open_reports) > 0 ? (
                        <Badge tone="warning">{Number(row.open_reports) === 1 ? "1 undecided report" : `${row.open_reports} undecided reports`}</Badge>
                      ) : row.hold_reason !== "suspended" ? (
                        <Badge>Reports since decided</Badge>
                      ) : null}
                    </span>
                  ),
                  act: (
                    <InlineActionForm action={completeAccountDeletionAction} fields={{ userId: row.user_id }}>
                      <ConfirmSubmit confirmLabel={`Yes, delete ${row.user_ref} permanently`} pendingLabel="Deleting…">
                        Delete account
                      </ConfirmSubmit>
                    </InlineActionForm>
                  ),
                },
              }))}
            />
            <p className="text-sm text-ink-muted">
              To refuse a request, leave it here and tell the student why through your support address; they can cancel it themselves. There is no “reject” button, because a
              request the student still wants stays a request.
            </p>
          </>
        )}
      </section>

    </div>
  );
}
