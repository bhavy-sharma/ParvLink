"use client";

import { useActionState, useId } from "react";
import { blockChatPartnerAction, reportChatPartnerAction } from "@/app/(student)/chat-actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { closeDialog, Dialog } from "@/components/partners/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Select, Textarea } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { CHAT_REPORT_EVIDENCE_COUNT, CHAT_REPORT_REASONS, REPORT_DETAILS_MAX } from "@/lib/validation/limits";

function BlockForm({ conversation, name }) {
  const [state, formAction] = useActionState(blockChatPartnerAction, INITIAL_FORM_STATE);
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
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="conversation" value={conversation} />
      <p className="text-sm text-ink-muted">
        Neither of you will be able to send messages here, and you will stop seeing each other in partner discovery in every event. {name} is not
        told. The messages you have already exchanged stay readable for both of you. You can unblock from your Matches page.
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

function ReportForm({ conversation, name }) {
  const [state, formAction] = useActionState(reportChatPartnerAction, INITIAL_FORM_STATE);
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
  const include = state.values.includeMessages === "on";
  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="conversation" value={conversation} />
      <p className="text-sm text-ink-muted">
        Reports go to the moderators responsible for {name}’s college. {name} is not told who reported them. If someone is in immediate danger,
        contact your college or local emergency services directly.
      </p>
      <FormMessage state={state} />
      <Field id={`${idPrefix}-reason`} label="What is wrong?" error={state.fieldErrors.reason}>
        {(props) => (
          <Select {...props} key={state.values.reason ?? ""} name="reason" required defaultValue={state.values.reason ?? ""}>
            <option value="" disabled>
              Choose a reason
            </option>
            {CHAT_REPORT_REASONS.map((reason) => (
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
      <Checkbox
        key={include ? "on" : "off"}
        id={`${idPrefix}-include`}
        name="includeMessages"
        defaultChecked={include}
        label={`Share the last ${CHAT_REPORT_EVIDENCE_COUNT} messages of this conversation with the moderators`}
        description="Moderators cannot open your conversations. They only see the messages you choose to share here, copied as they are right now."
      />
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

/** "Block" and "Report user" for the other person in a conversation, each behind a dialog. */
export function ChatSafetyMenu({ conversation, name, showBlock }) {
  const quiet = "min-h-9 px-2.5 text-sm font-semibold text-ink-muted hover:text-ink";
  return (
    <div className="flex shrink-0 items-center">
      {showBlock ? (
        <Dialog label={<>Block<span className="sr-only"> {name}</span></>} title={`Block ${name}?`} variant="ghost" triggerClassName={quiet}>
          <BlockForm conversation={conversation} name={name} />
        </Dialog>
      ) : null}
      <Dialog label={<span>Report<span className="max-sm:sr-only"> user</span></span>} title={`Report ${name}`} variant="ghost" triggerClassName={quiet}>
        <ReportForm conversation={conversation} name={name} />
      </Dialog>
    </div>
  );
}
