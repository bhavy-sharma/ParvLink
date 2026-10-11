"use server";

// Event management actions. Same rules as the other admin actions:
//   1. the caller's role and college scope are re-read on the server;
//   2. input is validated here, then again by database constraints/triggers;
//   3. the write goes through a service that checks the caller's access again.
// The host college of a new event comes from the form, but is only accepted
// if it is in the caller's own manageable set — and the service checks it once more.
// Status, creator, URL slug and publish time are never taken from the request.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { ROUTES } from "@/lib/auth/routes";
import { requireEventManager, requireManagedEvent } from "@/lib/auth/session";
import { isAllowedTransition, STATUS_ACTIONS } from "@/lib/events";
import { formError, formSuccess } from "@/lib/form-state";
import { eventStatusChangeSchema, parseEventForm } from "@/lib/validation/schemas";
import { call } from "@/lib/services";

const text = (formData, name) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};
const list = (formData, name) => formData.getAll(name).filter((value) => typeof value === "string");

/** Raw form values, echoed back so the form keeps what was typed after an error. */
function readEventForm(formData) {
  return {
    title: text(formData, "title"),
    eventType: text(formData, "eventType"),
    collegeId: text(formData, "collegeId"),
    description: text(formData, "description"),
    venue: text(formData, "venue"),
    startsAt: text(formData, "startsAt"),
    endsAt: text(formData, "endsAt"),
    registrationOpensAt: text(formData, "registrationOpensAt"),
    registrationClosesAt: text(formData, "registrationClosesAt"),
    minimumAge: text(formData, "minimumAge"),
    collegesMode: text(formData, "collegesMode"),
    collegeIds: list(formData, "collegeIds"),
    courses: text(formData, "courses"),
    studyYears: list(formData, "studyYears"),
    requirements: text(formData, "requirements"),
  };
}

const CHECK_FIELDS = "Check the highlighted fields.";
const eventPath = (id) => `${ROUTES.adminEvents}/${id}`;

function dbFailure(scope, error, values) {
  logServerError(scope, error);
  // Constraint names tell us which date rule the database refused.
  const constraint = String(error.message ?? "");
  if (error.code === "23514" && constraint.includes("events_time_order")) {
    return formError(CHECK_FIELDS, { fieldErrors: { endsAt: "The event must end after it starts." }, values });
  }
  if (error.code === "23514" && constraint.includes("events_registration")) {
    return formError(CHECK_FIELDS, { fieldErrors: { registrationClosesAt: "Check the participation window against the event dates." }, values });
  }
  return formError(describeDbError(error), { values });
}

export async function createEventAction(_previous, formData) {
  const { colleges } = await requireEventManager();

  const values = readEventForm(formData);
  const parsed = parseEventForm(values, { mode: "create" });
  if (!parsed.success) return formError(CHECK_FIELDS, { fieldErrors: parsed.fieldErrors, values });

  // The host college must be one this user manages, and open.
  const host = colleges.find((college) => college.id === parsed.collegeId);
  if (!host) return formError(CHECK_FIELDS, { fieldErrors: { collegeId: "You cannot create events for that college." }, values });
  if (!host.is_active) return formError(CHECK_FIELDS, { fieldErrors: { collegeId: "That college is closed. Choose an open college." }, values });

  // Saved as a draft. Status, address and creator are set by the service, never by the form.
  const { data: id, error } = await call("admin_create_event", { college_id: host.id, ...parsed.row });
  if (error || !id) return dbFailure("admin.event.create", error ?? { code: "no_row" }, values);

  revalidatePath("/", "layout");
  redirect(formData.get("intent") === "preview" ? `${eventPath(id)}/preview` : `${eventPath(id)}?saved=created`);
}

export async function updateEventAction(_previous, formData) {
  const { event } = await requireManagedEvent(text(formData, "eventId"));

  const values = readEventForm(formData);
  if (event.status === "completed") {
    return formError("This event is completed and can no longer be changed.", { values });
  }
  const parsed = parseEventForm(values, { mode: "edit", hostCollegeId: event.college_id, currentStatus: event.status });
  if (!parsed.success) return formError(CHECK_FIELDS, { fieldErrors: parsed.fieldErrors, values });

  const { data: saved, error } = await call("admin_update_event", { event_id: event.id, row: parsed.row });
  if (error) return dbFailure("admin.event.update", error, values);
  if (!saved) return formError("You no longer have access to this event.", { values });

  revalidatePath("/", "layout");
  if (formData.get("intent") === "preview") redirect(`${eventPath(event.id)}/preview`);
  return formSuccess(event.status === "draft" ? "Draft saved." : "Changes saved. Students see them straight away.", { values });
}

export async function changeEventStatusAction(_previous, formData) {
  await requireEventManager();
  const parsed = eventStatusChangeSchema.safeParse({ eventId: text(formData, "eventId"), status: text(formData, "status") });
  if (!parsed.success) return formError("That event could not be found.");

  const { event } = await requireManagedEvent(parsed.data.eventId);
  if (!isAllowedTransition(event.status, parsed.data.status)) {
    return formError("That change is not available from the event's current status. Reload the page.");
  }

  // `from` is the status this admin saw: the change only happens if nobody changed it in the meantime.
  const { data: changed, error } = await call("admin_change_event_status", { event_id: event.id, from: event.status, to: parsed.data.status });
  if (error) {
    logServerError("admin.event.status", error);
    return formError(describeDbError(error));
  }
  if (!changed) return formError("The event changed while you were looking at it. Reload the page.");

  revalidatePath("/", "layout");
  const done = STATUS_ACTIONS[event.status].find((action) => action.to === parsed.data.status)?.done ?? "Status changed.";
  return formSuccess(done);
}
