"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Input } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { resendVerificationAction } from "../actions";

export function ResendForm({ email }) {
  const [state, formAction] = useActionState(resendVerificationAction, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Email" error={state.fieldErrors.email}>
        {(props) => (
          <Input {...props} name="email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.values.email ?? email ?? ""} />
        )}
      </Field>
      <SubmitButton variant="secondary" className="w-full" pendingLabel="Sending…">
        Send the link again
      </SubmitButton>
    </form>
  );
}
