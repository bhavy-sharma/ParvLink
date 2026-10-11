// Single source of truth for field limits used by forms, server-side
// validation and (mirrored) by the models in src/lib/db/models.js and the services.
// tests/db checks that MIN_AGE matches the database's private.min_age().

export const MIN_AGE = 18;
export const MAX_AGE = 100;

export const FIRST_NAME_MAX = 50;
export const COURSE_MIN = 2;
export const COURSE_MAX = 100;
export const BIO_MAX = 500;
export const STUDY_YEAR_MIN = 1;
export const STUDY_YEAR_MAX = 6;

export const COLLEGE_NAME_MIN = 2;
export const COLLEGE_NAME_MAX = 120;
export const COLLEGE_SLUG_MAX = 60;
export const COLLEGE_CITY_MAX = 80;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // bcrypt ignores bytes past 72 (see src/lib/auth/passwords.js)
export const EMAIL_MAX = 254;

// Profile photos
export const AVATAR_MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // what the browser may send
export const AVATAR_OUTPUT_SIZE = 512; // px, square, after server re-encoding
export const AVATAR_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Admin permissions on a college. Keep in sync with the CHECK constraint on
// public.admin_college_access.permissions.
export const ADMIN_PERMISSIONS = [
  { value: "view_students", label: "View students", description: "See the student list and summaries of this college." },
  { value: "manage_students", label: "Manage students", description: "Flag, suspend and restore student accounts of this college." },
  { value: "manage_events", label: "Manage events", description: "Create, edit, publish and close this college\u2019s events." },
  { value: "moderate_reports", label: "Moderate reports", description: "Review and decide reports about students of this college." },
];
export const ADMIN_PERMISSION_VALUES = ADMIN_PERMISSIONS.map((p) => p.value);

export const ROLES = Object.freeze({
  STUDENT: "student",
  ADMIN: "admin",
  SUPER_ADMIN: "super_admin",
});

// ---------------------------------------------------------------------------
// Events (Phase 2)
// ---------------------------------------------------------------------------
// Keep EVENT_TYPES in sync with the events_type_valid CHECK constraint.
export const EVENT_TYPES = [
  { value: "dandiya_night", label: "Dandiya Night" },
  { value: "freshers", label: "Freshers" },
  { value: "college_fest", label: "College Fest" },
  { value: "cultural", label: "Cultural" },
  { value: "technical", label: "Technical" },
  { value: "sports", label: "Sports" },
  { value: "other", label: "Other" },
];
export const EVENT_TYPE_VALUES = EVENT_TYPES.map((t) => t.value);

export const EVENT_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "closed", label: "Closed" },
  { value: "completed", label: "Completed" },
];
export const EVENT_STATUS_VALUES = EVENT_STATUSES.map((s) => s.value);

export const EVENT_TITLE_MIN = 3;
export const EVENT_TITLE_MAX = 140;
export const EVENT_DESCRIPTION_MIN = 20;
export const EVENT_DESCRIPTION_MAX = 4000;
export const EVENT_VENUE_MIN = 2;
export const EVENT_VENUE_MAX = 200;
export const EVENT_REQUIREMENTS_MAX = 2000;
export const EVENT_MAX_AGE_LIMIT = 99;
export const EVENT_COURSE_RULE_MIN = 2;
export const EVENT_COURSE_RULE_MAX = 60;
export const EVENT_COURSE_RULES_MAX = 20;
export const EVENT_SELECTED_COLLEGES_MAX = 100;
export const EVENT_MANAGE_PERMISSION = "manage_events";

// ---------------------------------------------------------------------------
// Partner finding (Phase 3)
// ---------------------------------------------------------------------------
// Keep in sync with the CHECK constraints on profile_private.gender,
// event_participants.looking_for and reports.reason.
export const GENDERS = [
  { value: "male", label: "Male", partnerLabel: "a male partner" },
  { value: "female", label: "Female", partnerLabel: "a female partner" },
];
export const GENDER_VALUES = GENDERS.map((g) => g.value);

export const REPORT_REASONS = [
  { value: "fake_profile", label: "Fake profile" },
  { value: "harassment", label: "Harassment or inappropriate behaviour" },
  { value: "misleading_information", label: "Misleading information" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Other" },
];
export const REPORT_REASON_VALUES = REPORT_REASONS.map((r) => r.value);
export const REPORT_DETAILS_MAX = 1000;
export const DISCOVERY_PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Chat (Phase 4)
// ---------------------------------------------------------------------------
// Keep MESSAGE_MAX in sync with the messages_body_length CHECK constraint and
// chat_send(); CHAT_REPORT_REASONS with report_chat_partner().
export const MESSAGE_MAX = 2000;
export const CHAT_PAGE_SIZE = 30;
// The database refuses more than this many messages per sender per minute.
export const MESSAGES_PER_MINUTE = 20;
export const CHAT_REPORT_EVIDENCE_COUNT = 20;

export const CHAT_REPORT_REASONS = [
  { value: "harassment", label: "Harassment or abusive messages" },
  { value: "threats", label: "Threats or intimidation" },
  { value: "spam", label: "Spam or scam" },
  { value: "fake_profile", label: "Fake or misleading profile" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "other", label: "Other" },
];
export const CHAT_REPORT_REASON_VALUES = CHAT_REPORT_REASONS.map((r) => r.value);

// ---------------------------------------------------------------------------
// Moderation and analytics (Phase 5)
// ---------------------------------------------------------------------------
// Stored status → what the screens call it. The stored values are unchanged since Phase 1.
export const REPORT_STATUSES = [
  { value: "open", label: "Pending", tone: "warning" },
  { value: "in_review", label: "Under review", tone: "brand" },
  { value: "resolved", label: "Resolved", tone: "ok" },
  { value: "dismissed", label: "Dismissed", tone: "neutral" },
];
export const REPORT_STATUS_VALUES = REPORT_STATUSES.map((s) => s.value);

// Every reason a stored report can carry (profile reports, chat reports and one legacy value).
export const ALL_REPORT_REASONS = [
  { value: "harassment", label: "Harassment or abuse" },
  { value: "threats", label: "Threats or intimidation" },
  { value: "spam", label: "Spam or scam" },
  { value: "fake_profile", label: "Fake profile" },
  { value: "misleading_information", label: "Misleading information" },
  { value: "inappropriate_content", label: "Inappropriate content" },
  { value: "safety_concern", label: "Safety concern" },
  { value: "other", label: "Other" },
];
export const ALL_REPORT_REASON_VALUES = ALL_REPORT_REASONS.map((r) => r.value);

export const DECISION_NOTE_MIN = 10;
export const DECISION_NOTE_MAX = 1000;
export const REPORT_NOTE_MAX = 2000;
export const MODERATION_REASON_MIN = 10;
export const MODERATION_REASON_MAX = 500;
export const ADMIN_PAGE_SIZE = 20;

export const MODERATION_ACTIONS = ["flag_review", "clear_review", "suspend", "restore"];
// "" = until an admin restores the account.
export const SUSPENSION_DURATIONS = [
  { value: "", label: "Until an admin restores it" },
  { value: "1", label: "1 day" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];
// ---------------------------------------------------------------------------
// Account lifecycle and feedback (Phase 6)
// ---------------------------------------------------------------------------
// Bump when the privacy notice or terms change in a way people must re-read.
export const LEGAL_VERSION = "2026-10-12";
export const DELETE_CONFIRM_WORD = "DELETE";
// Keep in sync with the feedback_category_valid CHECK constraint.
export const FEEDBACK_CATEGORIES = [
  { value: "bug", label: "Something is broken" },
  { value: "confusing", label: "Something is confusing" },
  { value: "idea", label: "An idea or request" },
  { value: "safety", label: "A safety or privacy concern" },
  { value: "other", label: "Something else" },
];
export const FEEDBACK_CATEGORY_VALUES = FEEDBACK_CATEGORIES.map((item) => item.value);
export const FEEDBACK_MIN = 10;
export const FEEDBACK_MAX = 1000;

export const ACCOUNT_STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "under_review", label: "Under review" },
];
