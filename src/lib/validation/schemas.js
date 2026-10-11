// Server-side validation for every form. The same schemas give the forms their
// error messages, but the server never relies on the browser having run them.
// The database enforces the same limits again with CHECK constraints.

import { z } from "zod";
import { ageOn, parseIsoDate, zonedInputToDate } from "@/lib/dates";
import {
  ADMIN_PERMISSION_VALUES,
  BIO_MAX,
  DELETE_CONFIRM_WORD,
  FEEDBACK_CATEGORY_VALUES,
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  DECISION_NOTE_MAX,
  MODERATION_ACTIONS,
  MODERATION_REASON_MAX,
  REPORT_NOTE_MAX,
  REPORT_STATUS_VALUES,
  CHAT_REPORT_REASON_VALUES,
  COLLEGE_CITY_MAX,
  COLLEGE_NAME_MAX,
  COLLEGE_NAME_MIN,
  COLLEGE_SLUG_MAX,
  COURSE_MAX,
  COURSE_MIN,
  EMAIL_MAX,
  EVENT_COURSE_RULE_MAX,
  EVENT_COURSE_RULE_MIN,
  EVENT_COURSE_RULES_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_DESCRIPTION_MIN,
  EVENT_MAX_AGE_LIMIT,
  EVENT_REQUIREMENTS_MAX,
  EVENT_SELECTED_COLLEGES_MAX,
  EVENT_STATUS_VALUES,
  EVENT_TITLE_MAX,
  EVENT_TITLE_MIN,
  EVENT_TYPE_VALUES,
  EVENT_VENUE_MAX,
  EVENT_VENUE_MIN,
  FIRST_NAME_MAX,
  GENDER_VALUES,
  MAX_AGE,
  MESSAGE_MAX,
  MIN_AGE,
  PASSWORD_MAX,
  PASSWORD_MIN,
  REPORT_DETAILS_MAX,
  REPORT_REASON_VALUES,
  STUDY_YEAR_MAX,
  STUDY_YEAR_MIN,
} from "./limits";

const multilineText = (value) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : value);
// Collapses runs of whitespace and trims — applied before length checks.
const tidy = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : value);
// No angle brackets or control characters in short text fields.
const SAFE_TEXT = /^[^<>\u0000-\u001f\u007f]*$/;
// Letters (any script), marks, spaces, apostrophes, dots and hyphens.
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u;

const email = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z
    .string({ error: "Enter your email address." })
    .min(1, "Enter your email address.")
    .max(EMAIL_MAX, "That email address is too long.")
    .pipe(z.email("Enter a valid email address, like name@college.edu.")),
);

const uuid = (message) => z.string({ error: message }).pipe(z.uuid(message));

export const loginSchema = z.object({
  email,
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX, "That password is too long."),
});

const newPassword = z
  .string({ error: "Choose a password." })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`)
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), "Include at least one letter and one number.");
const passwordsMatch = [
  (data) => data.password === data.confirmPassword,
  { path: ["confirmPassword"], message: "The two passwords do not match." },
];

export const registerSchema = z
  .object({
    email,
    password: newPassword,
    confirmPassword: z.string({ error: "Re-enter your password." }),
    // The box must be ticked by the person; nothing else counts as agreement.
    // Written as a check rather than a literal type, so that a missing tick is
    // reported together with the other problems (password mismatch included).
    agree: z.any().refine((value) => value === "on", { error: "Tick the box to agree to the Terms of Use and the Privacy Notice." }),
  })
  .refine(...passwordsMatch);

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string({ error: "Re-enter your password." }) })
  .refine(...passwordsMatch);

export const deleteAccountSchema = z.object({
  password: z.string({ error: "Enter your password." }).min(1, "Enter your password.").max(PASSWORD_MAX),
  confirm: z.literal(DELETE_CONFIRM_WORD, { error: `Type ${DELETE_CONFIRM_WORD} in capitals to confirm.` }),
});

export const feedbackSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORY_VALUES, { error: "Choose what this is about." }),
  description: z.preprocess(
    multilineText,
    z.string().min(FEEDBACK_MIN, `Describe it in at least ${FEEDBACK_MIN} characters.`).max(FEEDBACK_MAX, `Keep it under ${FEEDBACK_MAX} characters.`),
  ),
  steps: z.preprocess(
    (value) => {
      const text = multilineText(value);
      return text === "" || text == null ? null : text;
    },
    z.string().max(FEEDBACK_MAX, `Keep it under ${FEEDBACK_MAX} characters.`).nullable(),
  ),
});
export const feedbackIdSchema = z.object({
  feedbackId: z.string().pipe(z.uuid()),
  reviewed: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export const emailOnlySchema = z.object({ email });

const firstName = z.preprocess(
  tidy,
  z
    .string({ error: "Enter your first name." })
    .min(1, "Enter your first name.")
    .max(FIRST_NAME_MAX, `Use at most ${FIRST_NAME_MAX} characters.`)
    .regex(NAME, "Use letters only — no numbers or symbols."),
);

const course = z.preprocess(
  tidy,
  z
    .string({ error: "Enter your course." })
    .min(COURSE_MIN, "Enter your course, like B.Tech Computer Science.")
    .max(COURSE_MAX, `Use at most ${COURSE_MAX} characters.`)
    .regex(SAFE_TEXT, "Remove the < or > characters."),
);

const studyYear = z.coerce
  .number({ error: "Choose your year of study." })
  .int("Choose your year of study.")
  .min(STUDY_YEAR_MIN, "Choose your year of study.")
  .max(STUDY_YEAR_MAX, "Choose your year of study.");

const bio = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value ?? null;
    const trimmed = value.replace(/\r\n/g, "\n").trim();
    return trimmed === "" ? null : trimmed;
  },
  z.string().max(BIO_MAX, `Keep your bio under ${BIO_MAX} characters.`).nullable(),
);

const dateOfBirth = z
  .string({ error: "Enter your date of birth." })
  .min(1, "Enter your date of birth.")
  .refine((value) => parseIsoDate(value) !== null, "Enter a real date.")
  .refine((value) => {
    const age = ageOn(value);
    return age === null || (age >= 0 && age <= MAX_AGE);
  }, "Check the year — that date does not look right.")
  .refine((value) => {
    const age = ageOn(value);
    return age === null || age < 0 || age > MAX_AGE || age >= MIN_AGE;
  }, `You must be ${MIN_AGE} or older to use Campus Partner Finder.`);

export const profileCreateSchema = z.object({
  firstName,
  collegeId: uuid("Choose your college."),
  course,
  studyYear,
  dateOfBirth,
  bio,
});

// College and date of birth are fixed after sign-up, so they are not editable here.
export const profileUpdateSchema = z.object({ firstName, course, studyYear, bio });

export const collegeSchema = z.object({
  name: z.preprocess(
    tidy,
    z
      .string({ error: "Enter the college name." })
      .min(COLLEGE_NAME_MIN, "Enter the college name.")
      .max(COLLEGE_NAME_MAX, `Use at most ${COLLEGE_NAME_MAX} characters.`)
      .regex(SAFE_TEXT, "Remove the < or > characters."),
  ),
  slug: z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z
      .string({ error: "Enter a short name." })
      .min(2, "Use at least 2 characters.")
      .max(COLLEGE_SLUG_MAX, `Use at most ${COLLEGE_SLUG_MAX} characters.`)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens, like st-xaviers-mumbai."),
  ),
  city: z.preprocess(
    (value) => {
      const tidied = tidy(value);
      return tidied === "" || tidied === undefined ? null : tidied;
    },
    z.string().max(COLLEGE_CITY_MAX, `Use at most ${COLLEGE_CITY_MAX} characters.`).regex(SAFE_TEXT, "Remove the < or > characters.").nullable(),
  ),
  isActive: z.boolean(),
});

export const collegeIdSchema = z.object({ collegeId: uuid("That college could not be found.") });

const permissions = z
  .array(z.enum(ADMIN_PERMISSION_VALUES, { error: "Unknown permission." }), { error: "Choose at least one permission." })
  .min(1, "Choose at least one permission.")
  .transform((values) => [...new Set(values)]);

export const grantAdminSchema = z.object({ email });
export const adminUserSchema = z.object({ userId: uuid("That admin could not be found.") });
export const assignCollegeSchema = z.object({
  userId: uuid("That admin could not be found."),
  collegeId: uuid("Choose a college."),
  permissions,
});
export const revokeCollegeSchema = z.object({
  userId: uuid("That admin could not be found."),
  collegeId: uuid("That college could not be found."),
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

const multiline = (value) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : value);
const optionalMultiline = (value) => {
  const text = multiline(value);
  return text === "" || text === undefined || text === null ? null : text;
};

// A date-time typed into <input type="datetime-local">, read in the app's time zone.
const requiredDateTime = (missing) =>
  z
    .string({ error: missing })
    .min(1, missing)
    .transform((value, ctx) => {
      const date = zonedInputToDate(value);
      if (!date) {
        ctx.addIssue({ code: "custom", message: "Enter a real date and time." });
        return z.NEVER;
      }
      return date;
    });

const optionalDateTime = z.preprocess(
  (value) => (value === "" || value === undefined ? null : value),
  z
    .string()
    .nullable()
    .transform((value, ctx) => {
      if (value === null) return null;
      const date = zonedInputToDate(value);
      if (!date) {
        ctx.addIssue({ code: "custom", message: "Enter a real date and time, or leave this empty." });
        return z.NEVER;
      }
      return date;
    }),
);

// "B.Tech, MBA" or one per line → ["B.Tech", "MBA"], de-duplicated ignoring case.
const courseRules = z.preprocess(
  (value) => {
    if (typeof value !== "string") return [];
    const seen = new Set();
    return value
      .split(/[\n,;]+/)
      .map((item) => tidy(item))
      .filter((item) => {
        if (!item || seen.has(item.toLowerCase())) return false;
        seen.add(item.toLowerCase());
        return true;
      });
  },
  z
    .array(
      z
        .string()
        .min(EVENT_COURSE_RULE_MIN, `Each course needs at least ${EVENT_COURSE_RULE_MIN} characters.`)
        .max(EVENT_COURSE_RULE_MAX, `Keep each course under ${EVENT_COURSE_RULE_MAX} characters.`)
        .regex(SAFE_TEXT, "Remove the < or > characters.")
        .regex(/[\p{L}\p{N}]/u, "Each course needs letters or numbers."),
    )
    .max(EVENT_COURSE_RULES_MAX, `List at most ${EVENT_COURSE_RULES_MAX} courses.`),
);

const eventFields = {
  title: z.preprocess(
    tidy,
    z
      .string({ error: "Enter the event title." })
      .min(EVENT_TITLE_MIN, "Enter the event title.")
      .max(EVENT_TITLE_MAX, `Keep the title under ${EVENT_TITLE_MAX} characters.`)
      .regex(SAFE_TEXT, "Remove the < or > characters."),
  ),
  eventType: z.enum(EVENT_TYPE_VALUES, { error: "Choose the type of event." }),
  description: z.preprocess(
    multiline,
    z
      .string({ error: "Describe the event." })
      .min(EVENT_DESCRIPTION_MIN, `Describe the event in at least ${EVENT_DESCRIPTION_MIN} characters.`)
      .max(EVENT_DESCRIPTION_MAX, `Keep the description under ${EVENT_DESCRIPTION_MAX} characters.`),
  ),
  venue: z.preprocess(
    tidy,
    z
      .string({ error: "Enter the venue." })
      .min(EVENT_VENUE_MIN, "Enter the venue.")
      .max(EVENT_VENUE_MAX, `Keep the venue under ${EVENT_VENUE_MAX} characters.`)
      .regex(SAFE_TEXT, "Remove the < or > characters."),
  ),
  startsAt: requiredDateTime("Enter when the event starts."),
  endsAt: requiredDateTime("Enter when the event ends."),
  registrationOpensAt: optionalDateTime,
  registrationClosesAt: optionalDateTime,
  minimumAge: z.coerce
    .number({ error: "Enter the minimum age." })
    .int("Enter a whole number.")
    .min(MIN_AGE, `The minimum age cannot be below ${MIN_AGE}.`)
    .max(EVENT_MAX_AGE_LIMIT, `Enter an age of ${EVENT_MAX_AGE_LIMIT} or less.`),
  collegesMode: z.enum(["host", "selected", "all"], { error: "Choose which colleges can take part." }),
  collegeIds: z
    .array(z.string().pipe(z.uuid("One of the selected colleges could not be found.")), { error: "Choose the colleges." })
    .max(EVENT_SELECTED_COLLEGES_MAX, "Too many colleges selected.")
    .transform((ids) => [...new Set(ids)]),
  courses: courseRules,
  studyYears: z
    .array(z.coerce.number().int().min(STUDY_YEAR_MIN, "Choose valid years.").max(STUDY_YEAR_MAX, "Choose valid years."), { error: "Choose valid years." })
    .transform((years) => [...new Set(years)].sort((a, b) => a - b)),
  requirements: z.preprocess(
    optionalMultiline,
    z.string().max(EVENT_REQUIREMENTS_MAX, `Keep the requirements under ${EVENT_REQUIREMENTS_MAX} characters.`).nullable(),
  ),
};

function checkEventDates(data, ctx, { requireFutureEnd, now }) {
  const issue = (path, message) => ctx.addIssue({ code: "custom", path: [path], message });
  if (data.endsAt <= data.startsAt) issue("endsAt", "The event must end after it starts.");
  if (requireFutureEnd && data.endsAt <= now) issue("endsAt", "That time has already passed. Choose a future date.");
  const { registrationOpensAt: opens, registrationClosesAt: closes } = data;
  if (opens && closes && closes <= opens) issue("registrationClosesAt", "Participation must close after it opens.");
  if (opens && opens >= data.endsAt) issue("registrationOpensAt", "Participation must open before the event ends.");
  if (closes && closes > data.endsAt) issue("registrationClosesAt", "Participation cannot close after the event ends.");
  if (data.collegesMode === "selected" && data.collegeIds.length === 0) {
    issue("collegeIds", "Tick at least one college, or choose a different option above.");
  }
}

/**
 * Validates the event form and returns the row to write.
 *   mode "create": also needs the host college; the event must end in the future.
 *   mode "edit":   host college is fixed; a past end time is only refused for drafts.
 */
export function parseEventForm(input, { mode, hostCollegeId = null, currentStatus = "draft", now = new Date() }) {
  const shape = mode === "create" ? { ...eventFields, collegeId: uuid("Choose the host college.") } : eventFields;
  const schema = z.object(shape).superRefine((data, ctx) =>
    checkEventDates(data, ctx, { requireFutureEnd: mode === "create" || currentStatus === "draft", now }),
  );
  const result = schema.safeParse(input);
  if (!result.success) return { success: false, fieldErrors: fieldErrors(result.error) };

  const data = result.data;
  const host = mode === "create" ? data.collegeId : hostCollegeId;
  const colleges =
    data.collegesMode === "all"
      ? { mode: "all" }
      : { mode: "selected", ids: data.collegesMode === "selected" ? [...new Set([host, ...data.collegeIds])] : [host] };

  return {
    success: true,
    collegeId: host,
    row: {
      title: data.title,
      event_type: data.eventType,
      description: data.description,
      venue: data.venue,
      starts_at: data.startsAt.toISOString(),
      ends_at: data.endsAt.toISOString(),
      registration_opens_at: data.registrationOpensAt?.toISOString() ?? null,
      registration_closes_at: data.registrationClosesAt?.toISOString() ?? null,
      minimum_age: data.minimumAge,
      eligibility_rules: { colleges, courses: data.courses, study_years: data.studyYears },
      requirements: data.requirements,
    },
  };
}

export const eventIdSchema = z.object({ eventId: uuid("That event could not be found.") });
export const eventStatusChangeSchema = z.object({
  eventId: uuid("That event could not be found."),
  status: z.enum(EVENT_STATUS_VALUES, { error: "Unknown status." }),
});
export const eventSlugSchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80) });

// ---------------------------------------------------------------------------
// Partner finding (Phase 3)
// ---------------------------------------------------------------------------
const slugField = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);
const handle = z.string().pipe(z.uuid("That person could not be found."));
const gender = z.enum(GENDER_VALUES, { error: "Choose one." });

export const joinEventSchema = z.object({
  slug: slugField,
  lookingFor: z.enum(GENDER_VALUES, { error: "Choose who you are looking for." }),
  // Only sent the first time; the database ignores it afterwards.
  gender: z.preprocess((value) => (value === "" || value === undefined ? null : value), gender.nullable()),
});
export const eventProfileSchema = z.object({ slug: slugField, open: z.enum(["true", "false"]).transform((value) => value === "true") });
export const partnerSchema = z.object({ slug: slugField, handle });
export const reportPartnerSchema = z.object({
  slug: slugField,
  handle,
  reason: z.enum(REPORT_REASON_VALUES, { error: "Choose a reason." }),
  details: z.preprocess(
    optionalMultiline,
    z.string().max(REPORT_DETAILS_MAX, `Keep the description under ${REPORT_DETAILS_MAX} characters.`).nullable(),
  ),
});
export const blockIdSchema = z.object({ blockId: z.string().pipe(z.uuid()) });
export const partnerHandleSchema = z.object({ slug: slugField, handle });

// ---------------------------------------------------------------------------
// Chat (Phase 4)
// ---------------------------------------------------------------------------
const conversation = z.string().pipe(z.uuid("That conversation could not be found."));
const seq = z.number().int().min(0).max(2147483647);

export const conversationSchema = z.object({ conversation });

/** Same clean-up the database applies, so the length check here agrees with it. */
export function cleanMessageBody(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/^\s+|\s+$/g, "");
}

export const sendMessageSchema = z.object({
  conversation,
  clientId: z.string().pipe(z.uuid()),
  body: z.preprocess(
    cleanMessageBody,
    z
      .string()
      .refine((value) => /[^\s\u200B-\u200D\u2060\uFEFF]/.test(value), "Write a message first.")
      // Counted in characters (code points), like the database does.
      .refine((value) => [...value].length <= MESSAGE_MAX, `That message is too long. Keep it under ${MESSAGE_MAX} characters.`),
  ),
});

export const loadMessagesSchema = z
  .object({ conversation, before: seq.nullish(), after: seq.nullish() })
  .refine((value) => value.before == null || value.after == null);

export const reportChatSchema = z.object({
  conversation,
  reason: z.enum(CHAT_REPORT_REASON_VALUES, { error: "Choose a reason." }),
  details: z.preprocess(
    optionalMultiline,
    z.string().max(REPORT_DETAILS_MAX, `Keep the description under ${REPORT_DETAILS_MAX} characters.`).nullable(),
  ),
  includeMessages: z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean()),
});

// ---------------------------------------------------------------------------
// Moderation (Phase 5)
// ---------------------------------------------------------------------------
// Lengths and required reasons are checked again — authoritatively — by the
// database functions; these schemas give earlier, field-level messages.
const reportId = z.string().pipe(z.uuid("That report could not be found."));
const optionalText = (max, message) => z.preprocess(optionalMultiline, z.string().max(max, message).nullable());

export const reportIdSchema = z.object({ reportId });
export const reportStatusSchema = z.object({
  reportId,
  status: z.enum(REPORT_STATUS_VALUES, { error: "Choose a status." }),
  note: optionalText(DECISION_NOTE_MAX, `Keep the reason under ${DECISION_NOTE_MAX} characters.`),
});
export const reportAssignSchema = z.object({ reportId, assign: z.enum(["true", "false"]).transform((value) => value === "true") });
export const reportNoteSchema = z.object({
  reportId,
  body: z.preprocess(multiline, z.string().min(1, "Write the note first.").max(REPORT_NOTE_MAX, `Keep the note under ${REPORT_NOTE_MAX} characters.`)),
});
export const moderateUserSchema = z.object({
  userId: z.string().pipe(z.uuid("That student could not be found.")),
  action: z.enum(MODERATION_ACTIONS, { error: "Unknown action." }),
  reason: optionalText(MODERATION_REASON_MAX, `Keep the reason under ${MODERATION_REASON_MAX} characters.`),
  days: z.preprocess((value) => (value === "" || value == null ? null : Number(value)), z.number().int().min(1).max(365).nullable()),
  reportId: z.preprocess((value) => (value === "" || value == null ? null : value), reportId.nullable()),
});

/** { field: "first error message" } from a failed safeParse. */
export function fieldErrors(error) {
  const out = {};
  for (const issue of error.issues) {
    const key = issue.path[0] ?? "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Turns "St. Xavier's College, Mumbai" into "st-xaviers-college-mumbai". */
export function slugify(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, COLLEGE_SLUG_MAX)
    .replace(/-+$/g, "");
}
