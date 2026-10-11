"use client";

import { useActionState, useId, useState } from "react";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { FormMessage } from "@/components/forms/form-message";
import { SubmitButton } from "@/components/forms/submit-button";
import { Avatar } from "@/components/ui/avatar";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { AVATAR_ACCEPTED_TYPES, AVATAR_MAX_UPLOAD_BYTES } from "@/lib/validation/limits";
import { removeAvatarAction, updateAvatarAction } from "../actions";

export function PhotoForm({ avatarUrl, name, disabled = false }) {
  const [state, formAction] = useActionState(updateAvatarAction, INITIAL_FORM_STATE);
  const [clientError, setClientError] = useState("");
  const inputId = useId();
  const hintId = `${inputId}-hint`;

  // Early feedback only — the server checks size and content again.
  function onFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return setClientError("");
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
      event.target.value = "";
      return setClientError("Use a JPEG, PNG or WebP photo.");
    }
    if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
      event.target.value = "";
      return setClientError("That photo is larger than 4 MB. Choose a smaller one.");
    }
    setClientError("");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar src={avatarUrl} name={name} size="lg" />
        <p id={hintId} className="text-sm text-ink-muted">
          JPEG, PNG or WebP, up to 4 MB. We crop it to a square and remove location data before saving.
        </p>
      </div>

      <FormMessage state={clientError ? { status: "error", message: clientError } : state} />

      <form action={formAction} className="space-y-3">
        <fieldset disabled={disabled} className="space-y-3">
          <legend className="sr-only">Profile photo</legend>
          <label htmlFor={inputId} className="block text-sm font-semibold">
            {avatarUrl ? "Replace photo" : "Choose a photo"}
          </label>
          <input
            id={inputId}
            name="photo"
            type="file"
            accept={AVATAR_ACCEPTED_TYPES.join(",")}
            aria-describedby={hintId}
            onChange={onFileChange}
            required
            className="block w-full cursor-pointer rounded-field border border-line-strong bg-surface text-sm text-ink-muted file:mr-3 file:cursor-pointer file:border-0 file:bg-brand-soft file:px-4 file:py-2.5 file:font-semibold file:text-brand-strong disabled:cursor-not-allowed"
          />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Uploading…">
            Upload photo
          </SubmitButton>
        </fieldset>
      </form>

      {avatarUrl && !disabled ? (
        <form action={removeAvatarAction}>
          <ConfirmSubmit confirmLabel="Yes, remove photo" pendingLabel="Removing…">
            Remove photo
          </ConfirmSubmit>
        </form>
      ) : null}
    </div>
  );
}
