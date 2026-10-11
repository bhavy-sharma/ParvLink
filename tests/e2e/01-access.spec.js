// Signed-out visitors: protected pages, redirects and response headers.
import { expect, test } from "@playwright/test";

const PROTECTED = ["/dashboard", "/profile", "/onboarding", "/admin", "/admin/colleges", "/admin/admins", "/admin/colleges/3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b"];

test.describe("signed-out visitors", () => {
  for (const path of PROTECTED) {
    test(`${path} answers with an HTTP redirect to /login, before any page renders`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(307);
      const location = new URL(response.headers().location, "http://x");
      expect(location.pathname).toBe("/login");
      expect(location.searchParams.get("next")).toBe(path);
      expect(await response.text()).not.toMatch(/Super Admin|Manage colleges|Your profile/);
    });
  }

  test("public pages load", async ({ page }) => {
    for (const [path, heading] of [
      ["/", /sit the event out/],
      ["/login", "Log in"],
      ["/register", "Create an account"],
      ["/verify-email", "Confirm your email"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });

  test("security headers are sent", async ({ request }) => {
    const headers = (await request.get("/login")).headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("a bad or reused confirmation link shows a fixed message and reflects nothing", async ({ page }) => {
    // Malformed, well-formed but unknown, wrong purpose, and missing: one fixed answer for all of them.
    const unknown = "A".repeat(43);
    for (const query of ["token=not-a-real-token&type=email", `token=${unknown}&type=email`, `token=${unknown}&type=recovery`, `token=${unknown}&type=admin`, `token[$ne]=x&type=email`, ""]) {
      await page.goto(`/auth/confirm?${query}`);
      await expect(page).toHaveURL(/\/auth\/error\?reason=invalid$/);
      await expect(page.getByRole("heading", { name: "That link did not work" })).toBeVisible();
    }
    expect((await page.context().cookies()).filter((cookie) => cookie.name === "cpf_session")).toEqual([]);

    await page.goto("/auth/confirm?error=access_denied&error_description=%3Cscript%3Ealert(1)%3C/script%3E");
    await expect(page).toHaveURL(/\/auth\/error\?reason=invalid$/);
    await page.goto("/auth/error?reason=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E");
    await expect(page.getByRole("heading", { name: "That link did not work" })).toBeVisible();
    expect(await page.content()).not.toContain("onerror=alert");
  });

  test("the confirmation route never redirects off-site", async ({ request }) => {
    const response = await request.get(`/auth/confirm?token=${"B".repeat(43)}&type=email&next=https://evil.example/`, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toMatch(/^\/auth\/error/);
  });

  test("unknown pages show the not-found page", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  });
});
