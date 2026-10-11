import "server-only";

// Reads for the admin screens. Each is one service that takes the caller from
// the session and returns only what that admin's role, colleges and
// permissions allow — see src/lib/services/{analytics,moderation,account}.js.
// Totals are computed by the service; no page counts rows.

import { APP_TIME_ZONE } from "@/lib/dates";
import { call } from "@/lib/services";
import { ADMIN_PAGE_SIZE } from "@/lib/validation/limits";

const orNull = (value) => (value === "" || value === undefined ? null : value);
const paged = (data) => ({ rows: data ?? [], total: Number(data?.[0]?.total ?? 0) });

export async function getOverviewStats({ college = null, from = null, to = null } = {}) {
  const { data, error } = await call("admin_overview_stats", { p_college: orNull(college), p_from: orNull(from), p_to: orNull(to), p_tz: APP_TIME_ZONE });
  return { error, stats: error ? null : data };
}

export async function getCollegeStats({ from = null, to = null } = {}) {
  const { data, error } = await call("admin_college_stats", { p_from: orNull(from), p_to: orNull(to), p_tz: APP_TIME_ZONE });
  return { error, rows: error ? [] : (data ?? []) };
}

export async function getEventStats({ college = null, status = null, search = null, event = null, page = 1, pageSize = ADMIN_PAGE_SIZE } = {}) {
  const { data, error } = await call("admin_event_stats", {
    p_college: orNull(college),
    p_status: orNull(status),
    p_search: orNull(search),
    p_event: orNull(event),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  return { error, ...paged(error ? [] : data) };
}

export async function listReports({ status, reason, college, event, from, to, search, assigned, page = 1, pageSize = ADMIN_PAGE_SIZE } = {}) {
  const { data, error } = await call("admin_list_reports", {
    p_status: orNull(status),
    p_reason: orNull(reason),
    p_college: orNull(college),
    p_event: orNull(event),
    p_from: orNull(from),
    p_to: orNull(to),
    p_search: orNull(search),
    p_assigned: orNull(assigned),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_tz: APP_TIME_ZONE,
  });
  return { error, ...paged(error ? [] : data) };
}

export async function listReportEvents() {
  const { data, error } = await call("admin_report_events");
  return error ? [] : (data ?? []);
}

/** One report with its context, or null if this admin may not see it (or it does not exist). */
export async function getReport(reportId) {
  const { data, error } = await call("admin_get_report", { p_report: reportId });
  if (error || !data) return null;
  return data;
}

export async function listUsers({ search, college, status, page = 1, pageSize = ADMIN_PAGE_SIZE } = {}) {
  const { data, error } = await call("admin_list_users", {
    p_search: orNull(search),
    p_college: orNull(college),
    p_status: orNull(status),
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  return { error, ...paged(error ? [] : data) };
}

export async function getUserSummary(userId) {
  const { data, error } = await call("admin_get_user", { p_user: userId });
  if (error || !data) return null;
  return data;
}

/**
 * A page of the audit log. The service decides which entries this admin may
 * read (Super Admin: all; college admin: their colleges, by permission).
 */
export async function listAudit({ category, college, from, to, page = 1, pageSize = ADMIN_PAGE_SIZE } = {}) {
  const { data, error } = await call("list_audit", { category: orNull(category), college: orNull(college), from: orNull(from), to: orNull(to), limit: pageSize, offset: (page - 1) * pageSize });
  return { error, rows: error ? [] : data.rows, total: error ? 0 : data.total };
}

// --- Super Admin inboxes ---------------------------------------------------------------

export async function getInboxCounts() {
  const { data, error } = await call("admin_inbox_counts");
  return error ? null : data;
}

export async function listDeletionRequests() {
  const { data, error } = await call("admin_list_deletion_requests");
  return { error, rows: error ? [] : (data ?? []) };
}

export async function listFeedback({ status, category, page = 1, pageSize = ADMIN_PAGE_SIZE } = {}) {
  const { data, error } = await call("admin_list_feedback", { p_status: orNull(status), p_category: orNull(category), p_limit: pageSize, p_offset: (page - 1) * pageSize });
  return { error, ...paged(error ? [] : data) };
}
