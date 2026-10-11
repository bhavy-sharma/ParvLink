"use client";

import { useActionState } from "react";
import { setEventProfileOpenAction } from "@/app/(student)/partner-actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { closeDialog, Dialog } from "@/components/partners/dialog";
import { Button } from "@/components/ui/button";
import { INITIAL_FORM_STATE } from "@/lib/form-state";

/**
 * "Close My Profile for This Event" (with a confirmation dialog) while the
 * profile is open; "Re-open my profile" while it is closed.
 */
export function ProfileToggle({ slug, isOpen, canReopen }) {
  const [state, formAction] = useActionState(setEventProfileOpenAction, INITIAL_FORM_STATE);

  return (
    <div className="space-y-3">
      {/* Outside the dialog, so the result stays on screen after it closes. */}
      <FormMessage state={state} />
      {isOpen ? (
        <Dialog label="Close My Profile for This Event" title="Close your profile for this event?" variant="danger" size="md">
          <form action={formAction} className="space-y-4" onSubmit={closeDialog}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="open" value="false" />
              <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-muted">
                <li>You will no longer appear in partner discovery for this event.</li>
                <li>Nobody can send you new interest for it, and you cannot send any.</li>
                <li>Your matches and the interest you already exchanged are kept.</li>
                <li>Your profile for other events, and your account, are not affected.</li>
              </ul>
              <p className="text-sm text-ink-muted">You can re-open it while the event is still taking partners.</p>
              <div className="flex flex-wrap gap-2">
                <SubmitButton variant="dangerSolid" size="sm" pendingLabel="Closing…">
                  Yes, close my profile
                </SubmitButton>
                <Button variant="ghost" size="sm" onClick={closeDialog}>
                  Keep it open
                </Button>
              </div>
            </form>
        </Dialog>
      ) : canReopen ? (
        <form action={formAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="open" value="true" />
          <SubmitButton pendingLabel="Re-opening…">Re-open my profile for this event</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}
