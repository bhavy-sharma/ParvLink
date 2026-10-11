// A student's whole journey: register → confirm email → create profile →
// edit profile and photo → log out. Plus what a student must not reach.
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { closeDb, confirmEmail, db, dobForAge, fillOnboarding, login, logout, mailFor, PASSWORD, photoWithGps, profileRow, register, runTag, seedCollege, uniqueEmail, userId, userRow } from "./helpers";

const college = `Fergusson College ${runTag}`;
const email = uniqueEmail("asha");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedCollege(college);
  await seedCollege(`Closed College ${runTag}`, { active: false });
});
test.afterAll(closeDb);

/** One browser session reused across the steps below. */
let page;
test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test("registration validates on the server and never echoes the password", async () => {
  await page.goto("/register");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByLabel("Confirm password").fill("different");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByText("Enter a valid email address")).toBeVisible();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
  await expect(page.getByText("The two passwords do not match.")).toBeVisible();
  await expect(page.getByText("Tick the box to agree to the Terms of Use and the Privacy Notice.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("not-an-email");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
});

test("registering sends the user to 'confirm your email' and creates a plain student account", async () => {
  await register(page, email);
  await expect(page.getByText(email)).toBeVisible();

  const user = await userRow(email);
  expect(user).toMatchObject({ role: "student", email_confirmed_at: null });
  // Only a bcrypt hash of the password is stored.
  expect(user.password_hash).toMatch(/^\$2[aby]\$12\$/);
  expect(JSON.stringify(user)).not.toContain(PASSWORD);

  // One confirmation email went out, through SMTP, with a link to this site.
  const mails = await mailFor(email);
  expect(mails).toHaveLength(1);
  expect(mails[0].subject).toBe("Confirm your email for Campus Partner Finder");
  expect(mails[0].from).toContain("no-reply@campus.test");
  expect(mails[0].link).toMatch(/\/auth\/confirm\?token=[A-Za-z0-9_-]{43}&type=email$/);
  // The database holds a hash of the token, not the token.
  const { AuthToken } = await db();
  const token = new URL(mails[0].link).searchParams.get("token");
  const stored = await AuthToken.find({ user_id: user._id }).lean();
  expect(stored).toHaveLength(1);
  expect(stored[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(stored)).not.toContain(token);
});

test("logging in before confirming is refused and leads back to the confirmation page", async () => {
  await login(page, email);
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test("wrong password and unknown account give the same message", async () => {
  await login(page, email, "wrong-password-123");
  const message = page.getByRole("alert").filter({ hasText: "do not match an account" });
  await expect(message).toBeVisible();
  const wrongPassword = await message.textContent();

  await login(page, uniqueEmail("nobody"), "wrong-password-123");
  await expect(page.getByRole("alert").filter({ hasText: "do not match an account" })).toHaveText(wrongPassword);
});

test("'send the link again' answers the same for any address", async () => {
  await page.goto("/verify-email");
  await page.getByLabel("Email").fill(uniqueEmail("ghost"));
  await page.getByRole("button", { name: "Send the link again" }).click();
  await expect(page.getByText("If that address has an unconfirmed account")).toBeVisible();
});

test("the emailed link confirms the address, signs in, and leads to profile creation", async () => {
  // The resend test above did not touch this account's link.
  const link = await confirmEmail(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  expect((await userRow(email)).email_confirmed_at).toBeInstanceOf(Date);

  // The link works once — in this browser or any other.
  const again = await page.context().request.get(link, { maxRedirects: 0 });
  expect(again.headers().location).toMatch(/^\/auth\/error\?reason=invalid/);
  const { AuthToken } = await db();
  expect(await AuthToken.countDocuments({ user_id: await userId(email), used_at: null })).toBe(0);
});

test("registering an address that already has an account reveals nothing and sends nothing", async ({ browser }) => {
  const before = (await mailFor(email)).length;
  const hash = (await userRow(email)).password_hash;
  const other = await (await browser.newContext()).newPage();
  await register(other, email, "someone-elses-password-1");
  await expect(other.getByRole("heading", { name: "Confirm your email" })).toBeVisible();
  await other.context().close();
  expect((await mailFor(email)).length).toBe(before);
  expect((await userRow(email)).password_hash).toBe(hash);
});

test("session cookies cannot be read by page scripts", async () => {
  const cookies = (await page.context().cookies()).filter((cookie) => cookie.name.startsWith("cpf_"));
  const names = cookies.map((cookie) => cookie.name);
  expect(names).toContain("cpf_session");
  expect(names).not.toContain("cpf_reg"); // the registration cookie is gone once the link was used
  for (const cookie of cookies) {
    expect(cookie.httpOnly, cookie.name).toBe(true);
    expect(cookie.sameSite, cookie.name).toBe("Lax");
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain("cpf_");
  const session = cookies.find((cookie) => cookie.name === "cpf_session");
  expect(session.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // The cookie is a random token; the database keeps only its hash.
  const { Session } = await db();
  const sessions = await Session.find({ user_id: await userId(email) }).lean();
  expect(sessions).toHaveLength(1);
  expect(JSON.stringify(sessions)).not.toContain(session.value);
});

test("until a profile exists, the dashboard and profile pages lead to profile creation", async () => {
  for (const path of ["/dashboard", "/profile"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/onboarding$/);
  }
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});

test("only open colleges can be chosen", async () => {
  const options = await page.getByLabel("College").locator("option").allTextContents();
  expect(options).toContain(college);
  expect(options.join("|")).not.toContain("Closed College");
});

test("profile creation rejects an under-age date of birth and keeps what was typed", async () => {
  await fillOnboarding(page, { firstName: "Asha", college, dob: dobForAge(16) });
  await expect(page.getByText("You must be 18 or older to use Campus Partner Finder.")).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel("First name")).toHaveValue("Asha");
  await expect(page.getByLabel("College").locator("option:checked")).toHaveText(college);
  await expect(page.getByLabel("Year of study").locator("option:checked")).toHaveText("2nd year");

  expect(await profileRow(email)).toBeNull();
});

test("a valid profile is created and the student lands on the dashboard", async () => {
  await fillOnboarding(page, { firstName: "Asha", college, dob: dobForAge(20) });
  await expect(page.getByRole("heading", { name: "Hi, Asha" })).toBeVisible();
  await expect(page.getByText(`B.Tech Computer Science, 2nd year at ${college}`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish your profile" })).toBeVisible();
  await expect(page.getByText("No events yet", { exact: true })).toBeVisible();

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a student cannot open any admin page", async () => {
  for (const path of ["/admin", "/admin/colleges", "/admin/admins"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Hi, Asha" })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
});

test("the profile page shows private details to their owner and saves edits", async () => {
  await page.goto("/profile");
  await expect(page.getByText(email)).toBeVisible();
  const [y, m, d] = dobForAge(20).split("-").map(Number);
  const expectedDob = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
  await expect(page.getByText(expectedDob)).toBeVisible();

  await page.getByLabel("About you").fill("Looking for a hackathon team. I do back-end.");
  await page.getByLabel("Year of study").selectOption({ label: "3rd year" });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("About you")).toHaveValue("Looking for a hackathon team. I do back-end.");
  await expect(page.getByLabel("Year of study").locator("option:checked")).toHaveText("3rd year");
});

test("profile edits are validated on the server", async () => {
  await page.getByLabel("First name").fill("<script>alert(1)</script>");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Use letters only")).toBeVisible();
  expect((await profileRow(email)).first_name).toBe("Asha");
});

test("a photo is re-encoded, stored privately and served only to its owner", async ({ browser }) => {
  await page.goto("/profile");
  await page.getByLabel("Choose a photo").setInputFiles({ name: "IMG_0042.JPG", mimeType: "image/jpeg", buffer: await photoWithGps() });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo updated.")).toBeVisible();

  const profile = await profileRow(email);
  expect(profile.avatar_path).toMatch(new RegExp(`^${profile._id}/[0-9a-f-]{36}\\.webp$`));

  const img = page.locator("main img").first();
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  expect(src).toMatch(/^\/profile\/photo\?v=[0-9a-f-]+$/); // the address names no user and no file

  // What is stored is a 512px WebP with no EXIF — not the file that was uploaded.
  const response = await page.context().request.get(src);
  expect(response.headers()["content-type"]).toBe("image/webp");
  expect(response.headers()["cache-control"]).toContain("private");
  const stored = await response.body();
  const meta = await sharp(stored).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(["webp", 512, 512]);
  expect(meta.exif).toBeUndefined();
  expect(stored.includes(Buffer.from("e2e-secret-marker"))).toBe(false);
  const { Photo } = await db();
  const inDatabase = await Photo.findById(profile.avatar_path).lean();
  expect(inDatabase.user_id).toBe(profile._id);
  expect(Buffer.from(inDatabase.data.buffer).equals(stored)).toBe(true);

  // Without this student's session there is no way to fetch it.
  const anonymous = await browser.newContext();
  const refused = await anonymous.request.get(src, { maxRedirects: 0 });
  expect(refused.status()).toBe(307);
  expect(refused.headers().location).toMatch(/^\/login/);
  await anonymous.close();
});

test("a file that only pretends to be an image is rejected", async () => {
  await page.goto("/profile");
  await page.getByLabel("Replace photo").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("That file could not be read as a photo.")).toBeVisible();
});

test("removing the photo deletes the stored file", async () => {
  await page.goto("/profile");
  const { Photo } = await db();
  const mine = { user_id: await userId(email) };
  expect(await Photo.countDocuments(mine)).toBe(1);
  await page.getByRole("button", { name: "Remove photo" }).click();
  await page.getByRole("button", { name: "Yes, remove photo" }).click();
  await expect(page.getByLabel("Choose a photo")).toBeVisible();
  expect(await Photo.countDocuments(mine)).toBe(0);
  expect((await page.context().request.get("/profile/photo")).status()).toBe(404);
});

test("?next= only ever leads to a page on this site", async ({ browser }) => {
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto("/login?next=https://evil.example/phish");
  await fresh.getByLabel("Email").fill(email);
  await fresh.getByLabel("Password").fill(PASSWORD);
  await fresh.getByRole("button", { name: "Log in" }).click();
  await expect(fresh).toHaveURL(/\/dashboard$/);

  await logout(fresh);
  await fresh.goto("/login?next=/profile");
  await fresh.getByLabel("Email").fill(email);
  await fresh.getByLabel("Password").fill(PASSWORD);
  await fresh.getByRole("button", { name: "Log in" }).click();
  await expect(fresh).toHaveURL(/\/profile$/);
  await fresh.context().close();
});

test("logging out ends the session", async () => {
  await page.goto("/dashboard");
  await logout(page);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  // Signed-in users are kept away from the login page; signed-out ones are not.
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
});
