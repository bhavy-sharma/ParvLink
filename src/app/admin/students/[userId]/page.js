import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "@/components/admin/history";
import { ModerationActions } from "@/components/admin/moderation-forms";
import { Stat } from "@/components/admin/stat";
import { Alert } from "@/components/ui/alert";
import { Badge, Panel } from "@/components/ui/misc";
import { accountState, DONE_MESSAGES, hrefWith } from "@/lib/admin";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdminWith } from "@/lib/auth/session";
import { getUserSummary } from "@/lib/data/admin";
import { formatDate, formatDateTime } from "@/lib/dates";
import { eventStatusLabel } from "@/lib/events";
import { yearLabel } from "@/lib/format";
import { adminUserSchema } from "@/lib/validation/schemas";

export const metadata = { title: "Student" };

/**
 * Administrative summary of one student, from admin_get_user(): available to
 * admins who may see students of that college, "not found" for everyone else.
 */
export default async function StudentPage({ params, searchParams }) {
  const scope = await requireAdminWith("view_students", "manage_students");
  const parsed = adminUserSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const data = await getUserSummary(parsed.data.userId);
  if (!data) notFound();

  const { user, participation, reports } = data;
  const state = accountState(user);
  const here = `${ROUTES.adminUsers}/${user.user_id}`;
  const done = DONE_MESSAGES[(await searchParams).done];

  return (
    <div className="space-y-6">
      <div>
        <Link href={ROUTES.adminUsers} className="text-sm font-semibold text-brand underline">
          Back to students
        </Link>
        <header className="mt-3">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={state.tone}>{state.label}</Badge>
            {user.status === "suspended" && user.under_review ? <Badge tone="warning">Under review</Badge> : null}
            {user.is_staff ? <Badge tone="brand">Also an admin</Badge> : null}
            {user.is_me ? <Badge>This is you</Badge> : null}
          </p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{user.first_name}</h1>
          <p className="mt-1 text-ink-muted">
            {user.ref} · {user.course}, {yearLabel(user.study_year).toLowerCase()} · {user.college.name}
          </p>
        </header>
      </div>

      {done ? <Alert tone="success">{done}</Alert> : null}
      {user.status === "suspended" ? (
        <Alert tone="warning" title="This account is suspended">
          Since {formatDateTime(user.suspended_at)}, {user.suspended_until ? `until ${formatDateTime(user.suspended_until)}` : "until an admin restores it"}. The student
          cannot join events, be discovered, send interest, match, or read and send messages.
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <Panel aria-labelledby="participation-heading">
            <h2 id="participation-heading" className="text-xl font-semibold">
              Participation
            </h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat label="Events joined" value={participation.events_joined} note={`${participation.open_event_profiles} with the profile open`} />
              <Stat label="Matches" value={participation.matches} />
              <Stat label="Interests" value={participation.interests_sent} note={`sent; ${participation.interests_received} received`} />
            </dl>
            {participation.events.length > 0 ? (
              <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
                {participation.events.map((item, index) => (
                  <li key={`${item.joined_at}-${index}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                    <span className="font-semibold">{item.title}</span>
                    <span className="text-ink-muted">
                      event {eventStatusLabel(item.event_status).toLowerCase()} · profile {item.profile === "active" ? "open" : "closed by the student"} · joined {formatDate(item.joined_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-ink-muted">Has not joined any event.</p>
            )}
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-muted">
              Who the student matched with, their partner preference and their conversations are not available to admins.
            </p>
          </Panel>

          <Panel aria-labelledby="history-heading">
            <h2 id="history-heading" className="mb-3 text-xl font-semibold">
              Moderation history
            </h2>
            <History entries={data.history} label="Account moderation history" empty="No moderation action has been taken on this account." />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel aria-labelledby="account-heading">
            <h2 id="account-heading" className="text-xl font-semibold">
              Account
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="inline font-semibold">Profile created </dt>
                <dd className="inline text-ink-muted">{formatDate(user.joined_at)}</dd>
              </div>
              <div>
                <dt className="inline font-semibold">Photo </dt>
                <dd className="inline text-ink-muted">{user.has_photo ? "uploaded" : "none"}</dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-line pt-4">
              {data.can_moderate ? (
                <ModerationActions userId={user.user_id} name={user.first_name} userRef={user.ref} status={user.status} underReview={user.under_review} returnTo={here} />
              ) : (
                <p className="text-sm text-ink-muted">
                  {user.is_me
                    ? "You cannot take moderation actions on your own account."
                    : user.is_staff
                      ? "This account holds an admin role. Only a Super Admin can act on it."
                      : "You can view this student. Suspending or flagging needs the “Manage students” permission for this college."}
                </p>
              )}
            </div>
          </Panel>

          <Panel aria-labelledby="reports-heading">
            <h2 id="reports-heading" className="text-xl font-semibold">
              Reports
            </h2>
            {reports ? (
              <>
                <p className="mt-2 text-sm">
                  {reports.against_total === 0 ? "No reports about this student." : `${reports.against_total} about this student, ${reports.against_open} not yet decided.`}{" "}
                  {reports.filed_total > 0 ? `Filed ${reports.filed_total} themselves.` : ""}
                </p>
                {scope.can("moderate_reports") && reports.against_total > 0 ? (
                  <p className="mt-2 text-sm">
                    <Link href={hrefWith(ROUTES.adminReports, { q: user.first_name, college: user.college.id })} className="font-semibold text-brand underline">
                      Find them in Reports
                    </Link>
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">Report information needs the “Moderate reports” permission for this college.</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
