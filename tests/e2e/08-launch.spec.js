// Phase 6 — what was added for the beta launch: an honest landing page, the
// privacy notice and terms, consent at sign-up, password reset, account
// deletion (immediate, held and completed by a Super Admin), the feedback
// form and its inbox, and what happens when a session ends mid-form.
// Service-level versions of the same rules: tests/services/01-auth and 07-account-feedback.
import { expect, test } from "@playwright/test";
import {
  bootstrapSuperAdmin,
  closeDb,
  createAccount,
  createStudent,
  db,
  login,
  logout,
  makeAdmin,
  mailFor,
  makeMatch,
  PASSWORD,
  recoveryLink,
  register,
  runTag,
  seedCollege,
  seedEvent,
  storedMessages,
  storeMessage,
  uniqueEmail,
  uploadPhoto,
  userId,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const college = `Loyola Academy ${runTag}`;
const eventTitle = `Duet Night ${runTag}`;
const NEW_PASSWORD = "brand-new-password-42";
const CANARY = `LAUNCH-CANARY-${runTag}`;

const emails = {
  root: uniqueEmail("l-root"), // Super Admin
  admin: uniqueEmail("l-admin"), // college admin, every permission
  arjun: uniqueEmail("l-arjun"), // deletes his account at once
  bela: uniqueEmail("l-bela"), // matched with Arjun and with Chetan
  chetan: uniqueEmail("l-chetan"), // reported → his deletion is held
  divya: uniqueEmail("l-divya"), // resets her password, sends feedback
  ghost: uniqueEmail("l-ghost"), // no profile; deletes the account and later registers again
};
const pages = {};
const ids = {};
let collegeId;
let event;
let arjunBela;
let chetanBela;

const visible = (locator) => locator.filter({ visible: true });
const refOf = (prefix, id) => `${prefix}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
/** Number of documents of one kind, for example count("Profile", { _id: id }). */
const count = async (model, filter) => (await db())[model].countDocuments(filter);

test.beforeAll(async ({ browser }) => {
  collegeId = await seedCollege(college);
  event = await seedEvent(eventTitle, collegeId);
  for (const name of [...Object.keys(emails), "guest"]) pages[name] = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  for (const page of Object.values(pages)) await page.context().close();
  await closeDb();
});

// ----------------------------------------------------------------------------- public pages
test("the landing page describes the real product: no sample students, no 'coming later'", async () => {
  const page = pages.guest;
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("for want of a partner");
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  const text = await page.locator("body").innerText();
  for (const gone of ["comes later", "Examples of what students post", "Asha, 2nd year", "Lorem", "TODO", "Coming soon"]) expect(text).not.toContain(gone);
  // It does not promise what the system does not do.
  expect(text).toContain("not end-to-end encrypted");
  expect(text).toContain("not identity-checked");

  // Every link and button on the page leads somewhere that loads.
  const hrefs = await page.locator("a[href]").evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute("href")))]);
  expect(hrefs).toEqual(expect.arrayContaining(["/login", "/register", "/privacy", "/terms"]));
  for (const href of hrefs.filter((h) => h.startsWith("/"))) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBe(200);
  }
});

test("the privacy notice and terms are public, match the system, and mark what the operator must still supply", async () => {
  const page = pages.guest;
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy notice" })).toBeVisible();
  const privacy = await visible(page.locator("main")).innerText();
  for (const claim of ["not end-to-end encrypted", "MongoDB", "An email provider", "stored only as hashes", "Vercel", "Nothing is deleted automatically", "Reports", "activity log", "no advertising or tracking cookies"]) {
    expect(privacy, claim).toContain(claim);
  }
  // No invented identity: the test stack sets no operator details, so the page says so.
  await expect(visible(page.locator("[data-legal-draft]"))).toBeVisible();
  expect(privacy).toContain("[OPERATOR NAME — NOT YET CONFIGURED]");
  expect(privacy).toContain("[SUPPORT EMAIL — NOT YET CONFIGURED]");
  expect(await page.locator("a[href^='mailto:']").count()).toBe(0);
  expect(privacy).not.toMatch(/Pvt\.? Ltd|Inc\.|LLC|GmbH|Registered office/i);

  await page.getByRole("contentinfo").getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms of use" })).toBeVisible();
  const terms = await visible(page.locator("main")).innerText();
  expect(terms).toContain("18 or older");
  expect(terms).toContain("We do not verify anyone’s identity");
  expect(terms).toContain("[TO BE COMPLETED BY THE OPERATOR");
  await expect(visible(page.locator("[data-legal-draft]"))).toBeVisible();
});

// ----------------------------------------------------------------------------- consent
test("an account cannot be created without agreeing to the terms; agreeing is recorded", async () => {
  const page = pages.divya;
  await page.goto("/register");
  await page.getByLabel("Email").fill(emails.divya);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Tick the box to agree to the Terms of Use and the Privacy Notice.")).toBeVisible();
  await expect(page).toHaveURL(/\/register$/);
  expect(await count("User", { email: emails.divya })).toBe(0);
  expect(await mailFor(emails.divya)).toEqual([]);

  // The links next to the box open the real documents.
  await expect(page.locator("#agree-links").getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
  await expect(page.locator("#agree-links").getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/privacy");

  await createStudent(page, { email: emails.divya, firstName: "Divya", college });
  const account = await (await db()).User.findOne({ email: emails.divya }).lean();
  expect(account.terms_version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(account.terms_accepted_at).toBeInstanceOf(Date);
  // …and that statement grants nothing.
  expect(account.role).toBe("student");
});

test("set-up: staff, students, two matches, messages and a report", async () => {
  test.setTimeout(180_000);
  for (const who of ["root", "admin", "ghost"]) await createAccount(pages[who], emails[who]);
  await bootstrapSuperAdmin(emails.root);
  await makeAdmin(emails.admin, collegeId, ["moderate_reports", "view_students", "manage_students", "manage_events"]);
  for (const who of ["root", "admin"]) {
    await logout(pages[who]);
    await login(pages[who], emails[who]);
    await expect(pages[who]).toHaveURL(/\/admin$/);
  }
  for (const [who, firstName] of [["arjun", "Arjun"], ["bela", "Bela"], ["chetan", "Chetan"]]) {
    await createStudent(pages[who], { email: emails[who], firstName, college });
    await uploadPhoto(pages[who]); // joining an event needs a photo
  }
  for (const who of Object.keys(emails)) ids[who] = await userId(emails[who]);

  const person = (who, gender) => ({ email: emails[who], gender, lookingFor: gender === "male" ? "female" : "male" });
  arjunBela = await makeMatch(event, person("arjun", "male"), person("bela", "female"));
  chetanBela = await makeMatch(event, person("chetan", "male"), person("bela", "female"));
  await storeMessage(arjunBela.matchId, ids.arjun, `See you at rehearsal. ${CANARY}`);
  await storeMessage(arjunBela.matchId, ids.bela, "Six o'clock works.");
  await storeMessage(chetanBela.matchId, ids.chetan, "Answer me. Now.");
  // Bela reports Chetan from the chat screen, sharing the messages.
  const bela = pages.bela;
  await bela.goto(`/matches/${chetanBela.conversation}`);
  await visible(bela.getByRole("button", { name: "Report user" })).click();
  const dialog = bela.getByRole("dialog", { name: "Report Chetan" });
  await dialog.getByLabel("What is wrong?").selectOption({ label: "Harassment or abusive messages" });
  await dialog.getByLabel("What happened?").fill("Keeps demanding replies.");
  await dialog.getByLabel(/Share the last 20 messages/).check();
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("Report sent to the moderators. Thank you.")).toBeVisible();
});

// ----------------------------------------------------------------------------- password reset
test("forgotten password: the answer is the same for any address, and only a real account gets a link", async () => {
  const page = pages.guest;
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  const neutral = "If that address has an account, a link to choose a new password is on its way.";
  await page.getByLabel("Email").fill(`nobody-${runTag}@e2e.test`);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(neutral)).toBeVisible();

  await page.reload();
  await page.getByLabel("Email").fill(emails.divya);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(neutral)).toBeVisible();
  // A real email went out to the real account, and nothing at all to the unknown address.
  expect(await recoveryLink(emails.divya)).toMatch(/^\/auth\/confirm\?token=[A-Za-z0-9_-]{43}&type=recovery$/);
  const mails = (await mailFor(emails.divya)).filter((mail) => mail.link?.endsWith("type=recovery"));
  expect(mails).toHaveLength(1);
  expect(mails[0].subject).toBe("Choose a new password for Campus Partner Finder");
  expect(mails[0].text).toMatch(/works once and expires in 60 minutes/);
  expect(await mailFor(`nobody-${runTag}@e2e.test`)).toEqual([]);
  // The database holds the token's hash only.
  const { AuthToken } = await db();
  const stored = await AuthToken.find({ user_id: await userId(emails.divya), kind: "reset_password" }).lean();
  expect(stored).toHaveLength(1);
  expect(JSON.stringify(stored)).not.toContain(new URL(mails[0].link).searchParams.get("token"));
});

test("the emailed link lets her choose a new password once; other devices are logged out and the old password stops working", async () => {
  const other = pages.divya; // still logged in from registration, on "another device"
  await other.goto("/dashboard");
  await expect(other.getByRole("heading", { name: "Hi, Divya" })).toBeVisible();
  // A logged-in session alone is not enough to change the password.
  await other.goto("/reset-password");
  await expect(other.getByText("Open the link from your email first")).toBeVisible();
  await expect(other.getByLabel("New password")).toHaveCount(0);

  const page = pages.guest;
  const link = await recoveryLink(emails.divya);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password$/);

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill("something-else-99");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The two passwords do not match.")).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm new password").fill(PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("That is your current password. Choose a different one.")).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Your password has been changed.")).toBeVisible();
  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Hi, Divya" })).toBeVisible();

  // The one-time marker is spent: no second change from the same visit.
  await page.goto("/reset-password");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Open the link from your email first")).toBeVisible();

  // The other device has been logged out.
  await other.goto("/dashboard");
  await expect(other).toHaveURL(/\/login/);

  // The link cannot be used twice.
  const stranger = await (await page.context().browser().newContext()).newPage();
  await stranger.goto(link);
  await expect(stranger).toHaveURL(/\/auth\/error/);
  // Old password refused, new one accepted.
  await login(stranger, emails.divya, PASSWORD);
  await expect(stranger.getByText("That email and password do not match an account.")).toBeVisible();
  await login(stranger, emails.divya, NEW_PASSWORD);
  await expect(stranger).toHaveURL(/\/dashboard$/);
  await stranger.context().close();
});

// ----------------------------------------------------------------------------- session ends mid-form
test("submitting a form after the session has ended leads to the login page, not an error screen", async () => {
  const page = pages.guest; // Divya, logged in through the reset link
  await page.goto("/account/feedback");
  await page.getByLabel("What is this about?").selectOption("bug");
  await page.getByLabel("What happened, or what would you like?").fill("Written just before my session ended.");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByText("This page did not load")).toHaveCount(0);
  expect(await count("Feedback", { user_id: ids.divya })).toBe(0);
  await login(page, emails.divya, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
});

// ----------------------------------------------------------------------------- feedback
test("beta feedback: a signed-in user sends it; nobody but a Super Admin can read it", async () => {
  const page = pages.guest;
  await visible(page.getByRole("navigation", { name: "About this site" })).getByRole("link", { name: "Send feedback" }).click();
  await expect(page).toHaveURL(/\/account\/feedback$/);

  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Choose what this is about.")).toBeVisible();
  await page.getByLabel("What is this about?").selectOption({ label: "Something is broken" });
  await page.getByLabel("What happened, or what would you like?").fill("short");
  await page.getByRole("button", { name: "Send feedback" }).click();
  // The first, empty submission showed the description error too — so wait for
  // something only the second answer changes before typing again.
  await expect(page.getByText("Choose what this is about.")).toHaveCount(0);
  await expect(page.getByText("Describe it in at least 10 characters.")).toBeVisible();
  await expect(page.getByLabel("What is this about?")).toHaveValue("bug");

  const description = `The join button does nothing on my phone. <b>${CANARY}</b>`;
  await page.getByLabel("What happened, or what would you like?").fill(description);
  await page.getByLabel("Steps to make it happen again").fill("1. Open the event\n2. Press Join");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Thank you — your feedback has been sent to the team.")).toBeVisible();
  await expect(page.getByLabel("What happened, or what would you like?")).toHaveValue("");

  const { Feedback } = await db();
  expect(await Feedback.find({ description }).lean()).toMatchObject([{ user_id: ids.divya, college_id: collegeId, category: "bug", status: "new", steps: "1. Open the event\n2. Press Join" }]);

  // Not readable by students or college admins: there is no address for it but the Super Admin's screen.
  // (The services behind that screen refuse everyone else: tests/services/07-account-feedback.)
  await pages.bela.goto("/admin/feedback");
  await expect(pages.bela).toHaveURL(/\/dashboard$/);
  expect(await (await pages.bela.context().request.get("/admin/feedback")).text()).not.toContain(CANARY);
  // A college admin has no Feedback screen.
  await pages.admin.goto("/admin/feedback");
  await expect(pages.admin).toHaveURL(/\/admin$/);
  await expect(pages.admin.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Feedback" })).toHaveCount(0);
});

test("beta feedback: the Super Admin inbox shows it as text, without the sender's identity, and marks it reviewed", async () => {
  const page = pages.root;
  await page.goto("/admin");
  await expect(visible(page.locator("dt", { hasText: /^New feedback$/ }).locator("xpath=following-sibling::dd[1]"))).toHaveText("1");
  await visible(page.getByRole("navigation", { name: "Admin" })).getByRole("link", { name: "Feedback" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Feedback" })).toBeVisible();

  const item = visible(page.getByRole("article")).filter({ hasText: CANARY });
  await expect(item).toContainText(`<b>${CANARY}</b>`); // shown as text, not interpreted
  expect(await item.locator("b").count()).toBe(0);
  await expect(item).toContainText(refOf("U", ids.divya));
  await expect(item).toContainText("Steps to reproduce");
  const text = await visible(page.locator("main")).innerText();
  expect(text).not.toContain(emails.divya);
  expect(text).not.toContain("Divya");

  await item.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(item.getByRole("button", { name: "Mark as new again" })).toBeVisible();
  await page.goto("/admin/feedback?status=new");
  await expect(page.getByText("No feedback matches these filters")).toBeVisible();
  expect(await (await db()).Feedback.find({ user_id: ids.divya }).lean()).toMatchObject([{ status: "reviewed", reviewed_by: ids.root }]);
});

// ----------------------------------------------------------------------------- account deletion
test("26. deleting an account needs the password and an explicit confirmation", async () => {
  const page = pages.arjun;
  await page.goto("/profile");
  await page.getByRole("link", { name: "Delete your account" }).click();
  await expect(page).toHaveURL(/\/account\/delete$/);
  await expect(page.getByRole("heading", { name: "What is deleted" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is kept" })).toBeVisible();

  await page.getByLabel("Your current password").fill("not-my-password-1");
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page.getByText("That is not your current password.")).toBeVisible();

  await page.getByLabel("Your current password").fill(PASSWORD);
  await page.getByLabel("Type DELETE to confirm").fill("delete");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page.getByText("Type DELETE in capitals to confirm.")).toBeVisible();
  expect(await count("Profile", { _id: ids.arjun })).toBe(1);
});

test("26. nobody can trigger a deletion for someone else", async () => {
  // The self-service page deletes the account of whoever is signed in — it has no field for anyone else —
  // and the admin screen is for the Super Admin only, and only lists requests students made themselves.
  // (The services refuse every other route: tests/services/07-account-feedback.)
  await pages.bela.goto("/account/delete");
  await expect(pages.bela.locator("input[name]:not([type=password]):not([name=confirm])").filter({ visible: true })).toHaveCount(0);
  for (const page of [pages.bela, pages.admin]) {
    await page.goto("/admin/deletions");
    await expect(page).not.toHaveURL(/\/admin\/deletions/);
    expect(await (await page.context().request.get("/admin/deletions")).text()).not.toContain(refOf("U", ids.arjun));
  }
  await pages.root.goto("/admin/deletions");
  await expect(pages.root.getByText("No requests are waiting")).toBeVisible();
  await expect(pages.root.getByRole("button", { name: "Delete account" })).toHaveCount(0);
  expect(await count("Profile", { _id: ids.arjun })).toBe(1);
});

test("26. an ordinary student's account is erased at once: profile, photo, matches, conversations and the login", async () => {
  const page = pages.arjun;
  const photo = (await (await db()).Profile.findById(ids.arjun).lean()).avatar_path;
  expect(photo).toMatch(new RegExp(`^${ids.arjun}/`));
  expect(await count("Photo", { _id: photo })).toBe(1);
  expect(await storedMessages(arjunBela.matchId)).toHaveLength(2);
  const cookiesBefore = await page.context().cookies(); // what a copied session would hold

  await page.goto("/account/delete");
  await page.getByLabel("Your current password").fill(PASSWORD);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page).toHaveURL(/\/goodbye$/);
  await expect(page.getByRole("heading", { name: "Your account has been deleted" })).toBeVisible();

  // Really gone — not hidden.
  const mine = { $or: [{ user_a_id: ids.arjun }, { user_b_id: ids.arjun }] };
  for (const [what, model, filter] of [
    ["profile", "Profile", { _id: ids.arjun }],
    ["private data", "ProfilePrivate", { _id: ids.arjun }],
    ["participation", "EventParticipant", { user_id: ids.arjun }],
    ["interests", "Interest", { $or: [{ from_user_id: ids.arjun }, { to_user_id: ids.arjun }] }],
    ["matches", "Match", mine],
    ["messages", "Message", { sender_id: ids.arjun }],
    ["sessions", "Session", { user_id: ids.arjun }],
    ["emailed links", "AuthToken", { user_id: ids.arjun }],
    ["sign-in record", "User", { _id: ids.arjun }],
    ["sign-in record by address", "User", { email: emails.arjun }],
    ["photo", "Photo", { user_id: ids.arjun }],
  ]) expect(await count(model, filter), what).toBe(0);
  expect(await storedMessages(arjunBela.matchId)).toEqual([]); // the whole conversation, both sides
  expect(await count("Message", { body: { $regex: CANARY } })).toBe(0);

  // No session left behind: this browser is logged out, and a session copied before the deletion is dead.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  const copied = await page.context().browser().newContext();
  await copied.addCookies(cookiesBefore);
  const withOldCookie = await copied.newPage();
  await withOldCookie.goto("/dashboard");
  await expect(withOldCookie).toHaveURL(/\/login/);
  expect((await copied.request.get("/profile/photo", { maxRedirects: 0 })).status()).not.toBe(200);
  await copied.close();
  await login(page, emails.arjun);
  await expect(page.getByText("That email and password do not match an account.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  // Recorded for the admins without his name.
  const { AuditLog } = await db();
  const rows = (await AuditLog.find({ target_id: ids.arjun, action: /^accounts\./ }).lean()).map(({ action, metadata }) => ({ action, metadata }));
  expect(rows).toEqual([{ action: "accounts.deleted", metadata: { ref: refOf("U", ids.arjun), by: "self" } }]);
  expect(JSON.stringify(rows)).not.toContain("Arjun");
});

test("26. the person he was matched with simply no longer has that conversation", async () => {
  const page = pages.bela;
  await page.goto("/matches");
  await expect(visible(page.locator("main"))).toContainText("Chetan");
  await expect(visible(page.locator("main"))).not.toContainText("Arjun");
  await page.goto(`/matches/${arjunBela.conversation}`);
  await expect(visible(page.getByRole("heading", { level: 1 }))).not.toContainText("Arjun");
  await expect(page.getByText(CANARY)).toHaveCount(0);
});

test("26. a reported student's deletion is held — without telling him why — and his account keeps working", async () => {
  const page = pages.chetan;
  await page.goto("/account/delete");
  await page.getByLabel("Your current password").fill(PASSWORD);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page).toHaveURL(/\/account\/delete\?requested=1$/);
  await expect(page.getByRole("heading", { name: "Your request is waiting for an administrator" })).toBeVisible();
  const text = await visible(page.locator("main")).innerText();
  expect(text).toContain("Nothing has been deleted yet");
  expect(text).not.toMatch(/report/i); // a reported person is never told that they were reported
  expect(await count("Profile", { _id: ids.chetan })).toBe(1);
  expect(await count("Photo", { user_id: ids.chetan })).toBe(1);

  // Still a working account.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Hi, Chetan" })).toBeVisible();

  // He can change his mind, and ask again.
  await page.goto("/account/delete");
  await page.getByRole("button", { name: "Cancel my deletion request" }).click();
  await expect(page.getByText("Your deletion request has been cancelled. Nothing was deleted.")).toBeVisible();
  await expect(page.getByLabel("Your current password")).toBeVisible();
  await page.getByLabel("Your current password").fill(PASSWORD);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page.getByRole("heading", { name: "Your request is waiting for an administrator" })).toBeVisible();
});

test("26. only a Super Admin sees held requests; completing one erases the account but keeps the report", async () => {
  await pages.admin.goto("/admin/deletions");
  await expect(pages.admin).toHaveURL(/\/admin$/);

  const page = pages.root;
  await page.goto("/admin");
  await expect(visible(page.locator("dt", { hasText: /^Deletion requests$/ }).locator("xpath=following-sibling::dd[1]"))).toHaveText("1");
  await visible(page.getByRole("navigation", { name: "Admin" })).getByRole("link", { name: "Deletions" }).click();
  const row = visible(page.getByRole("row")).filter({ hasText: refOf("U", ids.chetan) });
  await expect(row).toContainText("Chetan");
  await expect(row).toContainText("1 undecided report");
  expect(await visible(page.locator("main")).innerText()).not.toContain(emails.chetan);

  await row.getByRole("button", { name: "Delete account" }).click();
  // Nothing happens until the second, explicit press.
  expect(await count("Profile", { _id: ids.chetan })).toBe(1);
  await row.getByRole("button", { name: `Yes, delete ${refOf("U", ids.chetan)} permanently` }).click();
  await expect(page.getByText("The account has been deleted. It is recorded in the activity log.")).toBeVisible();
  await expect(page.getByText("No requests are waiting")).toBeVisible();

  expect(await count("Profile", { _id: ids.chetan })).toBe(0);
  expect(await count("User", { _id: ids.chetan })).toBe(0);
  expect(await count("Session", { user_id: ids.chetan })).toBe(0);
  expect(await count("Photo", { user_id: ids.chetan })).toBe(0);
  expect(await count("Match", { _id: chetanBela.matchId })).toBe(0);

  // The evidence the moderators need is still there, no longer tied to an account.
  const { AuditLog, Report } = await db();
  const reports = await Report.find({ reporter_id: ids.bela }).lean();
  expect(reports).toMatchObject([{ reporter_id: ids.bela, reported_user_id: null, status: "open" }]);
  expect(reports[0].evidence).toHaveLength(1);
  await page.goto("/admin/reports");
  await expect(visible(page.getByRole("row")).filter({ hasText: "Bela" })).toContainText("Account deleted");

  const actions = (await AuditLog.find({ target_id: ids.chetan, action: /^accounts\./ }).sort({ seq: 1 }).lean()).map((entry) => ({ action: entry.action, actor_id: entry.actor_id, by: entry.metadata.by }));
  expect(actions.map((a) => a.action)).toEqual(["accounts.deletion_requested", "accounts.deletion_cancelled", "accounts.deletion_requested", "accounts.deleted"]);
  expect(actions.at(-1)).toMatchObject({ actor_id: ids.root, by: "admin" });
  await page.goto("/admin/activity");
  await expect(visible(page.locator("main"))).toContainText("Account deleted by a Super Admin, at the student’s request");
});

test("26. an account without a profile is deleted at once too, and the address can be registered again as a new, empty account", async () => {
  const page = pages.ghost; // registered and confirmed, never made a profile
  await page.goto("/account/delete");
  await page.getByLabel("Your current password").fill(PASSWORD);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page).toHaveURL(/\/goodbye$/);
  expect(await count("User", { _id: ids.ghost })).toBe(0);
  await login(page, emails.ghost);
  await expect(page.getByText("That email and password do not match an account.")).toBeVisible();

  // Nothing is left for an operator to clean up by hand.
  await pages.root.goto("/admin/deletions");
  await expect(pages.root.getByText("No requests are waiting")).toBeVisible();
  expect(await visible(pages.root.locator("main")).innerText()).not.toContain(ids.ghost);

  // The same address starts again from nothing: a new account, a new confirmation email, no old data.
  const mailsBefore = (await mailFor(emails.ghost)).length;
  await register(page, emails.ghost);
  expect((await mailFor(emails.ghost)).length).toBe(mailsBefore + 1);
  const again = await (await db()).User.findOne({ email: emails.ghost }).lean();
  expect(again._id).not.toBe(ids.ghost);
  expect(again).toMatchObject({ role: "student", email_confirmed_at: null });
});

test("26. staff accounts are not deleted from the self-service page", async () => {
  const page = pages.admin;
  await page.goto("/account/delete");
  await expect(page.getByText("Admin accounts cannot be deleted from here")).toBeVisible();
  await expect(page.getByLabel("Your current password")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete my account permanently" })).toHaveCount(0);
  expect(await count("User", { _id: ids.admin })).toBe(1);
});

test("26. a suspended student can still reach the deletion page; the request waits for a Super Admin", async () => {
  const root = pages.root;
  await root.goto(`/admin/students/${ids.bela}`);
  await root.getByRole("button", { name: "Suspend" }).click();
  const dialog = root.getByRole("dialog", { name: "Suspend Bela?" });
  await dialog.getByLabel("Reason").fill("Suspended for the deletion test.");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Confirm: suspend" }).click();
  await expect(root.getByText("Account suspended. It is recorded in the activity log.")).toBeVisible();

  const page = pages.bela;
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Your account is suspended" })).toBeVisible();
  await page.getByRole("link", { name: "ask for your account to be deleted" }).click();
  await expect(page).toHaveURL(/\/account\/delete$/);
  await page.getByLabel("Your current password").fill(PASSWORD);
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(page.getByRole("heading", { name: "Your request is waiting for an administrator" })).toBeVisible();
  expect(await count("Profile", { _id: ids.bela, status: "suspended" })).toBe(1);

  await pages.root.goto("/admin/deletions");
  await expect(visible(pages.root.getByRole("row")).filter({ hasText: refOf("U", ids.bela) })).toContainText("Suspended");
});

// ----------------------------------------------------------------------------- nothing leaks into the logs
test("the server log holds no password, token, email address, message or feedback text from this run", async () => {
  const { readFileSync } = await import("node:fs");
  const log = process.env.E2E_SERVER_LOG ? readFileSync(process.env.E2E_SERVER_LOG, "utf8") : null;
  test.skip(log === null, "E2E_SERVER_LOG is not set");
  for (const secret of [PASSWORD, NEW_PASSWORD, CANARY, emails.divya, emails.arjun, "mongodb://", "mongodb+srv://", "$2b$12$", "$2a$12$"]) expect(log, secret).not.toContain(secret);
  expect(log).not.toMatch(/token=[A-Za-z0-9_-]{43}/); // no confirmation or reset link
  for (const who of ["root", "guest", "bela"]) {
    for (const cookie of await pages[who].context().cookies()) if (cookie.name === "cpf_session") expect(log, `${who}'s session token`).not.toContain(cookie.value);
  }
  // The mail sink's own log is not the app's; the app logged nothing about who was mailed.
  expect(log).not.toMatch(/@e2e\.test/);
});
