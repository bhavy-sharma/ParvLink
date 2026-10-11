import Link from "next/link";
import { InlineActionForm } from "@/components/forms/inline-action-form";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { PageHeader, Panel } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";
import { getCurrentRole, requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { call } from "@/lib/services";
import { ROLES } from "@/lib/validation/limits";
import { cancelDeletionAction } from "../actions";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata = { title: "Delete account" };

export default async function DeleteAccountPage({ searchParams }) {
  const user = await requireUser();
  const [role, params] = await Promise.all([getCurrentRole(), searchParams]);
  const { data: request, error } = await call("my_deletion_request");
  const isStaff = role === ROLES.ADMIN || role === ROLES.SUPER_ADMIN;

  return (
    <div className="space-y-6">
      <PageHeader title="Delete your account" description="This is permanent. Read what it removes before you continue." />

      {params.cancelled === "1" ? <Alert tone="success">Your deletion request has been cancelled. Nothing was deleted.</Alert> : null}

      {error ? (
        <Alert tone="error">Your account status could not be loaded. Reload the page to try again.</Alert>
      ) : isStaff ? (
        <Alert tone="warning" title="Admin accounts cannot be deleted from here">
          An account that holds an admin role is not deleted by its owner, so that a college is never left without its administrator by accident. Ask a Super Admin to remove
          your admin role first; after that this page works for you like for anyone else.
        </Alert>
      ) : request?.status === "pending" ? (
        <Panel>
          <h2 className="text-xl font-semibold">Your request is waiting for an administrator</h2>
          <p className="mt-2 text-ink-muted">
            You asked for this account to be deleted on {formatDateTime(request.requested_at)}. Some accounts are checked by an administrator before they are deleted; yours is
            waiting for that check. Nothing has been deleted yet.
          </p>
          <p className="mt-2 text-ink-muted">You do not need to do anything. If you have changed your mind, you can cancel the request.</p>
          <InlineActionForm action={cancelDeletionAction} className="mt-4">
            <SubmitButton variant="secondary" size="sm" pendingLabel="Cancelling…">
              Cancel my deletion request
            </SubmitButton>
          </InlineActionForm>
        </Panel>
      ) : (
        <>
          <Panel>
            <h2 className="text-xl font-semibold">What is deleted</h2>
            <ul className="mt-3 ml-5 list-disc space-y-1.5 text-ink-muted">
              <li>Your profile, date of birth, gender and photo.</li>
              <li>Your event participation, interest sent and received, matches and blocks.</li>
              <li>Your conversations — the people you matched with lose them too.</li>
              <li>Your login. You are logged out everywhere and this email can no longer log in.</li>
            </ul>
            <h2 className="mt-6 text-xl font-semibold">What is kept</h2>
            <ul className="mt-3 ml-5 list-disc space-y-1.5 text-ink-muted">
              <li>Reports you submitted or that were made about you, with any messages attached to them — no longer linked to your account.</li>
              <li>The administrators’ activity log, where you appear only as a reference code.</li>
              <li>Feedback you sent, no longer linked to you.</li>
              <li>Copies in routine database backups, until those backups expire.</li>
            </ul>
            <p className="mt-4 text-sm text-ink-muted">
              If your account is suspended or being reviewed, the request is held for an administrator instead of being carried out at once. The{" "}
              <Link href={ROUTES.privacy} className="font-semibold text-brand underline">
                Privacy notice
              </Link>{" "}
              has the details.
            </p>
          </Panel>
          <Panel>
            <h2 className="text-xl font-semibold">Confirm</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Signed in as <span className="break-all font-semibold text-ink">{user.email}</span>. This cannot be undone.
            </p>
            <div className="mt-4">
              <DeleteAccountForm />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
