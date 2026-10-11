"use server";

// Report handling and account moderation. Every action here:
//   1. requires a signed-in admin (requireAdmin) — being shown a form proves nothing;
//   2. validates its input. Only ids of the thing acted ON are accepted; the
//      actor is never read from the request;
//   3. calls ONE database function AS THE CALLER. That function re-checks the
//      role, the college and the permission, applies the change and writes the
//      audit entry in the same transaction.
// Nothing is decided here, and no message text or note is logged.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { ROUTES, safeNextPath } from "@/lib/auth/routes";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";
import { formError, formSuccess } from "@/lib/form-state";
import { call } from "@/lib/services";
import { MODERATION_REASON_MIN } from "@/lib/validation/limits";
import { adminUserSchema, feedbackIdSchema, fieldErrors, moderateUserSchema, reportAssignSchema, reportIdSchema, reportNoteSchema, reportStatusSchema } from "@/lib/validation/schemas";

const text = (formData, name) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * After a change made from a dialog: go back to the page it was made on, with
 * a flag that makes the page show a confirmation. `returnTo` comes from the
 * form, so it is accepted only as a same-site path inside the admin area.
 */
function finish(formData, done, fallback) {
  const wanted = safeNextPath(text(formData, "returnTo"), fallback).split("?")[0];
  const path = wanted.startsWith(`${ROUTES.admin}/`) ? wanted : fallback;
  redirect(`${path}?done=${done}`);
}

function failure(scope, error, extra = {}) {
  logServerError(scope, error);
  return formError(describeDbError(error), extra);
}

export async function setReportStatusAction(_previous, formData) {
  await requireAdmin();
  const values = { status: text(formData, "status"), note: text(formData, "note") };
  const parsed = reportStatusSchema.safeParse({ reportId: text(formData, "reportId"), ...values });
  if (!parsed.success) return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });

  const { error } = await call("admin_set_report_status", {
    p_report: parsed.data.reportId,
    p_status: parsed.data.status,
    p_note: parsed.data.note,
  });
  if (error) {
    if (["decision_note_required", "decision_note_too_long"].includes(error.message)) {
      return formError("Check the highlighted fields.", { values, fieldErrors: { note: describeDbError(error) } });
    }
    return failure("admin.report.status", error, { values });
  }
  revalidatePath(ROUTES.admin, "layout");
  finish(formData, `report_${parsed.data.status}`, `${ROUTES.adminReports}/${parsed.data.reportId}`);
}

export async function assignReportAction(_previous, formData) {
  await requireAdmin();
  const parsed = reportAssignSchema.safeParse({ reportId: text(formData, "reportId"), assign: text(formData, "assign") });
  if (!parsed.success) return formError("That report could not be found.");

  const { error } = await call("admin_assign_report", { p_report: parsed.data.reportId, p_assign: parsed.data.assign });
  if (error) return failure("admin.report.assign", error);
  revalidatePath(ROUTES.adminReports, "layout");
  return formSuccess(parsed.data.assign ? "Assigned to you." : "Unassigned.");
}

export async function addReportNoteAction(_previous, formData) {
  await requireAdmin();
  const values = { body: text(formData, "body") };
  const parsed = reportNoteSchema.safeParse({ reportId: text(formData, "reportId"), ...values });
  if (!parsed.success) return formError("Check the note.", { fieldErrors: fieldErrors(parsed.error), values });

  const { error } = await call("admin_add_report_note", { p_report: parsed.data.reportId, p_body: parsed.data.body });
  if (error) return failure("admin.report.note", error, { values });
  revalidatePath(ROUTES.adminReports, "layout");
  return formSuccess("Note added.");
}

/**
 * Returns the chat messages a reporter chose to attach to a report. The
 * database records every call (who, which report, how many messages) before
 * returning them. The messages go back to this one form only.
 */
export async function viewReportEvidenceAction(_previous, formData) {
  await requireAdmin();
  const parsed = reportIdSchema.safeParse({ reportId: text(formData, "reportId") });
  if (!parsed.success) return formError("That report could not be found.");

  const { data, error } = await call("admin_view_report_evidence", { p_report: parsed.data.reportId });
  if (error) return failure("admin.report.evidence", error);

  const messages = (Array.isArray(data) ? data : []).map((item) => ({
    seq: Number(item.seq),
    from: item.from === "reporter" ? "reporter" : "reported",
    body: String(item.body ?? ""),
    sent: formatDateTime(item.sent_at),
  }));
  revalidatePath(ROUTES.adminReports, "layout"); // the report's history now shows this view
  return formSuccess("", { values: { messages } });
}

export async function moderateUserAction(_previous, formData) {
  await requireAdmin();
  const values = { action: text(formData, "action"), reason: text(formData, "reason"), days: text(formData, "days") };
  const parsed = moderateUserSchema.safeParse({ userId: text(formData, "userId"), reportId: text(formData, "reportId"), ...values });
  if (!parsed.success) return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });

  const { userId, action, reason, days, reportId } = parsed.data;
  if (["suspend", "flag_review"].includes(action) && (reason ?? "").length < MODERATION_REASON_MIN) {
    return formError("Check the highlighted fields.", {
      fieldErrors: { reason: `Write a reason (at least ${MODERATION_REASON_MIN} characters). It is kept in the activity log.` },
      values,
    });
  }

  const { error } = await call("admin_moderate_user", {
    p_user: userId,
    p_action: action,
    p_reason: reason,
    p_days: action === "suspend" ? days : null,
    p_report: reportId,
  });
  if (error) {
    if (["moderation_reason_required", "moderation_reason_too_long"].includes(error.message)) {
      return formError("Check the highlighted fields.", { values, fieldErrors: { reason: describeDbError(error) } });
    }
    return failure("admin.user.moderate", error, { values });
  }
  revalidatePath("/", "layout");
  finish(formData, action, `${ROUTES.adminUsers}/${userId}`);
}

// ---------------------------------------------------------------------------
// Super Admin: held account deletions and the feedback inbox (Phase 6)
// ---------------------------------------------------------------------------

/**
 * Carries out a deletion the student asked for and that was held for review.
 * The database function checks again that the caller is a Super Admin and that
 * a request from that student is actually pending — an admin cannot delete an
 * account nobody asked to have deleted.
 */
export async function completeAccountDeletionAction(_previous, formData) {
  await requireSuperAdmin();
  const parsed = adminUserSchema.safeParse({ userId: text(formData, "userId") });
  if (!parsed.success) return formError("That request could not be found.");
  const userId = parsed.data.userId;

  // A clear message when the request is no longer waiting; the service checks again.
  const { data: waiting, error: listError } = await call("admin_list_deletion_requests");
  if (listError) return failure("admin.deletion.list", listError);
  if (!(waiting ?? []).some((row) => row.user_id === userId && row.state === "pending")) {
    return formError("That request is no longer waiting. Reload the page.");
  }

  const { error } = await call("admin_complete_account_deletion", { p_user: userId });
  if (error) return failure("admin.deletion.complete", error);
  revalidatePath("/", "layout");
  redirect(`${ROUTES.adminDeletions}?done=account_deleted`);
}

export async function setFeedbackReviewedAction(_previous, formData) {
  await requireSuperAdmin();
  const parsed = feedbackIdSchema.safeParse({ feedbackId: text(formData, "feedbackId"), reviewed: text(formData, "reviewed") });
  if (!parsed.success) return formError("That feedback could not be found.");

  const { error } = await call("admin_set_feedback_reviewed", { p_feedback: parsed.data.feedbackId, p_reviewed: parsed.data.reviewed });
  if (error) return failure("admin.feedback.review", error);
  revalidatePath(ROUTES.admin, "layout");
  return formSuccess(parsed.data.reviewed ? "Marked as reviewed." : "Marked as new.");
}
