// Wording and small helpers shared by the admin screens. Nothing here decides
// access — it only describes what the database returned.

import { ALL_REPORT_REASONS, EVENT_STATUSES, REPORT_STATUSES, ROLES } from "@/lib/validation/limits";

export const reportReasonLabel = (value) => ALL_REPORT_REASONS.find((r) => r.value === value)?.label ?? "Other";
export const reportStatus = (value) => REPORT_STATUSES.find((s) => s.value === value) ?? { value, label: value, tone: "neutral" };

/** Which status changes a moderator can make from a given status (mirrors admin_set_report_status). */
export function reportTransitions(status) {
  switch (status) {
    case "open":
      return [
        { to: "in_review", label: "Start review", needsNote: false },
        { to: "resolved", label: "Resolve", needsNote: true },
        { to: "dismissed", label: "Dismiss", needsNote: true },
      ];
    case "in_review":
      return [
        { to: "resolved", label: "Resolve", needsNote: true },
        { to: "dismissed", label: "Dismiss", needsNote: true },
        { to: "open", label: "Move back to pending", needsNote: false },
      ];
    case "resolved":
    case "dismissed":
      return [{ to: "in_review", label: "Re-open", needsNote: true }];
    default:
      return [];
  }
}

/** Who did something, as returned by the database ("you" / "admin" / "super_admin" / "system"). */
export const actorLabel = (by) => ({ you: "You", admin: "Another admin", super_admin: "A Super Admin", system: "Automatic" })[by] ?? "An admin";

export function accountState(person) {
  if (person.status === "suspended") return { label: "Suspended", tone: "danger" };
  if (person.under_review) return { label: "Under review", tone: "warning" };
  return { label: "Active", tone: "ok" };
}

const MODERATION_LABELS = {
  "profiles.suspend": "Suspended",
  "profiles.restore": "Restored",
  "profiles.flag_review": "Marked as under review",
  "profiles.clear_review": "Review flag removed",
  "profiles.status_changed": "Status changed outside the app",
};
const REPORT_LABELS = {
  "reports.assigned": "Report assigned",
  "reports.unassigned": "Report unassigned",
  "reports.note_added": "Internal note added",
  "reports.evidence_viewed": "Shared messages viewed",
};
const ACCOUNT_LABELS = {
  "accounts.deletion_requested": "Account deletion requested by the student",
  "accounts.deletion_cancelled": "Account deletion request cancelled by the student",
};
const OTHER_LABELS = {
  "colleges.insert": "College added",
  "colleges.update": "College edited",
  "admin_college_access.insert": "College assigned to an admin",
  "admin_college_access.update": "Admin permissions changed",
  "admin_college_access.delete": "College access revoked",
};

/** One line for an audit entry (a row of audit_logs, or the trimmed form the admin functions return). */
export function describeAudit(entry) {
  const { action } = entry;
  const meta = entry.metadata ?? entry;
  if (action === "reports.status_changed") {
    return `Report moved from ${reportStatus(meta.from).label} to ${reportStatus(meta.to).label}`;
  }
  if (action === "profiles.restore" && (meta.automatic === true || meta.automatic === "true")) return "Suspension ended";
  if (action === "accounts.deleted") return meta.by === "admin" ? "Account deleted by a Super Admin, at the student’s request" : "Account deleted by its owner";
  if (ACCOUNT_LABELS[action]) return ACCOUNT_LABELS[action];
  if (MODERATION_LABELS[action]) return MODERATION_LABELS[action];
  if (REPORT_LABELS[action]) return REPORT_LABELS[action];
  if (entry.target_table === "user_roles") {
    const to = meta.new?.role;
    const from = meta.old?.role;
    if (to === ROLES.ADMIN) return "Admin role granted";
    if (to === ROLES.SUPER_ADMIN) return "Super Admin created";
    if (from === ROLES.SUPER_ADMIN) return "Super Admin removed";
    if (from === ROLES.ADMIN) return "Admin role removed";
    return "Role changed";
  }
  if (entry.target_table === "events") {
    if (action === "events.insert") return "Event created";
    return { published: "Event published", closed: "Event closed", completed: "Event completed" }[meta.new?.status] ?? "Event status changed";
  }
  return OTHER_LABELS[action] ?? "Change recorded";
}

/** What an audit entry is about, without anything private: an event title or a short reference. */
export function auditSubject(entry) {
  const meta = entry.metadata ?? {};
  if (entry.target_table === "events") return meta.new?.title ?? null;
  return meta.ref ?? null;
}

export const AUDIT_CATEGORIES = [
  { value: "reports", label: "Reports" },
  { value: "profiles", label: "Student accounts" },
  { value: "events", label: "Events" },
  { value: "colleges", label: "Colleges", superOnly: true },
  { value: "user_roles", label: "Admin roles", superOnly: true },
  { value: "admin_college_access", label: "College access", superOnly: true },
];

export const eventStatusOptions = EVENT_STATUSES;

// --- lists: paging and filters from the URL ---------------------------------------

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A "YYYY-MM-DD" filter value, or "" if it is not a real date. */
export function pickDate(value) {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? "" : value;
}

export function pickPage(value) {
  const page = Number.parseInt(typeof value === "string" ? value : "1", 10);
  return Number.isFinite(page) && page > 0 ? Math.min(page, 100000) : 1;
}

/** `base?…` with the given parameters, leaving out empty ones (and page 1). */
export function hrefWith(base, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === "" || value === null || value === undefined) continue;
    if (key === "page" && Number(value) <= 1) continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** "YYYY-MM-DD" for `days` ago in the given time zone (inclusive ranges: 7 days = today and the six before). */
export function daysAgoIso(days, timeZone, now = new Date()) {
  const date = new Date(now.getTime() - days * 86400000);
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

const numberFormat = new Intl.NumberFormat("en-IN");
/** Counts arrive as numbers or (bigint) strings; null means "not within your permissions". */
export function formatCount(value) {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? numberFormat.format(number) : "—";
}

/** Confirmation shown on a page after an action redirected back to it (?done=…). */
export const DONE_MESSAGES = {
  suspend: "Account suspended. It is recorded in the activity log.",
  restore: "Account restored.",
  flag_review: "Account marked as under review.",
  clear_review: "Review flag removed.",
  report_in_review: "Report is now under review and assigned to you if nobody had it.",
  report_open: "Report moved back to pending.",
  report_resolved: "Report resolved.",
  report_dismissed: "Report dismissed.",
  account_deleted: "The account has been deleted. It is recorded in the activity log.",
};
