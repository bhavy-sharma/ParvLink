"use server";

// Partner-finding actions. Each one:
//   1. requires a signed-in student with a profile;
//   2. validates its input (an event slug and, where needed, a person's
//      event-specific handle — never a user id);
//   3. looks the event up AS THE CALLER (so an event they may not see is simply
//      not found), then calls one database function, which takes the caller
//      from the session and re-checks every rule itself.
// Nothing here decides eligibility, compatibility or match status.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { eventPaths, ROUTES } from "@/lib/auth/routes";
import { requireProfile } from "@/lib/auth/session";
import { getStudentEvent } from "@/lib/data/student-events";
import { formError, formSuccess } from "@/lib/form-state";
import { describeParticipationError } from "@/lib/partners";
import { call } from "@/lib/services";
import { blockIdSchema, eventProfileSchema, fieldErrors, joinEventSchema, partnerSchema, reportPartnerSchema } from "@/lib/validation/schemas";

const text = (formData, name) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const EVENT_GONE = "That event could not be found. It may have been removed or closed to your college.";

function failure(scope, error, extra = {}) {
  logServerError(scope, error);
  const message = error?.message === "participation_blocked" ? describeParticipationError(error) : describeDbError(error);
  return formError(message, extra);
}

/** The event behind a slug, or null if this student may not see it. */
async function eventFor(slug) {
  return { event: await getStudentEvent(slug) };
}

export async function joinEventAction(_previous, formData) {
  await requireProfile();
  const values = { lookingFor: text(formData, "lookingFor"), gender: text(formData, "gender") };
  const parsed = joinEventSchema.safeParse({ slug: text(formData, "slug"), ...values });
  if (!parsed.success) return formError("Check the highlighted choices.", { fieldErrors: fieldErrors(parsed.error), values });

  const { event } = await eventFor(parsed.data.slug);
  if (!event) return formError(EVENT_GONE, { values });

  const { error } = await call("join_event", {
    p_event_id: event.id,
    p_looking_for: parsed.data.lookingFor,
    p_gender: parsed.data.gender,
  });
  if (error) {
    const field = { gender_required: "gender", gender_locked: "gender", invalid_preference: "lookingFor" }[error.message];
    return failure("partners.join", error, { values, fieldErrors: field ? { [field]: describeDbError(error) } : {} });
  }

  revalidatePath("/", "layout");
  redirect(eventPaths(event.slug).partners);
}

export async function setEventProfileOpenAction(_previous, formData) {
  await requireProfile();
  const parsed = eventProfileSchema.safeParse({ slug: text(formData, "slug"), open: text(formData, "open") });
  if (!parsed.success) return formError("That request was not understood. Reload the page and try again.");

  const { event } = await eventFor(parsed.data.slug);
  if (!event) return formError(EVENT_GONE);

  const { error } = await call("set_event_profile_open", { p_event_id: event.id, p_open: parsed.data.open });
  if (error) return failure("partners.profile", error);

  revalidatePath("/", "layout");
  return formSuccess(parsed.data.open ? "Your profile is open for this event again." : "Your profile is closed for this event.");
}

export async function sendInterestAction(_previous, formData) {
  await requireProfile();
  const parsed = partnerSchema.safeParse({ slug: text(formData, "slug"), handle: text(formData, "handle") });
  if (!parsed.success) return formError("That person could not be found.");

  const { event } = await eventFor(parsed.data.slug);
  if (!event) return formError(EVENT_GONE);

  const { data, error } = await call("send_interest", { p_event_id: event.id, p_handle: parsed.data.handle });
  if (error) return failure("partners.interest", error);

  revalidatePath("/", "layout");
  // `relation` lets the button show its new state at once.
  const matched = data?.state === "matched";
  return formSuccess(matched ? "It’s a match." : "Interest sent.", { values: { relation: matched ? "matched" : "sent" } });
}

export async function blockPartnerAction(_previous, formData) {
  await requireProfile();
  const parsed = partnerSchema.safeParse({ slug: text(formData, "slug"), handle: text(formData, "handle") });
  if (!parsed.success) return formError("That person could not be found.");

  const { event } = await eventFor(parsed.data.slug);
  if (!event) return formError(EVENT_GONE);

  const { error } = await call("block_partner", { p_event_id: event.id, p_handle: parsed.data.handle });
  if (error) return failure("partners.block", error);

  revalidatePath("/", "layout");
  return formSuccess("Blocked. You will not see each other in any event.");
}

export async function reportPartnerAction(_previous, formData) {
  await requireProfile();
  const values = { reason: text(formData, "reason"), details: text(formData, "details") };
  const parsed = reportPartnerSchema.safeParse({ slug: text(formData, "slug"), handle: text(formData, "handle"), ...values });
  if (!parsed.success) return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });

  const { event } = await eventFor(parsed.data.slug);
  if (!event) return formError(EVENT_GONE, { values });

  const { data, error } = await call("report_partner", {
    p_event_id: event.id,
    p_handle: parsed.data.handle,
    p_reason: parsed.data.reason,
    p_details: parsed.data.details,
  });
  if (error) return failure("partners.report", error, { values });

  return formSuccess(
    data === "already_reported"
      ? "You have already reported this profile. Your college’s moderators have it."
      : "Report sent to your college’s moderators. Thank you.",
  );
}

export async function unblockPartnerAction(_previous, formData) {
  await requireProfile();
  const parsed = blockIdSchema.safeParse({ blockId: text(formData, "blockId") });
  if (!parsed.success) return formError("That block could not be found.");

  const { error } = await call("unblock_partner", { p_block_id: parsed.data.blockId });
  if (error) return failure("partners.unblock", error);

  revalidatePath(ROUTES.matches, "layout");
  return formSuccess("Unblocked.");
}
