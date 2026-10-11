"use client";

import { useActionState, useId } from "react";
import { blockPartnerAction, reportPartnerAction } from "@/app/(student)/partner-actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { closeDialog, Dialog } from "@/components/partners/dialog";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { REPORT_DETAILS_MAX, REPORT_REASONS } from "@/lib/validation/limits";

function BlockForm({ slug, handle, name }) {
  const [state, formAction] = useActionState(blockPartnerAction, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="handle" value={handle} />
      <p className="text-sm text-ink-muted">
        You and {name} will stop seeing each other in partner discovery, in this and every other event, and neither of you can send the other interest or chat messages.
        {" "}{name} is not told. Anything already between you (interest, a match, earlier messages) stays in your history. You can unblock from your Matches page.
      </p>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="dangerSolid" size="sm" pendingLabel="Blocking…">
          Block {name}
        </SubmitButton>
        <Button variant="ghost" size="sm" onClick={closeDialog}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ReportForm({ slug, handle, name }) {
  const [state, formAction] = useActionState(reportPartnerAction, INITIAL_FORM_STATE);
  // The same person can appear twice on a page (a card and a match row), so
  // field ids must be unique per form, not per person.
  const idPrefix = useId();
  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <FormMessage state={state} />
        <Button variant="secondary" size="sm" onClick={closeDialog}>
          Close
        </Button>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="handle" value={handle} />
      <p className="text-sm text-ink-muted">Reports go to your college’s moderators. {name} is not told who reported them.</p>
      <FormMessage state={state} />
      <Field id={`${idPrefix}-reason`} label="What is wrong?" error={state.fieldErrors.reason}>
        {(props) => (
          <Select {...props} key={state.values.reason ?? ""} name="reason" required defaultValue={state.values.reason ?? ""}>
            <option value="" disabled>
              Choose a reason
            </option>
            {REPORT_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id={`${idPrefix}-details`} label="What happened?" optional hint={`Up to ${REPORT_DETAILS_MAX} characters.`} error={state.fieldErrors.details}>
        {(props) => <Textarea {...props} name="details" rows={3} maxLength={REPORT_DETAILS_MAX} defaultValue={state.values.details ?? ""} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton size="sm" pendingLabel="Sending…">
          Send report
        </SubmitButton>
        <Button variant="ghost" size="sm" onClick={closeDialog}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** "Block" and "Report" for one person, each behind a confirmation dialog. */
export function PartnerMenu({ slug, handle, name, showBlock = true }) {
  const quiet = "min-h-0 px-2 py-1 text-sm font-semibold text-ink-muted underline hover:bg-transparent hover:text-ink";
  return (
    <div className="flex flex-wrap gap-x-2">
      {showBlock ? (
        <Dialog label={<>Block<span className="sr-only"> {name}</span></>} title={`Block ${name}?`} variant="ghost" triggerClassName={quiet}>
          <BlockForm slug={slug} handle={handle} name={name} />
        </Dialog>
      ) : null}
      <Dialog label={<>Report profile<span className="sr-only"> of {name}</span></>} title={`Report ${name}’s profile`} variant="ghost" triggerClassName={quiet}>
        <ReportForm slug={slug} handle={handle} name={name} />
      </Dialog>
    </div>
  );
}
