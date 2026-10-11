"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { FEEDBACK_CATEGORIES, FEEDBACK_MAX } from "@/lib/validation/limits";
import { submitFeedbackAction } from "../actions";

export function FeedbackForm() {
  const [state, formAction] = useActionState(submitFeedbackAction, INITIAL_FORM_STATE);
  const values = state.values ?? {};
  const sent = state.status === "success";

  return (
    // Re-mounted after a successful send so the fields are empty again.
    <form action={formAction} className="space-y-4" noValidate key={sent ? "sent" : "editing"}>
      <FormMessage state={state} />
      <Field id="category" label="What is this about?" error={state.fieldErrors.category}>
        {(props) => (
          // Keyed on the value: a <select> does not pick up a changed default when React resets the form.
          <Select {...props} key={values.category ?? ""} name="category" required defaultValue={values.category ?? ""}>
            <option value="" disabled>
              Choose one
            </option>
            {FEEDBACK_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        id="description"
        label="What happened, or what would you like?"
        hint="Please do not include passwords or other people’s private details."
        error={state.fieldErrors.description}
      >
        {(props) => <Textarea {...props} name="description" required rows={5} maxLength={FEEDBACK_MAX} defaultValue={values.description ?? ""} />}
      </Field>
      <Field id="steps" label="Steps to make it happen again" optional hint="For a bug: what you pressed, in order, and on which page." error={state.fieldErrors.steps}>
        {(props) => <Textarea {...props} name="steps" rows={4} maxLength={FEEDBACK_MAX} defaultValue={values.steps ?? ""} />}
      </Field>
      <SubmitButton pendingLabel="Sending…">Send feedback</SubmitButton>
    </form>
  );
}
