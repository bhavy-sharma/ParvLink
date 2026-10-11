"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Input } from "@/components/ui/field";
import Link from "next/link";
import { ROUTES } from "@/lib/auth/routes";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { loginAction } from "../actions";

export function LoginForm({ next = "" }) {
  const [state, formAction] = useActionState(loginAction, INITIAL_FORM_STATE);
  const router = useRouter();

  useEffect(() => {
    if (state?.status === "success") {
      // Client-side navigation try karo
      const targetUrl = next || "/dashboard";
      
      // Pehle Next.js router try karo
      router.push(targetUrl);
      
      // Fallback: Agar router kaam na kare toh 500ms baad direct redirect
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 500);
    }
  }, [state?.status, next, router]);

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