"use client";

import { useActionState, useEffect } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Input } from "@/components/ui/field";
import Link from "next/link";
import { ROUTES } from "@/lib/auth/routes";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { loginAction } from "../actions";

export function LoginForm({ next = "" }) {
  const [state, formAction] = useActionState(loginAction, INITIAL_FORM_STATE);

  // ✅ 100% Guaranteed Redirect Logic
  useEffect(() => {
    if (state?.status === "success") {
      // window.location.href use karne se Next.js router ke kisi bhi bug se bacha ja sakta hai.
      // Ye ek full page reload karega aur naya session properly load hoga.
      window.location.href = next || "/dashboard";
    }
  }, [state?.status, next]);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      
      {next ? <input type="hidden" name="next" value={next} /> : null}
      
      <Field id="email" label="Email" error={state?.fieldErrors?.email}>
        {(props) => (
          <Input 
            {...props} 
            name="email" 
            type="email" 
            autoComplete="email" 
            inputMode="email" 
            required 
            defaultValue={state?.values?.email ?? ""} 
          />
        )}
      </Field>
      
      <Field id="password" label="Password" error={state?.fieldErrors?.password}>
        {(props) => (
          <Input 
            {...props} 
            name="password" 
            type="password" 
            autoComplete="current-password" 
            required 
          />
        )}
      </Field>
      
      <p className="text-sm">
        <Link href={ROUTES.forgotPassword} className="font-semibold text-brand underline">
          Forgot your password?
        </Link>
      </p>
      
      <SubmitButton className="w-full" pendingLabel="Logging in…">
        Log in
      </SubmitButton>
    </form>
  );
}