"use client";

import { useActionState } from "react";
import { INITIAL_FORM_STATE } from "@/lib/form-state";

/**
 * A small form around one Server Action (a row button such as "Revoke").
 * Renders hidden fields, the trigger passed as children, and the action's
 * error message if it fails.
 */
export function InlineActionForm({ action, fields = {}, children, className }) {
  const [state, formAction] = useActionState(action, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {state.status === "error" ? (
        <p role="alert" className="mt-1.5 text-sm font-medium text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
