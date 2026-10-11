import "server-only";

// The one door between the pages / Server Actions and the data.
//
//   const { data, error } = await call("send_interest", { p_event_id, p_handle });
//
// `call` takes the caller from the verified session — there is no way to pass
// a user id, a role or a college in from a request — runs the service, and
// returns either its result or an error whose `message` is a stable code
// (see src/lib/auth/errors.js for the sentences shown to people).

import { getCallerContext } from "@/lib/auth/session";
import { connectDb } from "@/lib/db/connection";
import * as account from "./account";
import * as admins from "./admins";
import * as analytics from "./analytics";
import * as chat from "./chat";
import { ServiceError } from "./core";
import * as events from "./events";
import * as moderation from "./moderation";
import * as partners from "./partners";
import * as profiles from "./profiles";

/** Everything callable through `call`. Helpers that are not listed here cannot be reached from a request. */
export const SERVICES = Object.freeze({
  // profiles
  my_profile: profiles.my_profile,
  my_private_profile: profiles.my_private_profile,
  create_my_profile: profiles.create_my_profile,
  update_my_profile: profiles.update_my_profile,
  set_my_photo: profiles.set_my_photo,
  remove_my_photo: profiles.remove_my_photo,
  my_photo: profiles.my_photo,
  list_active_colleges: profiles.list_active_colleges,
  college_names: profiles.college_names,
  my_account_status: profiles.my_account_status,
  // colleges, admins
  my_admin_scope: admins.my_admin_scope,
  admin_list_colleges: admins.admin_list_colleges,
  admin_get_college: admins.admin_get_college,
  admin_create_college: admins.admin_create_college,
  admin_update_college: admins.admin_update_college,
  admin_list_admins: admins.admin_list_admins,
  admin_grant_admin_role: admins.admin_grant_admin_role,
  admin_revoke_admin_role: admins.admin_revoke_admin_role,
  admin_list_access: admins.admin_list_access,
  admin_assign_college: admins.admin_assign_college,
  admin_revoke_college_access: admins.admin_revoke_college_access,
  // events
  list_student_events: events.list_student_events,
  get_student_event: events.get_student_event,
  event_participation_check: events.event_participation_check,
  manageable_colleges: events.manageable_colleges,
  admin_list_events: events.admin_list_events,
  admin_get_event: events.admin_get_event,
  admin_create_event: events.admin_create_event,
  admin_update_event: events.admin_update_event,
  admin_change_event_status: events.admin_change_event_status,
  // partner finding
  join_event: partners.join_event,
  set_event_profile_open: partners.set_event_profile_open,
  my_event_participation: partners.my_event_participation,
  discover_event_partners: partners.discover_event_partners,
  send_interest: partners.send_interest,
  list_received_interests: partners.list_received_interests,
  my_received_interest_counts: partners.my_received_interest_counts,
  my_partner_summary: partners.my_partner_summary,
  my_unread_match_count: partners.my_unread_match_count,
  mark_my_matches_seen: partners.mark_my_matches_seen,
  partner_photo: partners.partner_photo,
  block_partner: partners.block_partner,
  list_my_blocks: partners.list_my_blocks,
  unblock_partner: partners.unblock_partner,
  report_partner: partners.report_partner,
  // chat
  list_my_conversations: chat.list_my_conversations,
  chat_open: chat.chat_open,
  chat_messages: chat.chat_messages,
  chat_latest_seq: chat.chat_latest_seq,
  chat_send: chat.chat_send,
  block_chat_partner: chat.block_chat_partner,
  report_chat_partner: chat.report_chat_partner,
  // moderation, analytics
  admin_list_reports: moderation.admin_list_reports,
  admin_report_events: moderation.admin_report_events,
  admin_get_report: moderation.admin_get_report,
  admin_view_report_evidence: moderation.admin_view_report_evidence,
  admin_set_report_status: moderation.admin_set_report_status,
  admin_assign_report: moderation.admin_assign_report,
  admin_add_report_note: moderation.admin_add_report_note,
  admin_list_users: moderation.admin_list_users,
  admin_get_user: moderation.admin_get_user,
  admin_moderate_user: moderation.admin_moderate_user,
  list_audit: moderation.list_audit,
  admin_overview_stats: analytics.admin_overview_stats,
  admin_college_stats: analytics.admin_college_stats,
  admin_event_stats: analytics.admin_event_stats,
  // account lifecycle, feedback
  delete_my_account: account.delete_my_account,
  cancel_my_account_deletion: account.cancel_my_account_deletion,
  my_deletion_request: account.my_deletion_request,
  admin_list_deletion_requests: account.admin_list_deletion_requests,
  admin_complete_account_deletion: account.admin_complete_account_deletion,
  submit_feedback: account.submit_feedback,
  admin_list_feedback: account.admin_list_feedback,
  admin_set_feedback_reviewed: account.admin_set_feedback_reviewed,
  admin_inbox_counts: account.admin_inbox_counts,
});

/** Runs a service with an explicit context. Used by `call` and by the tests. */
export async function run(ctx, name, args = {}) {
  const service = Object.hasOwn(SERVICES, name) ? SERVICES[name] : null;
  if (!service) throw new Error(`unknown service: ${name}`);
  try {
    await connectDb();
    return { data: await service(ctx, args ?? {}), error: null };
  } catch (error) {
    if (error instanceof ServiceError) return { data: null, error: { message: error.message, code: error.code, details: error.details } };
    // Anything else is a fault, not a refusal: one generic code, details in the server log only.
    console.error(`[service.${name}]`, error?.code ?? error?.name ?? "error");
    // Full detail only when a developer asks for it, never in production: messages can quote stored values.
    if (process.env.SERVICE_DEBUG === "1" && process.env.NODE_ENV !== "production") console.error(error);
    return { data: null, error: { message: "internal_error", code: "XX000", details: null } };
  }
}

/** Runs a service as whoever is signed in on this request. */
export async function call(name, args = {}) {
  return run(await getCallerContext(), name, args);
}
