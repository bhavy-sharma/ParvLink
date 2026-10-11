"use client";

// Forms for handling a report and for moderating an account. They only collect
// input and show results; whether the admin may do any of it is decided by the
// database function behind each Server Action.

import { useActionState, useId, useState } from "react";
import { addReportNoteAction, assignReportAction, moderateUserAction, setReportStatusAction, viewReportEvidenceAction } from "@/app/admin/moderation-actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { closeDialog, Dialog } from "@/components/partners/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { reportStatus, reportTransitions } from "@/lib/admin";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { DECISION_NOTE_MAX, DECISION_NOTE_MIN, MODERATION_REASON_MAX, MODERATION_REASON_MIN, REPORT_NOTE_MAX, SUSPENSION_DURATIONS } from "@/lib/validation/limits";

// Shown only if the page did not move on by itself after a successful action.
function Done({ state }) {
  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      <Button variant="secondary" size="sm" onClick={closeDialog}>
        Close
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function StatusForm({ reportId, reportRef, transition, returnTo }) {
  const [state, formAction] = useActionState(setReportStatusAction, INITIAL_FORM_STATE);
  const id = useId();
  if (state.status === "success") return <Done state={state} />;
  const target = reportStatus(transition.to).label;
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="status" value={transition.to} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <p className="text-sm text-ink-muted">
        Report <span className="font-semibold text-ink">{reportRef}</span> will be marked <span className="font-semibold text-ink">{target}</span>. The
        change and your reason are recorded in the activity log. Neither student is notified.
      </p>
      <FormMessage state={state} />
      <Field
        id={`${id}-note`}
        label="Reason for this decision"
        hint={`${DECISION_NOTE_MIN} to ${DECISION_NOTE_MAX} characters. Visible to moderators only.`}
        error={state.fieldErrors.note}
      >
        {(props) => <Textarea {...props} name="note" rows={3} required maxLength={DECISION_NOTE_MAX} defaultValue={state.values.note ?? ""} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" pendingLabel="Saving…">
          {transition.label} report
        </SubmitButton>
        <Button variant="ghost" size="sm" onClick={closeDialog}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function QuickStatusForm({ reportId, transition }) {
  const [state, formAction] = useActionState(setReportStatusAction, INITIAL_FORM_STATE);
  return (
    <form action={formAction}>
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="status" value={transition.to} />
      <input type="hidden" name="note" value="" />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
        {transition.label}
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="mt-1.5 text-sm font-medium text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** The status changes available from the report's current status. */
export function ReportStatusActions({ reportId, reportRef, status, returnTo }) {
  return (
    <div className="flex flex-wrap gap-2">
      {reportTransitions(status).map((transition) =>
        transition.needsNote ? (
          <Dialog key={transition.to} label={transition.label} title={`${transition.label} report ${reportRef}?`} variant={transition.to === "resolved" ? "primary" : "secondary"}>
            <StatusForm reportId={reportId} reportRef={reportRef} transition={transition} returnTo={returnTo} />
          </Dialog>
        ) : (
          <QuickStatusForm key={transition.to} reportId={reportId} transition={transition} />
        ),
      )}
    </div>
  );
}

export function AssignReportButton({ reportId, assignedToMe }) {
  const [state, formAction] = useActionState(assignReportAction, INITIAL_FORM_STATE);
  const assign = !assignedToMe;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="reportId" value={reportId} />
      <input type="hidden" name="assign" value={assign ? "true" : "false"} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
        {assign ? "Assign to me" : "Unassign me"}
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function ReportNoteForm({ reportId }) {
  const [state, formAction] = useActionState(addReportNoteAction, INITIAL_FORM_STATE);
  const id = useId();
  return (
    <form action={formAction} className="space-y-3" noValidate>
      <input type="hidden" name="reportId" value={reportId} />
      <Field id={`${id}-body`} label="Add an internal note" hint="Seen by moderators of this college and Super Admins. Never shown to students." error={state.fieldErrors.body}>
        {(props) => (
          <Textarea
            {...props}
            // A saved note clears the box; a failed one keeps what was typed.
            key={state.status === "success" ? "saved" : "draft"}
            name="body"
            rows={3}
            maxLength={REPORT_NOTE_MAX}
            defaultValue={state.status === "error" ? (state.values.body ?? "") : ""}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">
          Add note
        </SubmitButton>
        {state.message ? (
          <p role={state.status === "error" ? "alert" : "status"} className={state.status === "error" ? "text-sm font-medium text-danger" : "text-sm font-medium text-ok"}>
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The messages the reporter chose to attach. Not loaded with the page: the
 * moderator has to ask, and the request is recorded.
 */
export function ReportEvidence({ reportId, count, reportedName, reporterName }) {
  const [state, formAction] = useActionState(viewReportEvidenceAction, INITIAL_FORM_STATE);
  const messages = state.status === "success" ? (state.values.messages ?? []) : null;

  if (messages) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-muted">
          Copied from the conversation when the report was filed. This is everything the reporter shared; the rest of the conversation is not available to
          moderators.
        </p>
        <ol aria-label="Shared messages" className="space-y-2">
          {messages.map((message) => (
            <li key={message.seq} className="rounded-field border border-line bg-paper/60 px-3.5 py-2.5">
              <p className="text-xs font-semibold text-ink-muted">
                {message.from === "reporter" ? `${reporterName ?? "Reporter"} (reporter)` : `${reportedName ?? "Reported student"} (reported)`} · {message.sent}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="reportId" value={reportId} />
      <p className="text-sm text-ink-muted">
        The reporter shared {count === 1 ? "1 message" : `${count} messages`} from the conversation. Open them only if you need them to decide this report:
        each viewing is recorded in the activity log with your account.
      </p>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Opening…">
        Show shared messages
      </SubmitButton>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const ACTIONS = {
  suspend: {
    button: "Suspend",
    title: (name) => `Suspend ${name}?`,
    verb: "Suspend",
    needsReason: true,
    danger: true,
    explain:
      "While suspended, the student cannot join events, be discovered, send or receive interest, match, or read and send messages. They see a notice saying the account is suspended — not your reason. Nothing is deleted.",
  },
  restore: {
    button: "Restore account",
    title: (name) => `Restore ${name}?`,
    verb: "Restore",
    needsReason: false,
    explain:
      "The student gets back exactly what they had: matches, conversations and the event profiles that were open. Profiles they had closed themselves stay closed.",
  },
  flag_review: {
    button: "Mark as under review",
    title: (name) => `Mark ${name} as under review?`,
    verb: "Mark as under review",
    needsReason: true,
    explain: "A flag for moderators. It restricts nothing and the student is not told.",
  },
  clear_review: {
    button: "Remove review flag",
    title: (name) => `Remove the review flag from ${name}?`,
    verb: "Remove the review flag",
    needsReason: false,
    explain: "The account goes back to normal standing. Its history is kept.",
  },
};

function ModerationForm({ userId, name, userRef, action, reportId, returnTo }) {
  const config = ACTIONS[action];
  const [state, formAction] = useActionState(moderateUserAction, INITIAL_FORM_STATE);
  const [step, setStep] = useState("edit");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("");
  const [problem, setProblem] = useState("");
  const id = useId();

  if (state.status === "success") return <Done state={state} />;

  const trimmed = reason.trim();
  const duration = SUSPENSION_DURATIONS.find((item) => item.value === days)?.label ?? "";
  const summary = action === "suspend" ? (days ? `Suspend for ${duration}` : "Suspend until an admin restores the account") : config.verb;

  function review() {
    if (config.needsReason && trimmed.length < MODERATION_REASON_MIN) {
      setProblem(`Write a reason (at least ${MODERATION_REASON_MIN} characters). It is kept in the activity log.`);
      return;
    }
    setProblem("");
    setStep("confirm");
  }

  if (step === "confirm") {
    return (
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="action" value={action} />
        <input type="hidden" name="reason" value={trimmed} />
        <input type="hidden" name="days" value={action === "suspend" ? days : ""} />
        <input type="hidden" name="reportId" value={reportId ?? ""} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <p className="text-sm font-semibold">Check before you confirm</p>
        <dl className="space-y-2 rounded-field border border-line bg-paper/60 px-4 py-3 text-sm">
          <div>
            <dt className="font-semibold">Account</dt>
            <dd>
              {name} ({userRef})
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Action</dt>
            <dd>{summary}</dd>
          </div>
          <div>
            <dt className="font-semibold">Reason</dt>
            <dd className="whitespace-pre-wrap break-words">{trimmed || "None given"}</dd>
          </div>
        </dl>
        <p className="text-sm text-ink-muted">This is recorded in the activity log with your account and the time.</p>
        <FormMessage state={state} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton variant={config.danger ? "dangerSolid" : "primary"} size="sm" pendingLabel="Working…">
            Confirm: {config.verb.toLowerCase()}
          </SubmitButton>
          <Button variant="ghost" size="sm" onClick={() => setStep("edit")}>
            Back
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">{config.explain}</p>
      {action === "suspend" ? (
        <Field id={`${id}-days`} label="How long">
          {(props) => (
            <Select {...props} value={days} onChange={(event) => setDays(event.target.value)}>
              {SUSPENSION_DURATIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <Field
        id={`${id}-reason`}
        label="Reason"
        optional={!config.needsReason}
        hint={`For moderators and the activity log; the student does not see it. Up to ${MODERATION_REASON_MAX} characters.`}
        error={problem || state.fieldErrors.reason}
      >
        {(props) => <Textarea {...props} rows={3} maxLength={MODERATION_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />}
      </Field>
      {action === "suspend" && days ? (
        <p className="text-sm text-ink-muted">A suspension with an end date is lifted the next time the student opens the app after that date.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={config.danger ? "danger" : "primary"} onClick={review}>
          Continue
        </Button>
        <Button variant="ghost" size="sm" onClick={closeDialog}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * The moderation actions that make sense for the account's current state,
 * each behind a dialog that asks for a reason and then for confirmation.
 */
export function ModerationActions({ userId, name, userRef, status, underReview, returnTo, reportId = null }) {
  const actions = [status === "suspended" ? "restore" : "suspend", underReview ? "clear_review" : "flag_review"];
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <Dialog key={action} label={ACTIONS[action].button} title={ACTIONS[action].title(name)} variant={ACTIONS[action].danger ? "danger" : "secondary"}>
          <ModerationForm userId={userId} name={name} userRef={userRef} action={action} reportId={reportId} returnTo={returnTo} />
        </Dialog>
      ))}
    </div>
  );
}
