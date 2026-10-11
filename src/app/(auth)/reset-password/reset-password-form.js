"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Input } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation/limits";
import { resetPasswordAction } from "../actions";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(resetPasswordAction, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field
        id="password"
        label="New password"
        hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`}
        error={state.fieldErrors.password}
      >
        {(props) => (
          <Input {...props} name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
        )}
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={state.fieldErrors.confirmPassword}>
        {(props) => <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" required maxLength={PASSWORD_MAX} />}
      </Field>
      <SubmitButton className="w-full" pendingLabel="Saving…">
        Change password
      </SubmitButton>
    </form>
  );
}
