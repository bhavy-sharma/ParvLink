import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "@/components/admin/history";
import { AssignReportButton, ModerationActions, ReportEvidence, ReportNoteForm, ReportStatusActions } from "@/components/admin/moderation-forms";
import { Alert } from "@/components/ui/alert";
import { Badge, Panel } from "@/components/ui/misc";
import { accountState, actorLabel, DONE_MESSAGES, reportReasonLabel, reportStatus } from "@/lib/admin";
import { eventStatusLabel } from "@/lib/events";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdminWith } from "@/lib/auth/session";
import { getReport } from "@/lib/data/admin";
import { formatDate, formatDateTime, formatDateTimeLong } from "@/lib/dates";
import { yearLabel } from "@/lib/format";
import { reportIdSchema } from "@/lib/validation/schemas";

export const metadata = { title: "Report" };

/**
 * One report. admin_get_report() returns it only to a moderator of the
 * reported student's college (or a Super Admin) who is neither the reporter
 * nor the reported person; everyone else gets "not found". Shared chat
 * messages are not part of this page's data — see <ReportEvidence>.
 */
export default async function ReportPage({ params, searchParams }) {
  await requireAdminWith("moderate_reports");
  const parsed = reportIdSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const data = await getReport(parsed.data.reportId);
  if (!data) notFound();

  const { report, reported, reporter, event, match, college } = data;
  const status = reportStatus(report.status);
  const here = `${ROUTES.adminReports}/${report.id}`;
  const done = DONE_MESSAGES[(await searchParams).done];

  return (
    <div className="space-y-6">
      <div>
        <Link href={ROUTES.adminReports} className="text-sm font-semibold text-brand underline">
          Back to reports
        </Link>
        <header className="mt-3">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <Badge>{report.kind === "chat" ? "From a chat" : "Profile report"}</Badge>
            <span className="text-sm text-ink-muted">{report.assigned_to_me ? "Assigned to you" : report.assigned ? "Assigned to another moderator" : "Unassigned"}</span>
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Report {report.ref}</h1>
          <p className="mt-1 text-ink-muted">
            {reportReasonLabel(report.reason)} · submitted {formatDateTimeLong(report.created_at)} · {college?.name}
          </p>
        </header>
      </div>

      {done ? <Alert tone="success">{done}</Alert> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Panel aria-labelledby="submitted-heading">
            <h2 id="submitted-heading" className="text-xl font-semibold">
              What was reported
            </h2>
            <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-semibold">Category</dt>
                <dd className="text-ink-muted">{reportReasonLabel(report.reason)}</dd>
              </div>
              <div>
                <dt className="font-semibold">Event</dt>
                <dd className="text-ink-muted">{event ? `${event.title} (${eventStatusLabel(event.status)})` : "Not linked to an event, or the event was removed"}</dd>
              </div>
              <div>
                <dt className="font-semibold">Connection</dt>
                <dd className="text-ink-muted">
                  {match ? `Matched on ${formatDate(match.matched_at)}` : report.kind === "chat" ? "They were matched; the match no longer exists" : "Reported from a profile card"}
                  {data.blocked_between ? ". One of them has blocked the other." : ""}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">Reported by</dt>
                <dd className="text-ink-muted">
                  {reporter ? `${reporter.first_name} (${reporter.ref}), ${reporter.college_name}` : "Account deleted"}
                  {reporter && Number(reporter.reports_filed) > 1 ? ` — ${reporter.reports_filed} reports filed about students you moderate` : ""}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold">Description from the reporter</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-ink-muted">{report.details || "None given."}</dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
              The reported student is not told who reported them, and cannot see this report. What the reporter wrote cannot be edited.
            </p>
          </Panel>

          {report.evidence_count > 0 ? (
            <Panel aria-labelledby="evidence-heading">
              <h2 id="evidence-heading" className="text-xl font-semibold">
                Messages shared by the reporter
              </h2>
              <div className="mt-3">
                <ReportEvidence reportId={report.id} count={report.evidence_count} reportedName={reported?.first_name} reporterName={reporter?.first_name} />
              </div>
            </Panel>
          ) : report.kind === "chat" ? (
            <Panel>
              <h2 className="text-xl font-semibold">Messages</h2>
              <p className="mt-2 text-sm text-ink-muted">
                The reporter chose not to share any messages. Moderators cannot open students’ conversations, so decide on the description above, or ask the
                reporter (outside this app) to file again with messages attached.
              </p>
            </Panel>
          ) : null}

          <Panel aria-labelledby="notes-heading">
            <h2 id="notes-heading" className="text-xl font-semibold">
              Internal notes
            </h2>
            {data.notes.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">No notes yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {data.notes.map((note) => (
                  <li key={note.id} className="rounded-field border border-line bg-paper/60 px-3.5 py-2.5 text-sm">
                    <p className="text-xs font-semibold text-ink-muted">
                      {actorLabel(note.by)} · <time dateTime={note.created_at}>{formatDateTime(note.created_at)}</time>
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words">{note.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 border-t border-line pt-4">
              <ReportNoteForm reportId={report.id} />
            </div>
          </Panel>

          <Panel aria-labelledby="history-heading">
            <h2 id="history-heading" className="mb-3 text-xl font-semibold">
              History of this report
            </h2>
            <History entries={data.history} label="Report history" empty="Nothing has been done with this report yet." />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel aria-labelledby="decision-heading">
            <h2 id="decision-heading" className="text-xl font-semibold">
              Status
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {report.status === "open"
                ? "Pending: nobody has started on it."
                : report.status === "in_review"
                  ? "Under review."
                  : `${status.label} on ${formatDateTime(report.resolved_at)}.`}
            </p>
            {report.resolution_note ? <p className="mt-2 whitespace-pre-wrap break-words rounded-field bg-paper px-3 py-2 text-sm">{report.resolution_note}</p> : null}
            <div className="mt-4 space-y-3">
              <ReportStatusActions reportId={report.id} reportRef={report.ref} status={report.status} returnTo={here} />
              <AssignReportButton reportId={report.id} assignedToMe={report.assigned_to_me} />
            </div>
          </Panel>

          <Panel aria-labelledby="account-heading">
            <h2 id="account-heading" className="text-xl font-semibold">
              Reported account
            </h2>
            {reported ? (
              <>
                <p className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold">{reported.first_name}</span>
                  <span className="text-sm text-ink-muted">{reported.ref}</span>
                  <Badge tone={accountState(reported).tone}>{accountState(reported).label}</Badge>
                  {reported.status === "suspended" && reported.under_review ? <Badge tone="warning">Under review</Badge> : null}
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  {reported.course}, {yearLabel(reported.study_year).toLowerCase()} · {reported.college_name}
                  {reported.is_staff ? " · this account also holds an admin role" : ""}
                </p>
                {reported.status === "suspended" ? (
                  <p className="mt-1 text-sm text-ink-muted">
                    Suspended {reported.suspended_until ? `until ${formatDateTime(reported.suspended_until)}` : "until an admin restores the account"}.
                  </p>
                ) : null}
                <p className="mt-3 text-sm">
                  {reported.reports_total === 1 ? "This is the only report about this student" : `${reported.reports_total} reports about this student`}
                  {reported.reports_open > 0 ? ` (${reported.reports_open} not yet decided)` : ""}.
                </p>
                {data.other_reports.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {data.other_reports.map((other) => (
                      <li key={other.id}>
                        <Link href={`${ROUTES.adminReports}/${other.id}`} className="font-semibold text-brand underline">
                          {other.ref}
                        </Link>{" "}
                        <span className="text-ink-muted">
                          {reportReasonLabel(other.reason)}, {reportStatus(other.status).label.toLowerCase()}, {formatDate(other.created_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <h3 className="mt-5 font-sans text-sm font-semibold">Earlier moderation of this account</h3>
                <div className="mt-2">
                  <History entries={data.account_history} label="Account moderation history" empty="None." />
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  {reported.can_moderate ? (
                    <ModerationActions
                      userId={reported.user_id}
                      name={reported.first_name}
                      userRef={reported.ref}
                      status={reported.status}
                      underReview={reported.under_review}
                      reportId={report.id}
                      returnTo={here}
                    />
                  ) : (
                    <p className="text-sm text-ink-muted">
                      {reported.is_staff
                        ? "Action on an admin’s account is for a Super Admin."
                        : "Suspending or flagging an account needs the “Manage students” permission for this college. Ask a Super Admin, or leave a note for a colleague who has it."}
                    </p>
                  )}
                  {reported.can_view ? (
                    <p className="mt-3 text-sm">
                      <Link href={`${ROUTES.adminUsers}/${reported.user_id}`} className="font-semibold text-brand underline">
                        Open student summary
                      </Link>
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">This account has been deleted. The report is kept as a record.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
