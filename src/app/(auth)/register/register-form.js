"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import Link from "next/link";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ROUTES } from "@/lib/auth/routes";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation/limits";
import { registerAction } from "../actions";

export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Email" hint="We send a confirmation link to this address." error={state.fieldErrors.email}>
        {(props) => (
          <Input {...props} name="email" type="email" autoComplete="email" inputMode="email" required defaultValue={state.values.email ?? ""} />
        )}
      </Field>
      <Field
        id="password"
        label="Password"
        hint={`At least ${PASSWORD_MIN} characters, with a letter and a number.`}
        error={state.fieldErrors.password}
      >
        {(props) => (
          <Input {...props} name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} />
        )}
      </Field>
      <Field id="confirmPassword" label="Confirm password" error={state.fieldErrors.confirmPassword}>
        {(props) => <Input {...props} name="confirmPassword" type="password" autoComplete="new-password" required maxLength={PASSWORD_MAX} />}
      </Field>
      <div>
        <Checkbox
          id="agree"
          name="agree"
          required
          aria-invalid={state.fieldErrors.agree ? true : undefined}
          aria-describedby={state.fieldErrors.agree ? "agree-error" : "agree-links"}
          label="I have read and agree to the Terms of Use and the Privacy Notice."
        />
        <p id="agree-links" className="pl-9 text-sm text-ink-muted [&_a]:font-semibold [&_a]:text-brand [&_a]:underline">
          Read the{" "}
          <Link href={ROUTES.terms} target="_blank">
            Terms of Use
          </Link>{" "}
          and the{" "}
          <Link href={ROUTES.privacy} target="_blank">
            Privacy Notice
          </Link>{" "}
          (they open in a new tab).
        </p>
        {state.fieldErrors.agree ? (
          <p id="agree-error" className="pl-9 text-sm font-medium text-danger">
            {state.fieldErrors.agree}
          </p>
        ) : null}
      </div>
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
