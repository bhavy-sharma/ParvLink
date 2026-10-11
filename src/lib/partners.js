// Wording shared by the partner-finding screens.

import { BLOCKER_MESSAGES } from "@/lib/events";
import { GENDERS } from "@/lib/validation/limits";

export const partnerLabel = (gender) => GENDERS.find((g) => g.value === gender)?.partnerLabel ?? "a partner";
export const genderLabel = (gender) => GENDERS.find((g) => g.value === gender)?.label ?? "Not set";

/**
 * Where the signed-in student stands for one event, from my_event_participation():
 *   not_joined | active | closed | ended
 * "ended" = they joined, but the event (or their eligibility) no longer allows
 * taking part. Their matches stay visible.
 */
export function participationState(me) {
  if (!me?.joined) return "not_joined";
  if ((me.blockers ?? []).length > 0) return "ended";
  return me.status === "active" ? "active" : "closed";
}

/** Plain sentences for the reasons the database gives (codes → text). */
export function blockerSentences(blockers = []) {
  return blockers.map((code) => BLOCKER_MESSAGES[code]?.text ?? "A requirement for this event is not met.");
}

/** The detail of a `participation_blocked` error ("a,b") as sentences. */
export function describeParticipationError(error) {
  const codes = String(error?.details ?? "").split(",").filter(Boolean);
  if (codes.length === 0) return "You cannot take part in this event right now.";
  return blockerSentences(codes).join(" ");
}
