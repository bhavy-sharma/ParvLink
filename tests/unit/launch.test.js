// Phase 6 — the pure parts of password reset, consent, account deletion,
// feedback and the operator details shown on the legal pages.
import { describe, expect, test } from "vitest";
import { describeAudit } from "@/lib/admin";
import { describeAuthError, describeDbError } from "@/lib/auth/errors";
import { isGuestOnlyPath, isProtectedPath, ROUTES, safeNextPath } from "@/lib/auth/routes";
import { siteDetails } from "@/lib/site";
import { DELETE_CONFIRM_WORD, FEEDBACK_CATEGORY_VALUES, FEEDBACK_MAX, LEGAL_VERSION } from "@/lib/validation/limits";
import { deleteAccountSchema, feedbackIdSchema, feedbackSchema, registerSchema, resetPasswordSchema } from "@/lib/validation/schemas";

const ID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
const GOOD_PASSWORD = "correct-horse-battery-9";

describe("operator details on the legal pages", () => {
  test("nothing is invented: unset values become clearly marked placeholders", () => {
    const details = siteDetails({});
    expect(details).toMatchObject({ operatorName: null, supportEmail: null, legalReviewed: false, complete: false });
    expect(details.operatorLabel).toMatch(/^\[.*NOT YET CONFIGURED\]$/);
    expect(details.supportLabel).toMatch(/^\[.*NOT YET CONFIGURED\]$/);
  });

  test("the pages count as complete only with a name, a real address and the review flag", () => {
    const full = { name: "  Example Students Trust ", email: "help@example.org", reviewed: "true" };
    expect(siteDetails(full)).toMatchObject({ operatorName: "Example Students Trust", supportEmail: "help@example.org", complete: true });
    expect(siteDetails({ ...full, reviewed: "yes" }).complete).toBe(false);
    expect(siteDetails({ ...full, reviewed: undefined }).complete).toBe(false);
    expect(siteDetails({ ...full, name: " " }).complete).toBe(false);
  });

  test.each(["not-an-email", "a@b", "<script>@x.io", "two words@x.io", 42, null])("a malformed support address %j is not shown as a link", (email) => {
    const details = siteDetails({ name: "Operator", email, reviewed: "true" });
    expect(details.supportEmail).toBeNull();
    expect(details.complete).toBe(false);
  });

  test("the legal version is a real date", () => {
    expect(LEGAL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(new Date(LEGAL_VERSION).getTime())).toBe(false);
  });
});

describe("sign-up consent", () => {
  const base = { email: "asha@example.org", password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD };
  test("an account cannot be created without agreeing to the terms and privacy notice", () => {
    for (const agree of [undefined, null, "", "off", "true", true]) {
      const result = registerSchema.safeParse({ ...base, agree });
      expect(result.success, String(agree)).toBe(false);
    }
    expect(registerSchema.safeParse({ ...base, agree: "on" }).success).toBe(true);
  });

  test("a missing tick is reported together with the other problems, not instead of them", () => {
    const result = registerSchema.safeParse({ email: "not-an-email", password: "short", confirmPassword: "different" });
    const fields = new Set(result.error.issues.map((issue) => issue.path[0]));
    expect([...fields].sort()).toEqual(["agree", "confirmPassword", "email", "password"]);
  });
});

describe("new password", () => {
  test("the same strength rules as registration, and both fields must match", () => {
    expect(resetPasswordSchema.safeParse({ password: GOOD_PASSWORD, confirmPassword: GOOD_PASSWORD }).success).toBe(true);
    expect(resetPasswordSchema.safeParse({ password: GOOD_PASSWORD, confirmPassword: `${GOOD_PASSWORD}x` }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "short1", confirmPassword: "short1" }).success).toBe(false);
    expect(resetPasswordSchema.safeParse({ password: "onlyletterslong", confirmPassword: "onlyletterslong" }).success).toBe(false);
  });

  test("the reset pages are gated like the rest: ask while signed out, change only while signed in", () => {
    expect(isGuestOnlyPath(ROUTES.forgotPassword)).toBe(true);
    expect(isProtectedPath(ROUTES.resetPassword)).toBe(true);
    // A crafted confirmation link cannot bounce through the guest-only pages.
    expect(safeNextPath(ROUTES.forgotPassword, "/fallback")).toBe("/fallback");
    expect(safeNextPath(ROUTES.resetPassword, "/fallback")).toBe(ROUTES.resetPassword);
  });
});

describe("account deletion", () => {
  test("needs the password and the exact confirmation word", () => {
    expect(deleteAccountSchema.safeParse({ password: "anything", confirm: DELETE_CONFIRM_WORD }).success).toBe(true);
    for (const confirm of ["delete", "Delete", "DELETE ", "", "YES", undefined]) {
      expect(deleteAccountSchema.safeParse({ password: "anything", confirm }).success, String(confirm)).toBe(false);
    }
    expect(deleteAccountSchema.safeParse({ password: "", confirm: DELETE_CONFIRM_WORD }).success).toBe(false);
  });

  test("the form has no field for WHOSE account: extra keys are dropped", () => {
    const parsed = deleteAccountSchema.parse({ password: "x", confirm: DELETE_CONFIRM_WORD, userId: ID, user_id: ID });
    expect(Object.keys(parsed).sort()).toEqual(["confirm", "password"]);
  });

  test("account pages need a session; the public ones do not", () => {
    for (const path of [ROUTES.deleteAccount, ROUTES.feedback, ROUTES.account, ROUTES.adminDeletions, ROUTES.adminFeedback]) expect(isProtectedPath(path), path).toBe(true);
    for (const path of [ROUTES.privacy, ROUTES.terms, ROUTES.goodbye, ROUTES.home]) expect(isProtectedPath(path), path).toBe(false);
  });

  test("database refusals have a human sentence, and the audit log names what happened", () => {
    for (const code of ["account_deleted", "staff_cannot_self_delete", "no_deletion_request", "feedback_limit_reached", "feedback_too_short", "feedback_too_long", "invalid_feedback_category", "feedback_not_found"]) {
      const message = describeDbError({ message: code, code: "P0001" });
      expect(message, code).not.toContain(code);
      expect(message.length, code).toBeGreaterThan(15);
    }
    expect(describeAuthError({ code: "same_password" })).toMatch(/different|same/i);
    expect(describeAudit({ action: "accounts.deleted", target_table: "profiles", metadata: { by: "self" } })).toBe("Account deleted by its owner");
    expect(describeAudit({ action: "accounts.deleted", target_table: "profiles", metadata: { by: "admin" } })).toMatch(/Super Admin/);
    expect(describeAudit({ action: "accounts.deletion_requested", target_table: "profiles", metadata: {} })).toMatch(/requested/);
    expect(describeAudit({ action: "accounts.deletion_cancelled", target_table: "profiles", metadata: {} })).toMatch(/cancelled/);
  });
});

describe("feedback", () => {
  const ok = { category: "bug", description: "The join button does nothing on my phone.", steps: "" };

  test("a category, a description, and optional steps", () => {
    expect(feedbackSchema.parse(ok)).toEqual({ category: "bug", description: ok.description, steps: null });
    expect(feedbackSchema.parse({ ...ok, steps: "  1. Open events\r\n2. Press join  " }).steps).toBe("1. Open events\n2. Press join");
    for (const category of FEEDBACK_CATEGORY_VALUES) expect(feedbackSchema.safeParse({ ...ok, category }).success).toBe(true);
  });

  test.each([
    [{ category: "praise" }],
    [{ category: "" }],
    [{ description: "too short" }],
    [{ description: "x".repeat(FEEDBACK_MAX + 1) }],
    [{ steps: "x".repeat(FEEDBACK_MAX + 1) }],
    [{ description: "          " }],
  ])("rejects %j", (change) => {
    expect(feedbackSchema.safeParse({ ...ok, ...change }).success).toBe(false);
  });

  test("status and sender are not accepted from the form", () => {
    const parsed = feedbackSchema.parse({ ...ok, status: "reviewed", userId: ID, collegeId: ID });
    expect(Object.keys(parsed).sort()).toEqual(["category", "description", "steps"]);
  });

  test("marking as reviewed takes an id and a strict true/false", () => {
    expect(feedbackIdSchema.parse({ feedbackId: ID, reviewed: "true" })).toEqual({ feedbackId: ID, reviewed: true });
    expect(feedbackIdSchema.parse({ feedbackId: ID, reviewed: "false" }).reviewed).toBe(false);
    expect(feedbackIdSchema.safeParse({ feedbackId: "1", reviewed: "true" }).success).toBe(false);
    expect(feedbackIdSchema.safeParse({ feedbackId: ID, reviewed: "yes" }).success).toBe(false);
  });
});
