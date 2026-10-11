"use client";

import { useActionState } from "react";
import { sendInterestAction } from "@/app/(student)/partner-actions";
import { SubmitButton } from "@/components/forms/submit-button";
import { Badge } from "@/components/ui/misc";
import { INITIAL_FORM_STATE } from "@/lib/form-state";

/**
 * The action on a partner card. `relation` comes from the database:
 *   none → "Send Interest" · received → "Send Interest Back"
 *   sent → "Interest Sent" · matched → "Matched"
 * After a successful press the new state is shown at once; the button is
 * disabled while the request is in flight, so a double press sends one request
 * (and the database ignores repeats anyway).
 */
export function InterestButton({ slug, handle, relation, available = true, name }) {
  const [state, formAction] = useActionState(sendInterestAction, INITIAL_FORM_STATE);
  const current = state.status === "success" ? state.values.relation : relation;

  if (current === "matched") return <Badge tone="ok" className="px-3 py-1.5 text-sm">Matched</Badge>;
  if (current === "sent") return <Badge tone="brand" className="px-3 py-1.5 text-sm">Interest Sent</Badge>;
  if (!available) return <span className="text-sm text-ink-muted">No longer available for this event</span>;

  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="handle" value={handle} />
      <SubmitButton size="sm" pendingLabel="Sending…">
        {current === "received" ? "Send Interest Back" : "Send Interest"}
        <span className="sr-only"> to {name}</span>
      </SubmitButton>
      {state.status === "error" ? (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
