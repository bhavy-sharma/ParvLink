"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { joinEventAction } from "@/app/(student)/partner-actions";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Button, buttonClasses } from "@/components/ui/button";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { GENDERS } from "@/lib/validation/limits";

function Choice({ name, value, checked, onChange, label }) {
  const id = `${name}-${value}`;
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer items-center gap-3 rounded-field border px-4 py-3 ${checked ? "border-brand bg-brand-soft" : "border-line-strong bg-surface hover:border-ink-muted"}`}
    >
      <input id={id} type="radio" name={name} value={value} checked={checked} onChange={onChange} className="size-5 accent-brand" />
      <span className="font-semibold">{label}</span>
    </label>
  );
}

/**
 * Step 1: choose. Step 2: read the summary and confirm. Nothing is saved until
 * the confirm button is pressed.
 *
 * `savedGender` is the student's stored gender, or null if it has never been
 * asked (it is asked once, here, and cannot be changed afterwards).
 */
export function JoinForm({ slug, eventTitle, savedGender, currentLookingFor, cancelHref }) {
  const [state, formAction] = useActionState(joinEventAction, INITIAL_FORM_STATE);
  const [gender, setGender] = useState(savedGender ?? "");
  const [lookingFor, setLookingFor] = useState(currentLookingFor ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [hint, setHint] = useState("");

  const needsGender = !savedGender;
  const partner = GENDERS.find((g) => g.value === lookingFor)?.partnerLabel;

  function review() {
    if ((needsGender && !gender) || !lookingFor) return setHint(needsGender ? "Answer both questions to continue." : "Choose who you are looking for.");
    setHint("");
    setReviewing(true);
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="slug" value={slug} />
      <FormMessage state={state} />

      {/* Step 1 stays mounted (hidden) during review so the radios are submitted. */}
      <div className={reviewing ? "hidden" : "space-y-6"}>
        {needsGender ? (
          <fieldset>
            <legend className="text-lg font-semibold">I am</legend>
            <p className="mt-1 text-sm text-ink-muted">
              Used only to match preferences. It is not shown on your profile, and it cannot be changed later.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {GENDERS.map((option) => (
                <Choice key={option.value} name="gender" value={option.value} checked={gender === option.value} onChange={() => setGender(option.value)} label={option.label} />
              ))}
            </div>
            {state.fieldErrors.gender ? <p className="mt-2 text-sm font-medium text-danger">{state.fieldErrors.gender}</p> : null}
          </fieldset>
        ) : null}

        <fieldset>
          <legend className="text-lg font-semibold">For this event, I am</legend>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {GENDERS.map((option) => (
              <Choice
                key={option.value}
                name="lookingFor"
                value={option.value}
                checked={lookingFor === option.value}
                onChange={() => setLookingFor(option.value)}
                label={`Looking for ${option.partnerLabel}`}
              />
            ))}
          </div>
          {state.fieldErrors.lookingFor ? <p className="mt-2 text-sm font-medium text-danger">{state.fieldErrors.lookingFor}</p> : null}
        </fieldset>

        {hint ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {hint}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button onClick={review}>Continue</Button>
          <Link href={cancelHref} className={buttonClasses({ variant: "ghost" })}>
            Cancel
          </Link>
        </div>
      </div>

      {reviewing ? (
        <div className="space-y-5">
          <div className="rounded-field border border-line bg-paper px-4 py-4">
            <h2 className="font-sans text-base font-semibold">Check before you join</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
              <li>
                You are joining partner discovery for <strong>{eventTitle}</strong>, looking for <strong>{partner}</strong>.
              </li>
              {needsGender ? (
                <li>
                  You are saving your gender as <strong>{GENDERS.find((g) => g.value === gender)?.label.toLowerCase()}</strong>. This cannot be changed later.
                </li>
              ) : null}
              <li>Students in this event whose preference matches yours will see your first name, course, year and photo. Nothing else.</li>
              <li>You can close your profile for this event at any time.</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-3">
            <SubmitButton pendingLabel="Joining…">Confirm and join</SubmitButton>
            <Button variant="secondary" onClick={() => setReviewing(false)}>
              Go back
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
