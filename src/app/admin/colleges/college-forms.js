"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { COLLEGE_CITY_MAX, COLLEGE_NAME_MAX, COLLEGE_SLUG_MAX } from "@/lib/validation/limits";
import { createCollegeAction, updateCollegeAction } from "../actions";

function CollegeFields({ errors, values, slugHint }) {
  return (
    <>
      <Field id="name" label="College name" error={errors.name}>
        {(props) => <Input {...props} name="name" required maxLength={COLLEGE_NAME_MAX} defaultValue={values.name ?? ""} />}
      </Field>
      <Field id="city" label="City" optional error={errors.city}>
        {(props) => <Input {...props} name="city" maxLength={COLLEGE_CITY_MAX} defaultValue={values.city ?? ""} />}
      </Field>
      <Field id="slug" label="Short name" hint={slugHint} error={errors.slug}>
        {(props) => (
          <Input
            {...props}
            name="slug"
            maxLength={COLLEGE_SLUG_MAX}
            autoCapitalize="none"
            spellCheck={false}
            placeholder="st-xaviers-mumbai"
            defaultValue={values.slug ?? ""}
          />
        )}
      </Field>
    </>
  );
}

export function CreateCollegeForm() {
  const [state, formAction] = useActionState(createCollegeAction, INITIAL_FORM_STATE);
  // Clear the fields after a successful save; keep them after an error.
  const values = state.status === "error" ? state.values : {};

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <CollegeFields
        key={state.status === "success" ? state.message : "form"}
        errors={state.fieldErrors}
        values={values}
        slugHint="Lowercase letters, numbers and hyphens. Leave blank to make one from the name."
      />
      <SubmitButton pendingLabel="Adding…">Add college</SubmitButton>
    </form>
  );
}

export function EditCollegeForm({ college }) {
  const [state, formAction] = useActionState(updateCollegeAction, INITIAL_FORM_STATE);
  const submitted = state.status !== "idle";
  const values = submitted
    ? state.values
    : { name: college.name, slug: college.slug, city: college.city ?? "", isActive: college.is_active };

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="collegeId" value={college.id} />
      <CollegeFields errors={state.fieldErrors} values={values} slugHint="Lowercase letters, numbers and hyphens." />
      <Checkbox
        id="isActive"
        name="isActive"
        defaultChecked={values.isActive}
        label="Open to students"
        description="When switched off, new students cannot choose this college. Existing profiles are kept."
      />
      <SubmitButton>Save changes</SubmitButton>
    </form>
  );
}
