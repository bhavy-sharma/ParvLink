// Event rules shared by server and client code: how an event's status and
// dates translate into what a student sees, how eligibility reads in plain
// language, and which status changes exist. The database enforces all of it;
// this file only describes it.

import { dateToZonedInput, formatDateTimeLong } from "@/lib/dates";
import { yearLabel } from "@/lib/format";
import { EVENT_STATUSES, EVENT_TYPES, MIN_AGE } from "@/lib/validation/limits";

export const eventTypeLabel = (value) => EVENT_TYPES.find((t) => t.value === value)?.label ?? "Other";
export const eventStatusLabel = (value) => EVENT_STATUSES.find((s) => s.value === value)?.label ?? value;

/** Columns a student may be shown. No internal fields. */
export const EVENT_PUBLIC_COLUMNS =
  "id, slug, title, description, event_type, venue, starts_at, ends_at, registration_opens_at, registration_closes_at, minimum_age, eligibility_rules, requirements, status, college_id, colleges ( id, name, city )";

/** Columns for the admin screens. */
export const EVENT_ADMIN_COLUMNS = `${EVENT_PUBLIC_COLUMNS}, published_at, created_at, updated_at`;

/**
 * Where an event stands for students right now.
 *   draft      not published (admins only)
 *   upcoming   published, registration has not opened yet
 *   open       published and taking participants
 *   closed     closed by an admin, or registration has ended
 *   completed  marked completed, or the event has ended
 * Mirrors private.participation_blockers() in the database.
 */
export function eventPhase(event, now = new Date()) {
  const time = now.getTime();
  if (event.status === "draft") return "draft";
  if (event.status === "completed" || new Date(event.ends_at).getTime() <= time) return "completed";
  if (event.status === "closed") return "closed";
  if (event.registration_opens_at && new Date(event.registration_opens_at).getTime() > time) return "upcoming";
  if (event.registration_closes_at && new Date(event.registration_closes_at).getTime() <= time) return "closed";
  return "open";
}

export const PHASES = {
  draft: { label: "Draft", tone: "neutral" },
  upcoming: { label: "Opens soon", tone: "warning" },
  open: { label: "Open", tone: "ok" },
  closed: { label: "Closed", tone: "neutral" },
  completed: { label: "Completed", tone: "neutral" },
};

/** One sentence under the status badge. */
export function phaseSentence(event, now = new Date()) {
  switch (eventPhase(event, now)) {
    case "draft":
      return "Not published. Students cannot see this event.";
    case "upcoming":
      return `Opens for participation on ${formatDateTimeLong(event.registration_opens_at)}.`;
    case "open":
      return event.registration_closes_at
        ? `Open for participation until ${formatDateTimeLong(event.registration_closes_at)}.`
        : "Open for participation until the event ends.";
    case "closed":
      return event.status === "closed" ? "Closed to new participants by the organisers." : "Participation has closed.";
    default:
      return "This event is over. It stays here as a record.";
  }
}

export const STATUS_TONES = { draft: "neutral", published: "ok", closed: "warning", completed: "neutral" };

/**
 * Status changes an admin can make, with the words used on the buttons and in
 * the confirmation. Mirrors private.events_before_write().
 */
export const STATUS_ACTIONS = {
  draft: [
    {
      to: "published",
      label: "Publish event",
      confirm: "Yes, publish",
      done: "Event published.",
      effect: "Students at the invited colleges will see this event straight away.",
      variant: "primary",
    },
  ],
  published: [
    {
      to: "closed",
      label: "Close to new participants",
      confirm: "Yes, close it",
      done: "Event closed to new participants.",
      effect: "Students still see the event, marked as closed. Nobody new can take part. You can re-open it later.",
      variant: "danger",
    },
    {
      to: "completed",
      label: "Mark as completed",
      confirm: "Yes, mark completed",
      done: "Event marked as completed.",
      effect: "The event becomes a permanent record. It cannot be edited or re-opened afterwards.",
      variant: "danger",
    },
  ],
  closed: [
    {
      to: "published",
      label: "Re-open event",
      confirm: "Yes, re-open",
      done: "Event re-opened.",
      effect: "Students can take part again.",
      variant: "primary",
    },
    {
      to: "completed",
      label: "Mark as completed",
      confirm: "Yes, mark completed",
      done: "Event marked as completed.",
      effect: "The event becomes a permanent record. It cannot be edited or re-opened afterwards.",
      variant: "danger",
    },
  ],
  completed: [],
};

export function isAllowedTransition(from, to) {
  return (STATUS_ACTIONS[from] ?? []).some((action) => action.to === to);
}

function joinWithOr(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

/**
 * Eligibility rules as plain-language lines.
 * `collegeNames` maps college id → name for the ids the viewer may read.
 */
export function describeEligibility(event, collegeNames = new Map()) {
  const rules = event.eligibility_rules ?? {};
  const lines = [];

  if (rules.colleges?.mode === "all") {
    lines.push({ label: "Colleges", text: "Students of every college on ParvLink." });
  } else {
    const ids = rules.colleges?.ids ?? [];
    // Host college first, then the others alphabetically.
    const names = ids
      .filter((id) => collegeNames.has(id))
      .map((id) => ({ id, name: collegeNames.get(id) }))
      .sort((a, b) => (b.id === event.college_id) - (a.id === event.college_id) || a.name.localeCompare(b.name))
      .map((college) => college.name);
    const unnamed = ids.length - names.length;
    const parts = [...names, ...(unnamed > 0 ? [unnamed === 1 ? "1 other college" : `${unnamed} other colleges`] : [])];
    lines.push({ label: "Colleges", text: parts.length ? `Students of ${joinWithOr(parts)}.` : "Students of the host college." });
  }

  lines.push({ label: "Age", text: `${event.minimum_age} or older on the day of the event.` });

  if (rules.courses?.length) lines.push({ label: "Courses", text: `${joinWithOr(rules.courses)}.` });
  if (rules.study_years?.length) lines.push({ label: "Years", text: `${joinWithOr(rules.study_years.map((year) => yearLabel(year)))}.` });

  return lines;
}

/** What to tell a student for each reason they cannot take part (codes from the database). */
export const BLOCKER_MESSAGES = {
  no_profile: { text: "Create your student profile first.", action: "onboarding" },
  profile_suspended: { text: "Your profile is suspended. Contact your college admin." },
  photo_missing: { text: "Add a profile photo. Partners need to see who they are teaming up with.", action: "profile" },
  college_not_invited: { text: "Your college is not invited to this event." },
  under_age: { text: "You will be under the minimum age on the day of the event." },
  course_not_eligible: { text: "This event is limited to other courses." },
  year_not_eligible: { text: "This event is limited to other years of study." },
  event_not_published: { text: "This event has not been published yet." },
  event_completed: { text: "This event is over." },
  event_closed: { text: "The organisers have closed this event to new participants." },
  registration_not_open: { text: "Participation has not opened yet." },
  registration_closed: { text: "Participation has closed." },
};

/** Blockers about the student (things they could fix or that concern their eligibility) vs about the event's timing. */
const TIMING_BLOCKERS = new Set(["event_not_published", "event_completed", "event_closed", "registration_not_open", "registration_closed"]);
export const isTimingBlocker = (code) => TIMING_BLOCKERS.has(code);

/** Form field values for a new event. */
export function blankEventFormValues(hostCollegeId = "") {
  return {
    title: "",
    eventType: "",
    collegeId: hostCollegeId,
    description: "",
    venue: "",
    startsAt: "",
    endsAt: "",
    registrationOpensAt: "",
    registrationClosesAt: "",
    minimumAge: String(MIN_AGE),
    collegesMode: "host",
    collegeIds: [],
    courses: "",
    studyYears: [],
    requirements: "",
  };
}

/** Form field values for an existing event (dates converted to the app's time zone). */
export function eventToFormValues(event) {
  const rules = event.eligibility_rules ?? {};
  const invited = (rules.colleges?.ids ?? []).filter((id) => id !== event.college_id);
  return {
    title: event.title ?? "",
    eventType: event.event_type ?? "",
    collegeId: event.college_id,
    description: event.description ?? "",
    venue: event.venue ?? "",
    startsAt: dateToZonedInput(event.starts_at),
    endsAt: dateToZonedInput(event.ends_at),
    registrationOpensAt: dateToZonedInput(event.registration_opens_at),
    registrationClosesAt: dateToZonedInput(event.registration_closes_at),
    minimumAge: String(event.minimum_age ?? MIN_AGE),
    collegesMode: rules.colleges?.mode === "all" ? "all" : invited.length > 0 ? "selected" : "host",
    collegeIds: invited,
    courses: (rules.courses ?? []).join("\n"),
    studyYears: (rules.study_years ?? []).map(String),
    requirements: event.requirements ?? "",
  };
}
