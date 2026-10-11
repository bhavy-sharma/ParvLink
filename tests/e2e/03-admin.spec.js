// Super Admin bootstrap, college and admin management, and the boundaries
// between student, college admin and Super Admin — in the UI and at the Server
// Action endpoints. (There is no data API to call directly: the rules behind
// these pages are tested one by one in tests/services.)
import { expect, test } from "@playwright/test";
import {
  bootstrapSuperAdmin,
  closeDb,
  createAccount,
  createStudent,
  db,
  login,
  logout,
  runTag,
  seedCollege,
  uniqueEmail,
  userId,
  userRow,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const collegeA = `Alpha College ${runTag}`;
const collegeB = `Beta College ${runTag}`;
const newCollege = `Gamma Institute ${runTag}`;
const forgedCollege = `Forged College ${runTag}`;

const emails = {
  superAdmin: uniqueEmail("root"),
  admin: uniqueEmail("priya-admin"),
  studentA: uniqueEmail("arjun"),
  studentA2: uniqueEmail("anita"),
  studentB: uniqueEmail("bela"),
};

const pages = {};
test.beforeAll(async ({ browser }) => {
  await seedCollege(collegeA);
  await seedCollege(collegeB);
  for (const name of Object.keys(emails)) pages[name] = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  for (const page of Object.values(pages)) await page.context().close();
  await closeDb();
});

const collegeCount = async (name) => (await db()).College.countDocuments({ name });
const roleOf = async (email) => (await userRow(email))?.role;

test("set-up: accounts for a future super admin, a future admin and three students", async () => {
  await createAccount(pages.superAdmin, emails.superAdmin);
  await createAccount(pages.admin, emails.admin);
  await createStudent(pages.studentA, { email: emails.studentA, firstName: "Arjun", college: collegeA });
  await createStudent(pages.studentA2, { email: emails.studentA2, firstName: "Anita", college: collegeA });
  await createStudent(pages.studentB, { email: emails.studentB, firstName: "Bela", college: collegeB });
});

test("registering grants nothing: before bootstrap, the future super admin is an ordinary student", async () => {
  expect(await roleOf(emails.superAdmin)).toBe("student");
  await pages.superAdmin.goto("/admin");
  await expect(pages.superAdmin).toHaveURL(/\/onboarding$/);
});

test("after the operator runs the bootstrap script, the super admin lands on the admin overview", async () => {
  await bootstrapSuperAdmin(emails.superAdmin);
  const page = pages.superAdmin;
  await logout(page);
  await login(page, emails.superAdmin);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("You have access to every college.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Colleges" })).toBeVisible();
});

test("super admin adds a college; duplicates and bad names are refused", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin/colleges");
  await expect(page.getByRole("listitem").filter({ hasText: collegeA })).toBeVisible();

  await page.getByLabel("College name").fill(newCollege);
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Add college" }).click();
  await expect(page.getByText(`${newCollege} was added.`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: newCollege })).toContainText("Open");
  await expect(page.getByLabel("College name")).toHaveValue("");

  await page.getByLabel("College name").fill(newCollege.toUpperCase());
  await page.getByLabel("Short name").fill("another-short-name-" + runTag);
  await page.getByRole("button", { name: "Add college" }).click();
  await expect(page.getByText("A college with that name already exists.")).toBeVisible();

  await page.getByLabel("College name").fill("X");
  await page.getByRole("button", { name: "Add college" }).click();
  await expect(page.getByText("Enter the college name.")).toBeVisible();
  expect(await collegeCount(newCollege)).toBe(1);
});

test("super admin edits and closes a college; students can no longer choose it", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin/colleges");
  await page.getByRole("link", { name: `Edit ${newCollege}` }).click();
  await expect(page.getByRole("heading", { name: newCollege })).toBeVisible();
  await expect(page.getByText("0 students have a profile here.")).toBeVisible();

  await page.getByLabel("City").fill("Mumbai");
  await page.getByLabel("Open to students").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("College saved.")).toBeVisible();

  await page.goto("/admin/colleges");
  const row = page.getByRole("listitem").filter({ hasText: newCollege });
  await expect(row).toContainText("Mumbai");
  await expect(row).toContainText("Closed");

  // The future admin has no profile yet, so they still see the college picker.
  await pages.admin.goto("/onboarding");
  const options = await pages.admin.getByLabel("College").locator("option").allTextContents();
  expect(options).toContain(collegeA);
  expect(options.join("|")).not.toContain(newCollege);
});

test("an unknown college id shows not-found, not an error", async () => {
  // (The page streams, so the status line is already sent as 200 by the time
  // the lookup finishes; what matters is what the person sees.)
  for (const id of ["3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b", "not-a-uuid", "1%20or%201=1"]) {
    await pages.superAdmin.goto(`/admin/colleges/${id}`);
    await expect(pages.superAdmin.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  }
});

test("super admin makes a registered user an admin; unknown addresses are refused", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin/admins");
  await expect(page.getByText("No admins yet", { exact: true })).toBeVisible();

  await page.getByLabel("Email of the person to make an admin").fill(uniqueEmail("stranger"));
  await page.getByRole("button", { name: "Make admin" }).click();
  await expect(page.getByText("No verified account uses that email address.")).toBeVisible();

  await page.getByLabel("Email of the person to make an admin").fill(emails.superAdmin);
  await page.getByRole("button", { name: "Make admin" }).click();
  await expect(page.getByText("You cannot change your own role.")).toBeVisible();

  await page.getByLabel("Email of the person to make an admin").fill(emails.admin);
  await page.getByRole("button", { name: "Make admin" }).click();
  await expect(page.getByText(`${emails.admin} is now an admin.`)).toBeVisible();
  expect(await roleOf(emails.admin)).toBe("admin");

  const card = page.getByRole("article", { name: emails.admin });
  await expect(card).toContainText("Not assigned to any college");
});

test("a new admin with no college sees an empty, clearly explained admin area", async () => {
  const page = pages.admin;
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("No colleges assigned yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Colleges" })).toHaveCount(0);
});

test("super admin assigns the admin to college A with chosen permissions", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin/admins");
  const card = page.getByRole("article", { name: emails.admin });
  await card.getByText("Assign a college").click();
  await card.getByLabel("College", { exact: true }).selectOption({ label: collegeA });
  await card.getByLabel("Moderate reports").check();
  await card.getByRole("button", { name: "Save assignment" }).click();

  const assignment = card.getByRole("listitem").filter({ hasText: collegeA });
  await expect(assignment).toContainText("View students");
  await expect(assignment).toContainText("Moderate reports");

  const { AdminCollegeAccess } = await db();
  const rows = await AdminCollegeAccess.find({ admin_user_id: await userId(emails.admin) }).lean();
  expect(rows).toHaveLength(1);
  expect([...rows[0].permissions].sort()).toEqual(["moderate_reports", "view_students"]);
  expect(rows[0].granted_by).toBe(await userId(emails.superAdmin));
});

test("the college admin sees college A with its students — and nothing of college B", async () => {
  const page = pages.admin;
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Your colleges" })).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: collegeA });
  await expect(card).toContainText("2 student profiles");
  await expect(card).toContainText("View students");
  await expect(page.getByText(collegeB)).toHaveCount(0);
});

test("a college admin cannot open Super Admin pages", async () => {
  const page = pages.admin;
  for (const path of ["/admin/colleges", "/admin/admins"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Your colleges" })).toBeVisible();
  }
});

test("the raw response for an admin page contains no admin content for the wrong role", async () => {
  // Pages stream, so look at the bytes the server actually sends — not just
  // at what ends up on screen after the redirect.
  const forbidden = ["Add a college", "Add an admin", "Make admin", collegeB, emails.superAdmin, emails.studentB];
  for (const [who, context, paths] of [
    ["student", pages.studentA.context(), ["/admin", "/admin/colleges", "/admin/admins"]],
    ["college admin", pages.admin.context(), ["/admin/colleges", "/admin/admins"]],
  ]) {
    for (const path of paths) {
      const body = await (await context.request.get(path)).text();
      for (const text of forbidden) expect(body, `${who} GET ${path} must not contain "${text}"`).not.toContain(text);
    }
  }
  // Control: the same check finds the content when a super admin asks.
  const body = await (await pages.superAdmin.context().request.get("/admin/admins")).text();
  expect(body).toContain("Add an admin");
});

test("Server Actions check the caller themselves: a replayed 'add college' request fails for everyone but a super admin", async ({ browser }) => {
  // 1. Capture the exact request the super admin's browser sends for
  //    "Add college" — and stop it from reaching the server.
  const page = pages.superAdmin;
  await page.goto("/admin/colleges");
  let captured;
  await page.route("**/admin/colleges", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      captured = { url: request.url(), headers: await request.allHeaders(), body: request.postDataBuffer() };
      return route.abort();
    }
    return route.continue();
  });
  await page.getByLabel("College name").fill(forgedCollege);
  await page.getByRole("button", { name: "Add college" }).click();
  await expect.poll(() => captured).toBeTruthy();
  await page.unroute("**/admin/colleges");
  expect(await collegeCount(forgedCollege)).toBe(0);

  const replayAs = async (context) => {
    const headers = Object.fromEntries(
      Object.entries(captured.headers).filter(([name]) => !name.startsWith(":") && !["cookie", "content-length", "host", "connection"].includes(name)),
    );
    return context.request.post(captured.url, { headers, data: captured.body, maxRedirects: 0 });
  };

  // 2. Replay it with other people's sessions (their cookies, same action id).
  const anonymous = await browser.newContext();
  for (const [who, context] of [
    ["student", pages.studentA.context()],
    ["college admin", pages.admin.context()],
    ["signed-out visitor", anonymous],
  ]) {
    const response = await replayAs(context);
    expect(response.status(), who).toBeLessThan(500);
    expect(await collegeCount(forgedCollege), `${who} must not be able to create a college`).toBe(0);
  }
  await anonymous.close();

  // 3. Control: the very same replay DOES work for the super admin, so the
  //    failures above are real refusals and not a broken replay.
  const response = await replayAs(page.context());
  expect(response.ok()).toBe(true);
  expect(await collegeCount(forgedCollege)).toBe(1);
});

test("there is no data API: nothing answers outside the pages, and the health check gives nothing away", async ({ browser }) => {
  // The only ways to data are the pages and Server Actions tested here — both
  // decide from the session. Addresses a data API would live at do not exist,
  // signed in or not.
  const anonymous = await browser.newContext();
  for (const context of [pages.studentA.context(), pages.admin.context(), anonymous]) {
    for (const path of ["/rest/v1/profiles", "/auth/v1/user", "/api/profiles", "/api/users", "/api/admin/colleges", "/graphql"]) {
      const response = await context.request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
    }
    const health = await context.request.get("/api/health");
    const body = await health.text();
    expect(health.ok()).toBe(true);
    expect(JSON.parse(body)).toEqual({ status: "ok" }); // configured or not — no addresses, versions or errors
  }
  await anonymous.close();
});

test("revoking college access takes effect on the admin's next page load", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin/admins");
  const card = page.getByRole("article", { name: emails.admin });
  await card.getByRole("button", { name: "Revoke" }).click();
  await card.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(card).toContainText("Not assigned to any college");

  await pages.admin.goto("/admin");
  await expect(pages.admin.getByText("No colleges assigned yet", { exact: true })).toBeVisible();
});

test("removing the admin role returns the person to the student side", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin/admins");
  const card = page.getByRole("article", { name: emails.admin });
  await card.getByRole("button", { name: "Remove admin role" }).click();
  await card.getByRole("button", { name: "Yes, remove admin role" }).click();
  await expect(page.getByText("No admins yet", { exact: true })).toBeVisible();
  expect(await roleOf(emails.admin)).toBe("student");

  await pages.admin.goto("/admin");
  await expect(pages.admin).toHaveURL(/\/onboarding$/);
});

test("the overview lists what was done, and every change is in the audit log", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin");
  const activity = page.getByRole("list").filter({ hasText: "Admin role removed" });
  await expect(activity).toContainText("College access revoked");
  await expect(activity).toContainText(emails.superAdmin);

  const { AuditLog } = await db();
  const actions = (await AuditLog.find({ actor_id: await userId(emails.superAdmin) }).sort({ seq: 1 }).lean()).map((entry) => entry.action);
  for (const expected of ["colleges.insert", "colleges.update", "user_roles.update", "admin_college_access.insert", "admin_college_access.delete"]) {
    expect(actions, expected).toContain(expected);
  }
});

test("the super admin cannot be demoted or re-roled from the app", async () => {
  // Nothing on the admins screen offers it, and the role is unchanged after everything above.
  const page = pages.superAdmin;
  await page.goto("/admin/admins");
  await expect(page.getByRole("article", { name: emails.superAdmin })).toHaveCount(0);
  await page.getByLabel("Email of the person to make an admin").fill(emails.superAdmin);
  await page.getByRole("button", { name: "Make admin" }).click();
  await expect(page.getByText("You cannot change your own role.")).toBeVisible();
  expect(await roleOf(emails.superAdmin)).toBe("super_admin");
  // The script that made them left its own entry in the log, with no actor from the app.
  const { AuditLog } = await db();
  const entry = await AuditLog.findOne({ target_id: await userId(emails.superAdmin), action: "user_roles.update" }).lean();
  expect(entry).toMatchObject({ actor_id: null, metadata: { by: "command line", new: { role: "super_admin" } } });
});
