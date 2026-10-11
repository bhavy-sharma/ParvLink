"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { ADMIN_PERMISSIONS } from "@/lib/validation/limits";
import { assignCollegeAction, grantAdminAction } from "../actions";

export function GrantAdminForm() {
  const [state, formAction] = useActionState(grantAdminAction, INITIAL_FORM_STATE);
  const values = state.status === "error" ? state.values : {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <Field
        id="grant-email"
        label="Email of the person to make an admin"
        hint="They must already have an account with a confirmed email."
        error={state.fieldErrors.email}
      >
        {(props) => (
          <Input
            {...props}
            key={state.status === "success" ? state.message : "email"}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            required
            defaultValue={values.email ?? ""}
          />
        )}
      </Field>
      <SubmitButton pendingLabel="Checking…">Make admin</SubmitButton>
    </form>
  );
}

export function AssignCollegeForm({ userId, colleges }) {
  const [state, formAction] = useActionState(assignCollegeAction, INITIAL_FORM_STATE);
  const selectId = `college-${userId}`;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="userId" value={userId} />
      <Field
        id={selectId}
        label="College"
        hint="Choosing a college they already have replaces its permissions."
        error={state.fieldErrors.collegeId}
      >
        {(props) => (
          <Select {...props} name="collegeId" required defaultValue="">
            <option value="" disabled>
              Choose a college
            </option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>
                {college.name}
                {college.is_active ? "" : " (closed)"}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset>
        <legend className="text-sm font-semibold">What they can do there</legend>
        <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
          {ADMIN_PERMISSIONS.map((permission) => (
            <Checkbox
              key={permission.value}
              id={`${permission.value}-${userId}`}
              name="permissions"
              value={permission.value}
              defaultChecked={permission.value === "view_students"}
              label={permission.label}
              description={permission.description}
            />
          ))}
        </div>
        {state.fieldErrors.permissions ? <p className="mt-1 text-sm font-medium text-danger">{state.fieldErrors.permissions}</p> : null}
      </fieldset>
      <SubmitButton variant="secondary" size="sm">
        Save assignment
      </SubmitButton>
    </form>
  );
}
