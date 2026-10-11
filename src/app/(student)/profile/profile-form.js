"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { STUDY_YEARS, yearLabel } from "@/lib/format";
import { BIO_MAX, COURSE_MAX, FIRST_NAME_MAX } from "@/lib/validation/limits";
import { updateProfileAction } from "../actions";

export function ProfileForm({ profile, disabled = false }) {
  const [state, formAction] = useActionState(updateProfileAction, INITIAL_FORM_STATE);
  const { fieldErrors: errors } = state;
  // After a submission show what was typed; before one, what is saved.
  const submitted = state.status !== "idle";
  const values = {
    firstName: submitted ? state.values.firstName : profile.first_name,
    course: submitted ? state.values.course : profile.course,
    studyYear: submitted ? state.values.studyYear : String(profile.study_year),
    bio: submitted ? state.values.bio : (profile.bio ?? ""),
  };

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <fieldset disabled={disabled} className="space-y-5">
        <legend className="sr-only">Profile details</legend>
        <Field id="firstName" label="First name" error={errors.firstName}>
          {(props) => (
            <Input {...props} name="firstName" autoComplete="given-name" required maxLength={FIRST_NAME_MAX} defaultValue={values.firstName ?? ""} />
          )}
        </Field>
        <div className="grid gap-5 sm:grid-cols-[1fr_11rem]">
          <Field id="course" label="Course" error={errors.course}>
            {(props) => <Input {...props} name="course" required maxLength={COURSE_MAX} defaultValue={values.course ?? ""} />}
          </Field>
          <Field id="studyYear" label="Year of study" error={errors.studyYear}>
            {(props) => (
              <Select {...props} key={values.studyYear ?? ""} name="studyYear" required defaultValue={values.studyYear ?? ""}>
                {STUDY_YEARS.map((year) => (
                  <option key={year} value={year}>
                    {yearLabel(year)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field id="bio" label="About you" optional hint={`Up to ${BIO_MAX} characters.`} error={errors.bio}>
          {(props) => <Textarea {...props} name="bio" maxLength={BIO_MAX} defaultValue={values.bio ?? ""} />}
        </Field>
        <SubmitButton>Save changes</SubmitButton>
      </fieldset>
    </form>
  );
}
