// Turns the codes raised by the auth and data services into messages that are safe and useful
// to show. Raw error text is never passed through to the page: it can contain
// internals, and for auth it can reveal whether an account exists.

import { GENERIC_ERROR } from "@/lib/form-state";
import { MIN_AGE } from "@/lib/validation/limits";

const AUTH_MESSAGES = {
  invalid_credentials: "That email and password do not match an account. Check both and try again.",
  over_request_rate_limit: "Too many attempts. Wait a few minutes, then try again.",
  over_email_send_rate_limit: "We have sent several emails already. Wait a few minutes before asking for another.",
  weak_password: "That password is too easy to guess. Use a longer one with letters and numbers.",
  same_password: "That is your current password. Choose a different one.",
  session_not_found: "Your session has ended. Ask for a new link.",
  signup_disabled: "Registration is closed at the moment.",
  email_address_invalid: "That email address cannot be used. Try a different one.",
  email_address_not_authorized: "That email address cannot be used. Try a different one.",
  user_already_exists: "An account could not be created with those details. If you have registered before, log in instead.",
  email_exists: "An account could not be created with those details. If you have registered before, log in instead.",
  user_banned: "This account has been suspended. Contact your college admin.",
  captcha_failed: "The security check failed. Reload the page and try again.",
};

export function describeAuthError(error) {
  if (!error) return GENERIC_ERROR;
  if (error.status === 429) return AUTH_MESSAGES.over_request_rate_limit;
  return AUTH_MESSAGES[error.code] ?? GENERIC_ERROR;
}

// Codes raised on purpose by the services in src/lib/services.
const DB_MESSAGES = {
  not_authenticated: "Your session has ended. Log in again.",
  not_authorized: "You do not have permission to do that.",
  email_not_verified: "Confirm your email address before creating a profile.",
  profile_exists: "You already have a profile.",
  invalid_college: "That college is not available. Choose another one.",
  invalid_date_of_birth: "Check your date of birth — that date does not look right.",
  under_age: `You must be ${MIN_AGE} or older to use Campus Partner Finder.`,
  user_not_found: "No verified account uses that email address. Ask the person to register and confirm their email first.",
  cannot_change_own_role: "You cannot change your own role.",
  cannot_modify_super_admin: "That account is a Super Admin. Super Admins are managed from the database, not from this screen.",
  already_admin: "That person is already an admin.",
  target_not_admin: "That person is not an admin.",
  access_keys_immutable: "An assignment cannot be moved. Revoke it and create a new one.",
  // events
  invalid_eligibility_rules: "The eligibility settings are not valid. Check the colleges, courses and years.",
  unknown_college_in_rules: "One of the selected colleges no longer exists. Reload the page and choose again.",
  invalid_status_transition: "That status change is not allowed from the event's current status. Reload the page.",
  event_completed_locked: "This event is completed and can no longer be changed.",
  event_already_ended: "This event's end time has already passed, so it cannot be opened to students. Edit the dates first.",
  event_incomplete: "Add a description and a venue before publishing.",
  event_college_immutable: "The host college of an event cannot be changed.",
  event_slug_immutable: "The event's address cannot be changed.",
  event_not_found: "That event could not be found.",
  // partner finding
  participation_blocked: "You cannot take part in this event right now.",
  not_joined: "Join this event first.",
  profile_closed: "Your profile is closed for this event. Re-open it to continue.",
  partner_not_available: "That person is no longer available for this event.",
  self_interest: "You cannot send interest to yourself.",
  interest_limit_reached: "You have sent a lot of interest today. Try again tomorrow.",
  gender_required: "Tell us whether you are male or female so we can match preferences.",
  gender_locked: "Your gender is already saved and cannot be changed here. Contact your college admin if it is wrong.",
  invalid_preference: "Choose who you are looking for.",
  invalid_request: "That request was not understood. Reload the page and try again.",
  block_not_found: "That block was already removed.",
  invalid_report_reason: "Choose a reason for the report.",
  report_details_too_long: "Keep the description under 1000 characters.",
  // chat
  conversation_not_found: "That conversation could not be found.",
  messaging_unavailable: "Messaging is unavailable in this conversation.",
  message_empty: "Write a message first.",
  message_too_long: "That message is too long. Keep it under 2000 characters.",
  message_rate_limited: "You are sending messages very quickly. Wait a moment, then try again.",
  // moderation
  account_suspended: "Your account is suspended, so this is not available. Contact your college admin.",
  report_not_found: "That report could not be found.",
  invalid_report_transition: "That status change is not possible from the report's current status. Reload the page.",
  decision_note_required: "Write a short reason for this decision (at least 10 characters).",
  decision_note_too_long: "Keep the reason under 1000 characters.",
  note_empty: "Write the note first.",
  note_too_long: "Keep the note under 2000 characters.",
  student_not_found: "That student could not be found.",
  cannot_moderate_self: "You cannot take moderation actions on your own account.",
  cannot_moderate_staff: "That account belongs to an admin. Only a Super Admin can act on it, and Super Admin accounts cannot be suspended here.",
  moderation_reason_required: "Write a reason (at least 10 characters). It is kept in the activity log.",
  moderation_reason_too_long: "Keep the reason under 500 characters.",
  already_suspended: "That account is already suspended. Reload the page.",
  not_suspended: "That account is not suspended. Reload the page.",
  already_under_review: "That account is already marked as under review.",
  not_under_review: "That account is not marked as under review.",
  invalid_date_range: "The start date is after the end date.",
  // account lifecycle and feedback
  account_deleted: "This account has been deleted.",
  staff_cannot_self_delete: "Your account holds an admin role. Ask a Super Admin to remove it before deleting the account.",
  no_deletion_request: "There is no deletion request waiting. Reload the page.",
  invalid_feedback_category: "Choose what the feedback is about.",
  feedback_too_short: "Describe it in at least 10 characters.",
  feedback_too_long: "Keep each box under 1000 characters.",
  feedback_limit_reached: "You have sent several messages today. Thank you — please send more tomorrow.",
  feedback_not_found: "That feedback could not be found.",
  report_limit_reached: "You have filed several reports today. If someone is in danger, contact your college directly.",
};

const DB_CODES = {
  42501: "You do not have permission to do that.",
  23505: "That already exists.",
  23514: "Some of those details are not allowed. Check the form and try again.",
  23503: "That refers to something that no longer exists. Reload the page and try again.",
};

/** `overrides` lets a caller give a specific message for a code, e.g. { 23505: "That short name is taken." }. */
export function describeDbError(error, overrides = {}) {
  if (!error) return GENERIC_ERROR;
  return overrides[error.code] ?? DB_MESSAGES[error.message] ?? DB_CODES[error.code] ?? GENERIC_ERROR;
}

/** Logs what the user is not shown. Codes only — never tokens, emails or row data. */
export function logServerError(scope, error) {
  console.error(`[${scope}]`, error?.code ?? error?.name ?? "error", error?.status ?? "");
}
