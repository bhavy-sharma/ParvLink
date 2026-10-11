"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Input } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { DELETE_CONFIRM_WORD, PASSWORD_MAX } from "@/lib/validation/limits";
import { deleteAccountAction } from "../actions";

export function DeleteAccountForm() {
  const [state, formAction] = useActionState(deleteAccountAction, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="password" label="Your current password" error={state.fieldErrors.password}>
        {(props) => <Input {...props} name="password" type="password" autoComplete="current-password" required maxLength={PASSWORD_MAX} />}
      </Field>
      <Field id="confirm" label={`Type ${DELETE_CONFIRM_WORD} to confirm`} error={state.fieldErrors.confirm}>
        {(props) => <Input {...props} name="confirm" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} required maxLength={12} />}
      </Field>
      <SubmitButton variant="dangerSolid" pendingLabel="Deleting…">
        Delete my account permanently
      </SubmitButton>
    </form>
  );
}
