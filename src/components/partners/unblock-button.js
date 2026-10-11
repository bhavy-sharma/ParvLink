"use client";

import { useActionState } from "react";
import { unblockPartnerAction } from "@/app/(student)/partner-actions";
import { SubmitButton } from "@/components/forms/submit-button";
import { INITIAL_FORM_STATE } from "@/lib/form-state";

export function UnblockButton({ blockId, name }) {
  const [state, formAction] = useActionState(unblockPartnerAction, INITIAL_FORM_STATE);
  return (
    <form action={formAction}>
      <input type="hidden" name="blockId" value={blockId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Unblocking…">
        Unblock<span className="sr-only"> {name}</span>
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="mt-1.5 text-sm font-medium text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
