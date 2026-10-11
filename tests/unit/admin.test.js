// Phase 5 — the pure parts of the admin area: wording, filters from the URL,
// and the input rules for moderation actions.
import { describe, expect, test } from "vitest";
import { accountState, actorLabel, daysAgoIso, describeAudit, formatCount, hrefWith, pickDate, pickPage, reportReasonLabel, reportStatus, reportTransitions } from "@/lib/admin";
import { describeDbError } from "@/lib/auth/errors";
import { isAdminPath, isProtectedPath, ROUTES, safeNextPath } from "@/lib/auth/routes";
import { ALL_REPORT_REASON_VALUES, CHAT_REPORT_REASON_VALUES, REPORT_REASON_VALUES, REPORT_STATUS_VALUES } from "@/lib/validation/limits";
import { moderateUserSchema, reportAssignSchema, reportNoteSchema, reportStatusSchema } from "@/lib/validation/schemas";

const ID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";

describe("report wording", () => {
  test("stored statuses map onto the names the screens use", () => {
    expect(REPORT_STATUS_VALUES).toEqual(["open", "in_review", "resolved", "dismissed"]);
    expect(REPORT_STATUS_VALUES.map((value) => reportStatus(value).label)).toEqual(["Pending", "Under review", "Resolved", "Dismissed"]);
    expect(reportStatus("something_new")).toMatchObject({ label: "something_new", tone: "neutral" });
  });

  test("every reason a student can choose has a label for moderators", () => {
    for (const value of [...REPORT_REASON_VALUES, ...CHAT_REPORT_REASON_VALUES]) {
      expect(ALL_REPORT_REASON_VALUES, value).toContain(value);
      expect(reportReasonLabel(value)).not.toBe("");
    }
    expect(reportReasonLabel("unknown")).toBe("Other");
  });

  test("transitions offered match the database's rules, and decisions need a reason", () => {
    const moves = (status) => reportTransitions(status).map((t) => `${t.to}${t.needsNote ? "*" : ""}`);
    expect(moves("open")).toEqual(["in_review", "resolved*", "dismissed*"]);
    expect(moves("in_review")).toEqual(["resolved*", "dismissed*", "open"]);
    expect(moves("resolved")).toEqual(["in_review*"]);
    expect(moves("dismissed")).toEqual(["in_review*"]);
    expect(moves("nonsense")).toEqual([]);
  });
});

describe("activity wording", () => {
  test("audit entries read as plain sentences", () => {
    expect(describeAudit({ action: "reports.status_changed", metadata: { from: "open", to: "in_review" } })).toBe("Report moved from Pending to Under review");
    expect(describeAudit({ action: "reports.status_changed", from: "in_review", to: "dismissed" })).toBe("Report moved from Under review to Dismissed");
    expect(describeAudit({ action: "reports.evidence_viewed", metadata: {} })).toBe("Shared messages viewed");
    expect(describeAudit({ action: "profiles.suspend", metadata: {} })).toBe("Suspended");
    expect(describeAudit({ action: "profiles.restore", metadata: {} })).toBe("Restored");
    expect(describeAudit({ action: "profiles.restore", metadata: { automatic: true } })).toBe("Suspension ended");
    expect(describeAudit({ action: "profiles.restore", automatic: true })).toBe("Suspension ended");
    expect(describeAudit({ action: "user_roles.update", target_table: "user_roles", metadata: { old: { role: "student" }, new: { role: "admin" } } })).toBe("Admin role granted");
    expect(describeAudit({ action: "events.update", target_table: "events", metadata: { new: { status: "published" } } })).toBe("Event published");
    expect(describeAudit({ action: "something.else", metadata: {} })).toBe("Change recorded");
  });

  test("other admins are described, never named", () => {
    expect(["you", "admin", "super_admin", "system", "?"].map(actorLabel)).toEqual(["You", "Another admin", "A Super Admin", "Automatic", "An admin"]);
  });

  test("account standing: suspension outranks the review flag", () => {
    expect(accountState({ status: "active", under_review: false }).label).toBe("Active");
    expect(accountState({ status: "active", under_review: true }).label).toBe("Under review");
    expect(accountState({ status: "suspended", under_review: true }).label).toBe("Suspended");
  });
});

describe("filters from the URL", () => {
  test("pickDate accepts real calendar days only", () => {
    expect(pickDate("2026-10-11")).toBe("2026-10-11");
    for (const bad of ["2026-02-30", "2026-13-01", "11-10-2026", "2026-10-11T00:00", "", null, undefined, ["2026-10-11"], "<script>"]) expect(pickDate(bad)).toBe("");
  });

  test("pickPage is a positive whole number, bounded", () => {
    expect(pickPage("3")).toBe(3);
    for (const bad of ["0", "-2", "abc", "", undefined, ["2"]]) expect(pickPage(bad)).toBe(1);
    expect(pickPage("999999999")).toBe(100000);
  });

  test("hrefWith drops empty values and page 1, and encodes the rest", () => {
    expect(hrefWith("/admin/reports", { status: "", q: null, page: 1 })).toBe("/admin/reports");
    expect(hrefWith("/admin/reports", { status: "open", q: "a&b=c", page: 2 })).toBe("/admin/reports?status=open&q=a%26b%3Dc&page=2");
  });

  test("daysAgoIso counts calendar days in the app's zone", () => {
    const now = new Date("2026-10-10T20:00:00Z"); // 11 Oct, 01:30 in India
    expect(daysAgoIso(0, "Asia/Kolkata", now)).toBe("2026-10-11");
    expect(daysAgoIso(0, "UTC", now)).toBe("2026-10-10");
    expect(daysAgoIso(6, "Asia/Kolkata", now)).toBe("2026-10-05");
    expect(daysAgoIso(0, "Not/AZone", now)).toBe("2026-10-10");
  });

  test("formatCount shows a dash for numbers outside the admin's permissions", () => {
    expect(formatCount(null)).toBe("—");
    expect(formatCount(undefined)).toBe("—");
    expect(formatCount("1234567")).toBe("12,34,567");
    expect(formatCount(0)).toBe("0");
    expect(formatCount("abc")).toBe("—");
  });
});

describe("moderation input", () => {
  test("report status: known statuses only; the note is optional here (the database decides when it is required)", () => {
    const parse = (extra) => reportStatusSchema.safeParse({ reportId: ID, status: "resolved", note: "", ...extra });
    expect(parse({}).data).toEqual({ reportId: ID, status: "resolved", note: null });
    expect(parse({ note: "  Decided.  " }).data.note).toBe("Decided.");
    expect(parse({ status: "pending" }).success).toBe(false);
    expect(parse({ status: "deleted" }).success).toBe(false);
    expect(parse({ reportId: "1" }).success).toBe(false);
    expect(parse({ note: "x".repeat(1001) }).success).toBe(false);
    // Nothing identifying the moderator is accepted.
    expect(Object.keys(parse({ actorId: ID, resolved_by: ID }).data).sort()).toEqual(["note", "reportId", "status"]);
  });

  test("assignment is 'me or nobody' — there is no field for another person", () => {
    expect(reportAssignSchema.safeParse({ reportId: ID, assign: "true" }).data).toEqual({ reportId: ID, assign: true });
    expect(reportAssignSchema.safeParse({ reportId: ID, assign: "false", assignedTo: ID }).data).toEqual({ reportId: ID, assign: false });
    expect(reportAssignSchema.safeParse({ reportId: ID, assign: ID }).success).toBe(false);
  });

  test("notes: not empty, not over 2000 characters", () => {
    expect(reportNoteSchema.safeParse({ reportId: ID, body: "  A note.  " }).data.body).toBe("A note.");
    expect(reportNoteSchema.safeParse({ reportId: ID, body: "   " }).success).toBe(false);
    expect(reportNoteSchema.safeParse({ reportId: ID, body: "x".repeat(2001) }).success).toBe(false);
  });

  test("account actions: four known actions, a bounded duration, an optional report", () => {
    const parse = (extra) => moderateUserSchema.safeParse({ userId: ID, action: "suspend", reason: "A reason that is long enough.", days: "", reportId: "", ...extra });
    expect(parse({}).data).toEqual({ userId: ID, action: "suspend", reason: "A reason that is long enough.", days: null, reportId: null });
    expect(parse({ days: "7", reportId: ID }).data).toMatchObject({ days: 7, reportId: ID });
    for (const action of ["flag_review", "clear_review", "restore"]) expect(parse({ action }).success).toBe(true);
    for (const action of ["delete", "ban", "promote", ""]) expect(parse({ action }).success, action).toBe(false);
    for (const days of ["0", "-3", "366", "1.5", "week"]) expect(parse({ days }).success, days).toBe(false);
    expect(parse({ reason: "x".repeat(501) }).success).toBe(false);
    expect(parse({ userId: "me" }).success).toBe(false);
    expect(parse({ reportId: "not-an-id" }).success).toBe(false);
  });
});

describe("routes and errors", () => {
  test("the new admin pages are admin paths behind the sign-in gate; the health check is public", () => {
    for (const path of [ROUTES.adminReports, `${ROUTES.adminReports}/${ID}`, ROUTES.adminUsers, ROUTES.adminAnalytics, ROUTES.adminActivity]) {
      expect(isProtectedPath(path), path).toBe(true);
      expect(isAdminPath(path), path).toBe(true);
    }
    expect(isProtectedPath("/api/health")).toBe(false);
  });

  test("a return path from a form cannot leave the site", () => {
    const fallback = `${ROUTES.adminReports}/${ID}`;
    expect(safeNextPath(`${ROUTES.adminUsers}/${ID}`, fallback)).toBe(`${ROUTES.adminUsers}/${ID}`);
    for (const bad of ["https://evil.example/admin/", "//evil.example", "/\\evil", "javascript:alert(1)", ""]) expect(safeNextPath(bad, fallback)).toBe(fallback);
  });

  test("moderation refusals have their own wording, and the Phase 1 message for an unknown email is unchanged", () => {
    expect(describeDbError({ code: "P0001", message: "user_not_found" })).toContain("No verified account uses that email address");
    expect(describeDbError({ code: "P0001", message: "student_not_found" })).toBe("That student could not be found.");
    for (const code of ["account_suspended", "report_not_found", "invalid_report_transition", "decision_note_required", "cannot_moderate_self", "cannot_moderate_staff", "moderation_reason_required", "already_suspended", "not_suspended"]) {
      expect(describeDbError({ code: "P0001", message: code }), code).not.toContain("Something went wrong");
    }
    // What a suspended student is told never includes a reason.
    expect(describeDbError({ code: "P0001", message: "account_suspended" })).not.toMatch(/because|reason|report/i);
  });
});
