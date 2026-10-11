"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { buttonClasses } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { collegeLabel, STUDY_YEARS, yearLabel } from "@/lib/format";
import {
  EVENT_DESCRIPTION_MAX,
  EVENT_MAX_AGE_LIMIT,
  EVENT_REQUIREMENTS_MAX,
  EVENT_TITLE_MAX,
  EVENT_TYPES,
  EVENT_VENUE_MAX,
  MIN_AGE,
} from "@/lib/validation/limits";
import { createEventAction, updateEventAction } from "./actions";

function Section({ title, description, children }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      <div className="mt-5 space-y-5">{children}</div>
    </section>
  );
}

function Radio({ id, name, value, defaultChecked, onChange, label, description }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-field px-1 py-1.5">
      <input id={id} type="radio" name={name} value={value} defaultChecked={defaultChecked} onChange={onChange} className="mt-0.5 size-5 shrink-0 accent-brand" />
      <span className="text-sm">
        <span className="font-semibold text-ink">{label}</span>
        {description ? <span className="block text-ink-muted">{description}</span> : null}
      </span>
    </label>
  );
}

/**
 * Create / edit form for an event.
 *
 *   mode "create": `hostColleges` are the colleges this admin manages.
 *   mode "edit":   `event` identifies the row; the host college is fixed.
 * `initialValues` are plain strings/arrays prepared on the server (dates are
 * already converted to the app's time zone).
 */
export function EventForm({ mode, eventId = null, hostCollege = null, hostColleges = [], invitableColleges, initialValues, timeZone, cancelHref, locked = false }) {
  const [state, formAction] = useActionState(mode === "create" ? createEventAction : updateEventAction, INITIAL_FORM_STATE);
  const submitted = state.status !== "idle";
  const values = submitted ? state.values : initialValues;
  const errors = state.fieldErrors;

  // React resets a form after its action runs, and does not restore selects,
  // radios or checkboxes to their current values. Those controls are therefore
  // uncontrolled and keyed on the submitted value (see `key=` below); this
  // state only mirrors the choice so dependent parts of the form can react.
  const [collegesMode, setCollegesMode] = useState(initialValues.collegesMode);
  const [hostId, setHostId] = useState(mode === "create" ? initialValues.collegeId : hostCollege.id);
  const hostName = mode === "create" ? (hostColleges.find((college) => college.id === hostId)?.name ?? "the host college") : hostCollege.name;
  const otherColleges = invitableColleges.filter((college) => college.id !== hostId);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {eventId ? <input type="hidden" name="eventId" value={eventId} /> : null}

      <fieldset disabled={locked} className="space-y-5">
        <legend className="sr-only">Event</legend>

        <Section title="Basics">
          <Field id="title" label="Event title" error={errors.title}>
            {(props) => <Input {...props} name="title" required maxLength={EVENT_TITLE_MAX} defaultValue={values.title ?? ""} />}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="eventType" label="Event type" error={errors.eventType}>
              {(props) => (
                <Select {...props} key={values.eventType ?? ""} name="eventType" required defaultValue={values.eventType ?? ""}>
                  <option value="" disabled>
                    Choose a type
                  </option>
                  {EVENT_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {mode === "create" ? (
              <Field id="collegeId" label="Host college" hint="Cannot be changed after the event is created." error={errors.collegeId}>
                {(props) => (
                  <Select
                    {...props}
                    key={values.collegeId ?? ""}
                    name="collegeId"
                    required
                    defaultValue={values.collegeId ?? ""}
                    onChange={(event) => setHostId(event.target.value)}
                  >
                    <option value="" disabled>
                      Choose a college
                    </option>
                    {hostColleges.map((college) => (
                      <option key={college.id} value={college.id}>
                        {collegeLabel(college)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">Host college</p>
                <p className="flex min-h-11 items-center rounded-field border border-line bg-paper px-3.5 text-ink-muted">{collegeLabel(hostCollege)}</p>
                <p className="text-sm text-ink-muted">Fixed when the event was created.</p>
              </div>
            )}
          </div>

          <Field id="description" label="Description" hint={`What happens, who it is for, how teams or pairs work. Up to ${EVENT_DESCRIPTION_MAX} characters.`} error={errors.description}>
            {(props) => <Textarea {...props} name="description" rows={6} required maxLength={EVENT_DESCRIPTION_MAX} defaultValue={values.description ?? ""} />}
          </Field>

          <Field id="venue" label="Venue" error={errors.venue}>
            {(props) => <Input {...props} name="venue" required maxLength={EVENT_VENUE_MAX} defaultValue={values.venue ?? ""} />}
          </Field>
        </Section>

        <Section title="Date and time" description={`All times are ${timeZone}.`}>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="startsAt" label="Starts" error={errors.startsAt}>
              {(props) => <Input {...props} name="startsAt" type="datetime-local" required defaultValue={values.startsAt ?? ""} />}
            </Field>
            <Field id="endsAt" label="Ends" error={errors.endsAt}>
              {(props) => <Input {...props} name="endsAt" type="datetime-local" required defaultValue={values.endsAt ?? ""} />}
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="registrationOpensAt" label="Participation opens" optional hint="Empty: as soon as the event is published." error={errors.registrationOpensAt}>
              {(props) => <Input {...props} name="registrationOpensAt" type="datetime-local" defaultValue={values.registrationOpensAt ?? ""} />}
            </Field>
            <Field id="registrationClosesAt" label="Participation closes" optional hint="Empty: when the event ends." error={errors.registrationClosesAt}>
              {(props) => <Input {...props} name="registrationClosesAt" type="datetime-local" defaultValue={values.registrationClosesAt ?? ""} />}
            </Field>
          </div>
        </Section>

        <Section title="Who can take part" description="Students only see events their college is invited to. The other rules are explained to students who do not meet them.">
          <fieldset>
            <legend className="text-sm font-semibold">Eligible colleges</legend>
            {/* Keyed like the selects: re-mount with the submitted choice after the form resets. */}
            <div className="mt-1" key={values.collegesMode ?? "host"}>
              <Radio
                id="collegesMode-host"
                name="collegesMode"
                value="host"
                defaultChecked={(values.collegesMode ?? "host") === "host"}
                onChange={() => setCollegesMode("host")}
                label={`Only ${hostName}`}
              />
              <Radio
                id="collegesMode-selected"
                name="collegesMode"
                value="selected"
                defaultChecked={(values.collegesMode ?? "host") === "selected"}
                onChange={() => setCollegesMode("selected")}
                label={`${hostName} and selected colleges`}
              />
              {collegesMode === "selected" ? (
                <fieldset className="mb-2 ml-9 rounded-field border border-line px-3 py-2" key={(values.collegeIds ?? []).join(",")}>
                  <legend className="px-1 text-sm text-ink-muted">Also invite</legend>
                  {otherColleges.length === 0 ? (
                    <p className="py-1 text-sm text-ink-muted">There are no other open colleges yet.</p>
                  ) : (
                    <div className="grid gap-x-4 sm:grid-cols-2">
                      {otherColleges.map((college) => (
                        <Checkbox
                          key={college.id}
                          id={`college-${college.id}`}
                          name="collegeIds"
                          value={college.id}
                          defaultChecked={(values.collegeIds ?? []).includes(college.id)}
                          label={collegeLabel(college)}
                        />
                      ))}
                    </div>
                  )}
                </fieldset>
              ) : null}
              <Radio
                id="collegesMode-all"
                name="collegesMode"
                value="all"
                defaultChecked={(values.collegesMode ?? "host") === "all"}
                onChange={() => setCollegesMode("all")}
                label="All colleges"
                description="Every open college on Campus Partner Finder, including ones added later."
              />
            </div>
            {errors.collegesMode || errors.collegeIds ? (
              <p className="mt-1 text-sm font-medium text-danger">{errors.collegesMode ?? errors.collegeIds}</p>
            ) : null}
          </fieldset>

          <Field id="minimumAge" label="Minimum age" hint={`On the day of the event. Cannot be below ${MIN_AGE}.`} error={errors.minimumAge} className="sm:max-w-xs">
            {(props) => (
              <Input {...props} name="minimumAge" type="number" inputMode="numeric" min={MIN_AGE} max={EVENT_MAX_AGE_LIMIT} step={1} required defaultValue={values.minimumAge ?? MIN_AGE} />
            )}
          </Field>

          <Field
            id="courses"
            label="Limit to courses"
            optional
            hint="One per line, for example B.Tech or MBA. A student qualifies if their course contains one of these as whole words. Empty: any course."
            error={errors.courses}
          >
            {(props) => <Textarea {...props} name="courses" rows={3} defaultValue={values.courses ?? ""} />}
          </Field>

          <fieldset key={(values.studyYears ?? []).join(",")}>
            <legend className="flex w-full items-baseline justify-between gap-3 text-sm font-semibold">
              <span>Limit to years of study</span>
              <span className="font-normal text-ink-muted">Optional</span>
            </legend>
            <div className="mt-1 flex flex-wrap gap-x-5">
              {STUDY_YEARS.map((year) => (
                <Checkbox
                  key={year}
                  id={`studyYear-${year}`}
                  name="studyYears"
                  value={year}
                  defaultChecked={(values.studyYears ?? []).map(String).includes(String(year))}
                  label={yearLabel(year)}
                />
              ))}
            </div>
            <p className="text-sm text-ink-muted">None ticked: any year.</p>
            {errors.studyYears ? <p className="mt-1 text-sm font-medium text-danger">{errors.studyYears}</p> : null}
          </fieldset>
        </Section>

        <Section title="Requirements">
          <Field
            id="requirements"
            label="What students need"
            optional
            hint={`Dress code, ID, entry fee, what to bring. Up to ${EVENT_REQUIREMENTS_MAX} characters.`}
            error={errors.requirements}
          >
            {(props) => <Textarea {...props} name="requirements" rows={4} maxLength={EVENT_REQUIREMENTS_MAX} defaultValue={values.requirements ?? ""} />}
          </Field>
        </Section>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton name="intent" value="save">
            {mode === "create" ? "Save as draft" : "Save changes"}
          </SubmitButton>
          <SubmitButton name="intent" value="preview" variant="secondary">
            Save and preview
          </SubmitButton>
          <Link href={cancelHref} className={buttonClasses({ variant: "ghost" })}>
            Cancel
          </Link>
        </div>
        {mode === "create" ? <p className="text-sm text-ink-muted">Saving never publishes. You publish from the preview or the event page.</p> : null}
      </fieldset>
    </form>
  );
}
