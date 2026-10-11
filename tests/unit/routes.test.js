import { describe, expect, test } from "vitest";
import { homeForRole, isAdminPath, isGuestOnlyPath, isProtectedPath, safeNextPath } from "@/lib/auth/routes";

describe("safeNextPath (open-redirect protection)", () => {
  test.each([
    ["/dashboard", "/dashboard"],
    ["/profile?tab=photo", "/profile?tab=photo"],
    ["/admin/colleges/123", "/admin/colleges/123"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeNextPath(input, "/fallback")).toBe(expected);
  });

  test.each([
    ["https://evil.example/steal"],
    ["//evil.example"],
    ["/\\evil.example"],
    ["\\\\evil.example"],
    ["javascript:alert(1)"],
    ["dashboard"],
    ["/dash\nboard"],
    ["/a\\b"],
    [""],
    [null],
    [undefined],
    [42],
    [["/dashboard"]],
    ["/" + "a".repeat(600)],
    ["/login"],
    ["/register"],
    ["/auth/confirm?code=x"],
  ])("rejects %j", (input) => {
    expect(safeNextPath(input, "/fallback")).toBe("/fallback");
  });

  test("drops the fragment and never returns another origin", () => {
    expect(safeNextPath("/dashboard#x", "/fallback")).toBe("/dashboard");
    expect(safeNextPath("/@evil.example", "/fallback")).toBe("/@evil.example"); // still a local path
  });
});

describe("route classification", () => {
  test("protected prefixes match whole segments only", () => {
    for (const path of ["/dashboard", "/profile", "/onboarding", "/admin", "/admin/colleges", "/admin/colleges/abc"]) {
      expect(isProtectedPath(path), path).toBe(true);
    }
    for (const path of ["/", "/login", "/register", "/verify-email", "/auth/confirm", "/administrator", "/dashboards", "/profile-tips"]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });

  test("admin and guest-only paths", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/admins")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isGuestOnlyPath("/login")).toBe(true);
    expect(isGuestOnlyPath("/verify-email")).toBe(false);
  });

  test("unknown roles land on the student dashboard", () => {
    expect(homeForRole("super_admin")).toBe("/admin");
    expect(homeForRole("admin")).toBe("/admin");
    expect(homeForRole("student")).toBe("/dashboard");
    expect(homeForRole("owner")).toBe("/dashboard");
    expect(homeForRole(undefined)).toBe("/dashboard");
  });
});
