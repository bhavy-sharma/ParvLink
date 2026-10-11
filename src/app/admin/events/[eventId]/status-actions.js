"use client";

import { useActionState } from "react";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { FormMessage } from "@/components/forms/form-message";
import { INITIAL_FORM_STATE } from "@/lib/form-state";
import { changeEventStatusAction } from "../actions";

/**
 * The status changes available for an event. Each one is a two-step button:
 * the consequence is spelled out, the first press arms it, the second confirms.
 * `actions` comes from STATUS_ACTIONS for the event's current status.
 */
export function StatusActions({ eventId, actions }) {
  const [state, formAction] = useActionState(changeEventStatusAction, INITIAL_FORM_STATE);

  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      {actions.length === 0 ? (
        <p className="text-sm text-ink-muted">This event is completed. Its status can no longer change.</p>
      ) : (
        <ul className="space-y-5">
          {actions.map((action) => (
            // Keyed by target status so a confirmed button does not stay "armed" for the next action.
            <li key={action.to}>
              <form action={formAction} className="space-y-2">
                <input type="hidden" name="eventId" value={eventId} />
                <input type="hidden" name="status" value={action.to} />
                <p className="text-sm text-ink-muted">{action.effect}</p>
                <ConfirmSubmit
                  confirmLabel={action.confirm}
                  variant={action.variant === "primary" ? "primary" : "danger"}
                  confirmVariant={action.variant === "primary" ? "primary" : "dangerSolid"}
                  size="md"
                >
                  {action.label}
                </ConfirmSubmit>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
