"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { collegeLabel, STUDY_YEARS, yearLabel } from "@/lib/format";
import { BIO_MAX, COURSE_MAX, FIRST_NAME_MAX, MIN_AGE } from "@/lib/validation/limits";
import { createProfileAction } from "../actions";

export function OnboardingForm({ colleges, latestDob, earliestDob }) {
  const [state, formAction] = useActionState(createProfileAction, INITIAL_FORM_STATE);
  const { fieldErrors: errors, values } = state;
  // React resets a form after its action runs. Text inputs pick up the new
  // defaultValue; a <select> does not, so each one is keyed on its value to
  // re-mount with the submitted choice.

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />

      <Field id="firstName" label="First name" hint="Shown to students at your college." error={errors.firstName}>
        {(props) => (
          <Input {...props} name="firstName" autoComplete="given-name" required maxLength={FIRST_NAME_MAX} defaultValue={values.firstName ?? ""} />
        )}
      </Field>

      <Field
        id="collegeId"
        label="College"
        hint="You cannot change this yourself later, so pick carefully."
        error={errors.collegeId}
      >
        {(props) => (
          <Select {...props} key={values.collegeId ?? ""} name="collegeId" required defaultValue={values.collegeId ?? ""}>
            <option value="" disabled>
              Choose your college
            </option>
            {colleges.map((college) => (
              <option key={college.id} value={college.id}>
                {collegeLabel(college)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-[1fr_11rem]">
        <Field id="course" label="Course" hint="For example, B.Tech Computer Science." error={errors.course}>
          {(props) => <Input {...props} name="course" required maxLength={COURSE_MAX} defaultValue={values.course ?? ""} />}
        </Field>
        <Field id="studyYear" label="Year of study" error={errors.studyYear}>
          {(props) => (
            <Select {...props} key={values.studyYear ?? ""} name="studyYear" required defaultValue={values.studyYear ?? ""}>
              <option value="" disabled>
                Choose
              </option>
              {STUDY_YEARS.map((year) => (
                <option key={year} value={year}>
                  {yearLabel(year)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <Field
        id="dateOfBirth"
        label="Date of birth"
        hint={`Only used to check you are ${MIN_AGE} or older. Never shown to other students, and it cannot be changed later.`}
        error={errors.dateOfBirth}
      >
        {(props) => (
          <Input
            {...props}
            name="dateOfBirth"
            type="date"
            autoComplete="bday"
            required
            min={earliestDob}
            max={latestDob}
            defaultValue={values.dateOfBirth ?? ""}
            className={`${props.className} sm:max-w-56`}
          />
        )}
      </Field>

      <Field id="bio" label="About you" optional hint={`What you like doing and the kind of events you enter. Up to ${BIO_MAX} characters.`} error={errors.bio}>
        {(props) => <Textarea {...props} name="bio" maxLength={BIO_MAX} defaultValue={values.bio ?? ""} />}
      </Field>

      <SubmitButton size="lg" pendingLabel="Creating profile…">
        Create profile
      </SubmitButton>
    </form>
  );
}
