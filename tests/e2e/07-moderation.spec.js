// Phase 5 — admin dashboards, report handling, account moderation, analytics,
// the audit log and launch checks, in real browsers with several roles signed
// in at once. Numbers refer to the 22 cases in the Phase 5 brief.
// Service-level versions of the same rules: tests/services/06-moderation-analytics.
import { readFileSync } from "node:fs";
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
  makeMatch,
  PASSWORD,
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

const collegeA = `Xavier College ${runTag}`;
const collegeB = `Symbiosis College ${runTag}`;
const eventTitle = `Garba Gala ${runTag}`;
const secondTitle = `Tech Fest ${runTag}`;
const CANARY = `MODERATION-CANARY-${runTag}`;
const REASON = "Abusive messages to another student.";

const emails = {
  root: uniqueEmail("m-root"), // Super Admin
  mod: uniqueEmail("m-mod"), // college A: moderate_reports, view_students, manage_students
  viewer: uniqueEmail("m-viewer"), // college A: moderate_reports only
  adminB: uniqueEmail("m-adminb"), // college B: every permission
  kabir: uniqueEmail("m-kabir"), // student, college A, male — the one who gets reported
  leela: uniqueEmail("m-leela"), // student, college A, female
  mira: uniqueEmail("m-mira"), // student, college A, female
  nikhil: uniqueEmail("m-nikhil"), // student, college B
};
const pages = {};
const ids = {};
const colleges = {};
let event;
let second;
let kabirLeela;
let chatReportId;
let chatReportRef;

const stat = (scope, label) => scope.locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
const visible = (locator) => locator.filter({ visible: true });
const refOf = (prefix, id) => `${prefix}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
const auditRows = async (table, target) => {
  const { AuditLog } = await db();
  return (await AuditLog.find({ target_table: table, target_id: target }).sort({ seq: 1 }).lean()).map(({ actor_id, action, metadata }) => ({ actor_id, action, metadata }));
};
const profileStatus = async (id) => (await (await db()).Profile.findById(id).lean()).status;
const participations = async (id) =>
  (await (await db()).EventParticipant.find({ user_id: id }).sort({ event_id: 1 }).lean()).map(({ event_id, status }) => ({ event_id, status }));

test.beforeAll(async ({ browser }) => {
  colleges.a = await seedCollege(collegeA);
  colleges.b = await seedCollege(collegeB);
  event = await seedEvent(eventTitle, colleges.a);
  second = await seedEvent(secondTitle, colleges.a);
  for (const name of Object.keys(emails)) pages[name] = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  for (const page of Object.values(pages)) await page.context().close();
  await closeDb();
});

test("set-up: a Super Admin, three college admins, four students, two matches and two reports", async () => {
  test.setTimeout(180_000);
  for (const who of ["root", "mod", "viewer", "adminB"]) await createAccount(pages[who], emails[who]);
  await bootstrapSuperAdmin(emails.root);
  await makeAdmin(emails.mod, colleges.a, ["moderate_reports", "view_students", "manage_students"]);
  await makeAdmin(emails.viewer, colleges.a, ["moderate_reports"]);
  await makeAdmin(emails.adminB, colleges.b, ["moderate_reports", "view_students", "manage_students", "manage_events"]);
  for (const who of ["root", "mod", "viewer", "adminB"]) {
    await logout(pages[who]);
    await login(pages[who], emails[who]);
    await expect(pages[who]).toHaveURL(/\/admin$/);
  }

  for (const [who, firstName, college] of [["kabir", "Kabir", collegeA], ["leela", "Leela", collegeA], ["mira", "Mira", collegeA], ["nikhil", "Nikhil", collegeB]]) {
    await createStudent(pages[who], { email: emails[who], firstName, college });
    await uploadPhoto(pages[who]);
  }
  for (const who of Object.keys(emails)) ids[who] = await userId(emails[who]);

  const person = (who, gender) => ({ email: emails[who], gender, lookingFor: gender === "male" ? "female" : "male" });
  kabirLeela = await makeMatch(event, person("kabir", "male"), person("leela", "female"));
  await makeMatch(event, person("kabir", "male"), person("mira", "female"));
  // Kabir also joined the second event and then closed his profile there himself.
  const { EventParticipant, Report } = await db();
  await EventParticipant.create({ event_id: second.id, user_id: ids.kabir, looking_for: "female", status: "closed", closed_at: new Date() });

  // A conversation, and Mira's report of Kabir's profile.
  await storeMessage(kabirLeela.matchId, ids.kabir, `You are useless. ${CANARY}`);
  await storeMessage(kabirLeela.matchId, ids.leela, "Please stop messaging me.");
  await Report.create({ reporter_id: ids.mira, reported_user_id: ids.kabir, college_id: colleges.a, event_id: event.id, reason: "fake_profile", details: "Photo is not him.", open_key: `${ids.mira}|${ids.kabir}|${event.id}` });
});

test("4. a student files a report from the chat screen, sharing the messages", async () => {
  const page = pages.leela;
  await page.goto(`/matches/${kabirLeela.conversation}`);
  await visible(page.getByRole("button", { name: "Report user" })).click();
  const dialog = page.getByRole("dialog", { name: "Report Kabir" });
  await dialog.getByLabel("What is wrong?").selectOption({ label: "Harassment or abusive messages" });
  await dialog.getByLabel("What happened?").fill("He insults me in every message.");
  await dialog.getByLabel(/Share the last 20 messages/).check();
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("Report sent to the moderators. Thank you.")).toBeVisible();

  const { Report } = await db();
  const rows = await Report.find({ reporter_id: ids.leela }).lean();
  expect(rows).toMatchObject([{ status: "open", reported_user_id: ids.kabir, college_id: colleges.a }]);
  expect(rows[0].evidence).toHaveLength(2);
  chatReportId = rows[0]._id;
  chatReportRef = refOf("R", chatReportId);
});

test("1 & 15. Super Admin: the overview shows real, correctly counted numbers and links into the work", async () => {
  const page = pages.root;
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Admin" });
  for (const link of ["Overview", "Reports", "Students", "Events", "Analytics", "Activity", "Colleges", "Admins"]) await expect(nav.getByRole("link", { name: link, exact: true })).toBeVisible();

  // Platform-wide figures equal what is in the database right now.
  const { Match, Profile, Report, User } = await db();
  const truth = {
    students: await Profile.countDocuments({}),
    matches: await Match.countDocuments({}),
    pending: await Report.countDocuments({ status: "open" }),
    accounts: await User.countDocuments({}),
  };
  const number = async (label) => Number((await stat(page, label).first().innerText()).replace(/,/g, ""));
  expect(await number("Student profiles")).toBe(truth.students);
  expect(await number("Matches")).toBe(truth.matches);
  expect(await number("Pending reports")).toBe(truth.pending);
  expect(await number("Registered accounts")).toBe(truth.accounts);

  // Narrowed to college A: three students, three participations in two events… and TWO matches (pairs), not four.
  await page.getByLabel("College").selectOption({ label: collegeA });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/college=/);
  await expect(stat(page, "Student profiles")).toHaveText("3");
  await expect(stat(page, "Matches")).toHaveText("2");
  await expect(stat(page, "Participations")).toHaveText("4"); // Kabir ×2 events, Leela, Mira
  await expect(page.getByText("One per student per event. 3 different students.")).toBeVisible();
  await expect(stat(page, "Active discovery profiles")).toHaveText("3"); // Kabir's closed profile is not counted
  await expect(stat(page, "Interests sent")).toHaveText("4");
  await expect(stat(page, "Pending reports")).toHaveText("2");
  await expect(stat(page, "Submitted")).toHaveText("2");
  await expect(stat(page, "Published")).toHaveText("2");
  await expect(stat(page, "Registered accounts")).toHaveCount(0); // account totals are platform-wide only
  // Definitions are on the page, and what is not built is said, not faked.
  await expect(page.getByText("One per pair per event — not counted per person.")).toBeVisible();
  await expect(page.getByText("Verified-student counts are not shown because student verification is not built yet.")).toBeVisible();

  // A period: today includes everything created in this run; a past day includes nothing.
  await page.getByRole("link", { name: "Last 7 days" }).click();
  await expect(page.getByRole("heading", { name: "In the selected period" })).toBeVisible();
  await expect(stat(page, "Matches made")).toHaveText("2");
  await page.goto(`/admin?college=${colleges.a}&from=2020-01-01&to=2020-01-31`);
  await expect(stat(page, "Matches made")).toHaveText("0");
  await expect(stat(page, "Matches")).toHaveText("2"); // totals are not affected by the period
  // Nonsense in the URL is ignored rather than trusted or crashing.
  await page.goto(`/admin?college=not-a-college&from=31-12-2020&to=<script>`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(await number("Student profiles")).toBe(truth.students);

  // The card links into the filtered report list.
  await page.goto(`/admin?college=${colleges.a}`);
  await stat(page, "Pending reports").locator("xpath=ancestor::a").click();
  await expect(page).toHaveURL(/\/admin\/reports\?status=open&college=/);
  await expect(page.getByRole("table", { name: "Reports" }).getByRole("row")).toHaveCount(3); // header + 2
});

test("1, 15 & 19. analytics by college and by event; event management still works and shows the same numbers", async () => {
  const page = pages.root;
  await page.goto("/admin/analytics");
  const byCollege = page.getByRole("table", { name: "Numbers by college" });
  const rowA = byCollege.getByRole("row").filter({ hasText: collegeA });
  await expect(rowA.getByRole("cell")).toHaveText(["3", "0", "2", "0", "3", "4", "4", "2", "2", "0"]);
  const rowB = byCollege.getByRole("row").filter({ hasText: collegeB });
  await expect(rowB.getByRole("cell")).toHaveText(["1", "0", "0", "0", "0", "0", "0", "0", "0", "0"]);

  await page.getByLabel("Event title contains").fill(runTag);
  await page.getByRole("button", { name: "Apply" }).click();
  const byEvent = page.getByRole("table", { name: "Numbers by event (all time)" });
  await expect(byEvent.getByRole("row").filter({ hasText: eventTitle }).getByRole("cell")).toHaveText(["Published", "3", "3", "4", "2", "3", "2"]);
  await expect(byEvent.getByRole("row").filter({ hasText: secondTitle }).getByRole("cell")).toHaveText(["Published", "1", "0", "0", "0", "0", "0"]);
  await page.getByText("What these numbers mean").click();
  await expect(page.getByText("counted once per pair per event — never once per person")).toBeVisible();
  // No student is named anywhere on the page.
  const html = await page.content();
  for (const secret of ["Kabir", "Leela", "Mira", ids.kabir, emails.kabir, CANARY]) expect(html).not.toContain(secret);

  // 19. From the table into event management; the manage page shows the same counts.
  await byEvent.getByRole("link", { name: eventTitle }).click();
  await expect(page.getByRole("heading", { name: eventTitle })).toBeVisible();
  const numbers = page.getByRole("region", { name: "Partner finding so far" });
  await expect(stat(numbers, "Participants")).toHaveText("3");
  await expect(stat(numbers, "Matches")).toHaveText("2");
  await expect(stat(numbers, "Students matched")).toHaveText("3");
  // …and the Phase 2 controls are still there and still work (close, then re-open).
  await page.getByRole("button", { name: "Close to new participants" }).click();
  await page.getByRole("button", { name: /^Yes/ }).click();
  await expect(page.getByText("Currently").locator("..")).toContainText("Closed");
  await page.getByRole("button", { name: /Re-open/ }).click();
  await page.getByRole("button", { name: /^Yes/ }).click();
  await expect(page.getByText("Currently").locator("..")).toContainText("Published");
});

test("2 & 16. a college admin sees only assigned colleges, only what their permissions cover", async () => {
  const page = pages.viewer; // college A, moderate_reports only
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Your colleges" })).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: collegeA })).toContainText("Moderate reports");
  await expect(page.getByText(collegeB)).toHaveCount(0);
  await expect(stat(page, "Matches")).toHaveText("2");
  await expect(stat(page, "Pending reports")).toHaveText("2");
  await expect(page.getByText("Student numbers are not shown: your permissions do not include student profiles.")).toBeVisible();
  await expect(stat(page, "Student profiles")).toHaveCount(0);
  await expect(stat(page, "Registered accounts")).toHaveCount(0);

  const nav = page.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Reports" })).toBeVisible();
  for (const hidden of ["Students", "Colleges", "Admins"]) await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);

  // Asking for the other college in the URL changes nothing. (The services refuse the same
  // request however it is sent: tests/services/06-moderation-analytics.)
  await page.goto(`/admin?college=${colleges.b}`);
  await expect(stat(page, "Matches")).toHaveText("2");
  await page.goto(`/admin/analytics?college=${colleges.b}`);
  await expect(page.getByText(collegeB)).toHaveCount(0);

  // Analytics: one college row, student columns blank.
  await page.goto("/admin/analytics");
  const rows = page.getByRole("table", { name: "Numbers by college" }).getByRole("row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1).getByRole("cell")).toHaveText(["—", "—", "2", "0", "3", "4", "4", "2", "2", "0"]);
  // Pages outside their permissions send them back to their overview.
  for (const path of ["/admin/students", `/admin/students/${ids.kabir}`, "/admin/colleges", "/admin/admins"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/admin$/);
  }

  // The college B admin sees college B and nothing of A.
  const b = pages.adminB;
  await b.goto("/admin/reports");
  await expect(b.getByText("No reports", { exact: true })).toBeVisible();
  await b.goto("/admin/students");
  await expect(b.getByRole("table", { name: "Students" }).getByRole("row")).toHaveCount(2);
  await expect(b.getByRole("link", { name: "Nikhil" })).toBeVisible();
  await expect(b.getByText("Kabir")).toHaveCount(0);
  for (const path of [`/admin/students/${ids.kabir}`, `/admin/reports/${chatReportId}`]) {
    await b.goto(path);
    await expect(visible(b.getByRole("heading", { name: /We could not find that (student|report)/ })), path).toBeVisible();
  }
});

test("3 & 6. students cannot reach admin pages, data or actions — by URL, or by replaying an admin's request", async ({ browser }) => {
  const page = pages.mira;
  for (const path of ["/admin", "/admin/reports", `/admin/reports/${chatReportId}`, "/admin/students", `/admin/students/${ids.kabir}`, "/admin/analytics", "/admin/activity"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/dashboard$/);
    // The raw response carries none of the admin content either.
    const body = await (await page.request.get(path)).text();
    for (const secret of ["He insults me in every message.", chatReportRef, "Photo is not him.", CANARY, "Numbers by college"]) expect(body, `${path} ${secret}`).not.toContain(secret);
  }
  // Signed out: a real redirect to the login page.
  const anonymous = await browser.newContext();
  for (const path of ["/admin/reports", `/admin/reports/${chatReportId}`, "/admin/students", "/admin/analytics", "/admin/activity"]) {
    const response = await anonymous.request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location).toContain("/login");
  }

  // (That every admin service refuses a student, whatever is sent: tests/services/06-moderation-analytics.)

  // Replay: capture the moderator's "Start review" request, then send it with other people's cookies.
  const mod = pages.mod;
  await mod.goto(`/admin/reports/${chatReportId}`);
  let captured;
  await mod.route("**/admin/reports/**", async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      captured = { url: request.url(), headers: await request.allHeaders(), body: request.postDataBuffer() };
      return route.abort();
    }
    return route.continue();
  });
  await mod.getByRole("button", { name: "Start review" }).click();
  await expect.poll(() => captured).toBeTruthy();
  await mod.unroute("**/admin/reports/**");
  const replayAs = (context) => {
    const headers = Object.fromEntries(Object.entries(captured.headers).filter(([name]) => !name.startsWith(":") && !["cookie", "content-length", "host", "connection"].includes(name)));
    return context.request.post(captured.url, { headers, data: captured.body, maxRedirects: 0 });
  };
  const reportStatus = async () => (await (await db()).Report.findById(chatReportId).lean()).status;
  for (const [who, context] of [["reported student", pages.kabir.context()], ["reporter", pages.leela.context()], ["admin of another college", pages.adminB.context()], ["signed out", anonymous]]) {
    const response = await replayAs(context);
    expect(response.status(), who).toBeLessThan(500);
    expect(await reportStatus(), who).toBe("open");
  }
  expect(await auditRows("reports", chatReportId)).toEqual([]);
  await anonymous.close();
  // Control: the same replay with the moderator's own session does work.
  await replayAs(mod.context());
  expect(await reportStatus()).toBe("in_review");
});

test("5. a moderator finds reports with filters, search and paging links", async () => {
  const page = pages.mod;
  await page.goto("/admin/reports");
  const table = page.getByRole("table", { name: "Reports" });
  await expect(table.getByRole("row")).toHaveCount(3);
  const chatRow = table.getByRole("row").filter({ hasText: chatReportRef });
  await expect(chatRow).toContainText("Harassment or abuse");
  await expect(chatRow).toContainText("From a chat, messages shared");
  await expect(chatRow).toContainText("Under review");
  await expect(chatRow).toContainText(`Kabir (${refOf("U", ids.kabir)})`);
  await expect(chatRow).toContainText(`Leela (${refOf("U", ids.leela)})`);
  await expect(chatRow).toContainText(collegeA);
  await expect(chatRow).toContainText(eventTitle);
  await expect(chatRow.getByRole("cell").last()).toHaveText("You"); // assigned when the review was started
  await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
  // The list holds no report text, no shared message, no email.
  const html = await page.content();
  for (const secret of ["He insults me in every message.", "Photo is not him.", CANARY, emails.kabir, emails.leela]) expect(html).not.toContain(secret);

  const apply = async (fill) => {
    await page.goto("/admin/reports");
    await fill();
    await page.getByRole("button", { name: "Apply" }).click();
  };
  await apply(() => page.getByLabel("Status").selectOption({ label: "Pending" }));
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Fake profile");
  await apply(() => page.getByLabel("Category").selectOption({ label: "Harassment or abuse" }));
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText(chatReportRef);
  await apply(() => page.getByLabel("Assigned").selectOption({ label: "Unassigned" }));
  await expect(table).not.toContainText(chatReportRef);
  await apply(() => page.getByLabel("Reference or reported student").fill(chatReportRef));
  await expect(table.getByRole("row")).toHaveCount(2);
  await apply(() => page.getByLabel("Reference or reported student").fill("kab"));
  await expect(table.getByRole("row")).toHaveCount(3);
  await apply(() => page.getByLabel("Event").selectOption({ label: eventTitle }));
  await expect(table.getByRole("row")).toHaveCount(3);
  await apply(() => page.getByLabel("Submitted to").fill("2020-01-01"));
  await expect(page.getByText("No reports match these filters")).toBeVisible();
  await expect(page.getByRole("link", { name: "Clear" })).toBeVisible();
  await page.goto("/admin/reports?from=2026-05-02&to=2026-05-01");
  await expect(page.getByText("The start date is after the end date.")).toBeVisible();
  // Paging: more reports than one page (page size 20) would add links; with page=2 on two rows the list is simply empty.
  await page.goto("/admin/reports?page=2");
  await expect(page.getByText("No reports", { exact: true })).toBeVisible();
});

test("5, 6 & 18. report detail: context without private data; shared messages only on request, and the request is logged", async () => {
  const page = pages.mod;
  await page.goto("/admin/reports");
  await page.getByRole("link", { name: chatReportRef }).click();
  await expect(page.getByRole("heading", { name: `Report ${chatReportRef}` })).toBeVisible();
  const submitted = page.getByRole("region", { name: "What was reported" });
  await expect(submitted).toContainText("He insults me in every message.");
  await expect(submitted).toContainText(`Leela (${refOf("U", ids.leela)}), ${collegeA}`);
  await expect(submitted).toContainText(`${eventTitle} (Published)`);
  await expect(submitted).toContainText("Matched on");
  const account = page.getByRole("region", { name: "Reported account" });
  await expect(account).toContainText("Kabir");
  await expect(account).toContainText("Active");
  await expect(account).toContainText("2 reports about this student (2 not yet decided)");
  await expect(account.getByRole("link", { name: /^R-/ })).toHaveCount(1); // the other report about him
  await expect(account.getByRole("button", { name: "Suspend" })).toBeVisible();

  // Before asking: the messages are not in the page at all, and nothing is logged about them.
  const evidence = page.getByRole("region", { name: "Messages shared by the reporter" });
  await expect(evidence).toContainText("The reporter shared 2 messages");
  await expect(evidence).toContainText("each viewing is recorded");
  expect(await page.content()).not.toContain(CANARY);
  expect((await auditRows("reports", chatReportId)).filter((r) => r.action === "reports.evidence_viewed")).toEqual([]);

  await evidence.getByRole("button", { name: "Show shared messages" }).click();
  const shared = evidence.getByRole("list", { name: "Shared messages" }).getByRole("listitem");
  await expect(shared).toHaveCount(2);
  await expect(shared.first()).toContainText("Kabir (reported)");
  await expect(shared.first()).toContainText(CANARY);
  await expect(shared.last()).toContainText("Leela (reporter)");
  const views = (await auditRows("reports", chatReportId)).filter((r) => r.action === "reports.evidence_viewed");
  expect(views).toEqual([{ actor_id: ids.mod, action: "reports.evidence_viewed", metadata: { ref: chatReportRef, messages: 2 } }]);
  await expect(page.getByRole("region", { name: "History of this report" })).toContainText("Shared messages viewed");

  // No private fields of either student anywhere on the page; no route to the conversation.
  const html = await page.content();
  for (const secret of [emails.kabir, emails.leela, kabirLeela.conversation, kabirLeela.matchId]) expect(html).not.toContain(secret);
  await expect(page.getByRole("link", { name: /chat|conversation|messages/i })).toHaveCount(0);
  // The conversation itself does not exist for a moderator — or for the Super Admin: page and live stream alike.
  for (const staff of [pages.mod, pages.root]) {
    const body = await (await staff.context().request.get(`/matches/${kabirLeela.conversation}`)).text();
    expect(body).not.toContain(CANARY);
    expect(body).not.toContain("Please stop messaging me.");
    expect((await staff.context().request.get(`/matches/${kabirLeela.conversation}/events`)).status()).toBe(404);
  }

  // Another moderator of the same college may look too (and is logged separately); nobody else may.
  const viewer = pages.viewer;
  await viewer.goto(`/admin/reports/${chatReportId}`);
  const theirs = viewer.getByRole("region", { name: "Messages shared by the reporter" });
  await theirs.getByRole("button", { name: "Show shared messages" }).click();
  await expect(theirs.getByRole("list", { name: "Shared messages" }).getByRole("listitem")).toHaveCount(2);
  await pages.adminB.goto(`/admin/reports/${chatReportId}`);
  await expect(visible(pages.adminB.getByRole("heading", { name: "We could not find that report" }))).toBeVisible();
  expect(await pages.adminB.content()).not.toContain(CANARY);
  expect((await auditRows("reports", chatReportId)).filter((r) => r.action === "reports.evidence_viewed").map((r) => r.actor_id)).toEqual([ids.mod, ids.viewer]);
});

test("7 & 8. the report workflow: note, resolve with a required reason, re-open — each step in the audit log under the real actor", async () => {
  const page = pages.mod;
  await page.goto(`/admin/reports/${chatReportId}`);
  // Internal note.
  await page.getByLabel("Add an internal note").fill("Spoke to Leela by phone; she confirmed.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Note added.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Internal notes" }).getByRole("listitem")).toContainText(["Spoke to Leela by phone; she confirmed."]);
  await expect(page.getByLabel("Add an internal note")).toHaveValue("");

  // Resolve: the dialog names the report and needs a reason.
  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Resolve report ${chatReportRef}?` });
  await expect(dialog).toContainText(`Report ${chatReportRef} will be marked Resolved`);
  await dialog.getByLabel("Reason for this decision").fill("short");
  await dialog.getByRole("button", { name: "Resolve report" }).click();
  await expect(dialog.getByText("Write a short reason for this decision (at least 10 characters).")).toBeVisible();
  await dialog.getByLabel("Reason for this decision").fill("Confirmed abusive messages; account suspended for a week.");
  await dialog.getByRole("button", { name: "Resolve report" }).click();
  await expect(page.getByText("Report resolved.")).toBeVisible();
  const status = page.getByRole("region", { name: "Status" });
  await expect(status).toContainText("Resolved on");
  await expect(status).toContainText("Confirmed abusive messages; account suspended for a week.");
  await expect(status.getByRole("button", { name: "Resolve", exact: true })).toHaveCount(0);

  // Re-open (also needs a reason), as the Super Admin.
  const root = pages.root;
  await root.goto(`/admin/reports/${chatReportId}`);
  await root.getByRole("button", { name: "Re-open" }).click();
  const reopen = root.getByRole("dialog", { name: `Re-open report ${chatReportRef}?` });
  await reopen.getByLabel("Reason for this decision").fill("The reporter sent more information.");
  await reopen.getByRole("button", { name: "Re-open report" }).click();
  await expect(root.getByText("Report is now under review")).toBeVisible();

  // 8. The log: who did what, in order — the actor is the session's user each time.
  const log = (await auditRows("reports", chatReportId)).filter((r) => r.action !== "reports.evidence_viewed");
  expect(log.map((r) => [r.actor_id, r.action, r.metadata.to ?? null])).toEqual([
    [ids.mod, "reports.status_changed", "in_review"],
    [ids.mod, "reports.note_added", null],
    [ids.mod, "reports.status_changed", "resolved"],
    [ids.root, "reports.status_changed", "in_review"],
  ]);
  expect(JSON.stringify(log)).not.toContain("Spoke to Leela"); // the note's text is not in the log
  const { Report } = await db();
  expect(await Report.findById(chatReportId).lean()).toMatchObject({ status: "in_review", resolved_at: null, assigned_to: ids.mod, details: "He insults me in every message." });

  // The moderator's page shows the Super Admin's step without naming them.
  await page.reload();
  const history = page.getByRole("list", { name: "Report history" });
  await expect(history).toContainText("Report moved from Resolved to Under review");
  await expect(history).toContainText("A Super Admin");
  expect(await page.content()).not.toContain(emails.root);

  // A moderator without "Manage students" can decide reports but is not offered account actions.
  const viewer = pages.viewer;
  await viewer.goto(`/admin/reports/${chatReportId}`);
  const account = viewer.getByRole("region", { name: "Reported account" });
  await expect(account).toContainText("needs the “Manage students” permission");
  await expect(account.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await expect(account.getByRole("link", { name: "Open student summary" })).toHaveCount(0);
});

test("9, 10 & 11. suspending from a report: reason and confirmation required; the student is locked out everywhere", async () => {
  const page = pages.mod;
  await page.goto(`/admin/reports/${chatReportId}`);
  await page.getByRole("region", { name: "Reported account" }).getByRole("button", { name: "Suspend" }).click();
  const dialog = page.getByRole("dialog", { name: "Suspend Kabir?" });
  await expect(dialog).toContainText("not your reason");
  // No reason → cannot continue.
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByText("Write a reason (at least 10 characters). It is kept in the activity log.")).toBeVisible();
  await dialog.getByLabel("How long").selectOption({ label: "7 days" });
  await dialog.getByLabel("Reason").fill(REASON);
  await dialog.getByRole("button", { name: "Continue" }).click();
  // Confirmation step: target, action, reason.
  await expect(dialog).toContainText("Check before you confirm");
  await expect(dialog).toContainText(`Kabir (${refOf("U", ids.kabir)})`);
  await expect(dialog).toContainText("Suspend for 7 days");
  await expect(dialog).toContainText(REASON);
  expect(await profileStatus(ids.kabir)).toBe("active"); // nothing has happened yet
  await dialog.getByRole("button", { name: "Confirm: suspend" }).click();
  await expect(page.getByText("Account suspended. It is recorded in the activity log.")).toBeVisible();
  const account = page.getByRole("region", { name: "Reported account" });
  await expect(account).toContainText("Suspended");
  await expect(account).toContainText("follows report " + chatReportRef);
  await expect(account.getByRole("button", { name: "Restore account" })).toBeVisible();
  expect(await profileStatus(ids.kabir)).toBe("suspended");
  const [entry] = await auditRows("profiles", ids.kabir);
  expect(entry).toMatchObject({ actor_id: ids.mod, action: "profiles.suspend", metadata: { reason: REASON, days: 7, report_ref: chatReportRef, ref: refOf("U", ids.kabir) } });

  // What Kabir sees: one notice on every page, with the end date — and not the reason.
  const kabir = pages.kabir;
  for (const path of ["/dashboard", "/events", `/events/${event.slug}/partners`, "/matches", `/matches/${kabirLeela.conversation}`, "/profile"]) {
    await kabir.goto(path);
    await expect(visible(kabir.getByRole("heading", { name: "Your account is suspended" })), path).toBeVisible();
    await expect(visible(kabir.getByText(/suspended your account until/))).toBeVisible();
    const html = await kabir.content();
    for (const secret of [REASON, chatReportRef, "Leela", CANARY]) expect(html, `${path} ${secret}`).not.toContain(secret);
  }
  await expect(kabir.getByRole("navigation", { name: "Main" })).toHaveCount(0);

  // Every other address with his own session is shut too: photos, live stream, even a page he had open.
  // (The services refuse a suspended account whatever is sent: tests/services/05-chat and 06-moderation-analytics.)
  const { EventParticipant } = await db();
  const miraHandle = (await EventParticipant.findOne({ event_id: event.id, user_id: ids.mira }).lean()).public_id;
  const photo = await kabir.request.get(`/events/${event.slug}/partners/photo/${miraHandle}`);
  expect(photo.status()).toBe(404);
  expect((await kabir.request.get(`/matches/${kabirLeela.conversation}/events`)).status()).toBe(404);
  expect((await storedMessages(kabirLeela.matchId))).toHaveLength(2);

  // The other side: Leela no longer discovers him; their chat is read-only, history kept.
  const leela = pages.leela;
  await leela.goto(`/events/${event.slug}/partners`);
  await expect(leela.getByRole("region", { name: "Students you can partner with" }).getByText("Kabir")).toHaveCount(0);
  await leela.goto(`/matches/${kabirLeela.conversation}`);
  await expect(visible(leela.getByText("Messaging is unavailable in this conversation."))).toBeVisible();
  await expect(visible(leela.getByRole("log", { name: "Messages" })).locator("li[data-seq]")).toHaveCount(2);
  expect(await (await db()).Match.countDocuments({ event_id: event.id })).toBe(2);
});

test("12 & 21. restoring from the Students screen gives back what was there; a profile the student had closed stays closed", async () => {
  const page = pages.mod;
  await page.goto("/admin/students");
  const table = page.getByRole("table", { name: "Students" });
  await expect(table.getByRole("row")).toHaveCount(4); // header + Kabir, Leela, Mira
  const row = table.getByRole("row").filter({ hasText: "Kabir" });
  await expect(row).toContainText("Suspended");
  await expect(row).toContainText("until");
  await expect(row.getByRole("cell").nth(3)).toHaveText("2"); // undecided reports about him (mod also moderates reports)
  // Filters and search.
  await page.getByLabel("Standing").selectOption({ label: "Suspended" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(table.getByRole("row")).toHaveCount(2);
  await page.goto("/admin/students?q=le");
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Leela");
  await page.goto(`/admin/students?q=${refOf("U", ids.kabir)}`);
  await page.getByRole("link", { name: "Kabir" }).click();

  await expect(page.getByRole("heading", { name: "Kabir", level: 1 })).toBeVisible();
  await expect(page.getByText("This account is suspended")).toBeVisible();
  const participation = page.getByRole("region", { name: "Participation" });
  await expect(stat(participation, "Events joined")).toHaveText("2");
  await expect(stat(participation, "Matches")).toHaveText("2");
  await expect(participation).toContainText(`${secondTitle}`);
  await expect(participation).toContainText("profile closed by the student");
  await expect(participation).toContainText("Who the student matched with, their partner preference and their conversations are not available to admins.");
  await expect(page.getByRole("list", { name: "Account moderation history" })).toContainText("Suspended");
  await expect(page.getByRole("list", { name: "Account moderation history" })).toContainText(REASON);
  const html = await page.content();
  for (const secret of [emails.kabir, "Leela", "Mira", CANARY, "female"]) expect(html).not.toContain(secret);

  const before = await participations(ids.kabir);
  await page.getByRole("button", { name: "Restore account" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore Kabir?" });
  await expect(dialog).toContainText("Profiles they had closed themselves stay closed.");
  await dialog.getByRole("button", { name: "Continue" }).click(); // a reason is optional here
  await expect(dialog).toContainText("None given");
  await dialog.getByRole("button", { name: "Confirm: restore" }).click();
  await expect(page.getByText("Account restored.")).toBeVisible();
  await expect(page.getByText("This account is suspended")).toHaveCount(0);
  expect(await profileStatus(ids.kabir)).toBe("active");

  // 12. Participation rows are exactly as before: open stays open, closed stays closed.
  expect(await participations(ids.kabir)).toEqual(before);
  expect(before.find((r) => r.event_id === second.id).status).toBe("closed");
  // 21. Kabir is back: the app works, his conversation is there, and chat with blocking behaves as before.
  const kabir = pages.kabir;
  await kabir.goto("/dashboard");
  await expect(kabir.getByRole("heading", { name: "Hi, Kabir" })).toBeVisible();
  await kabir.goto(`/matches/${kabirLeela.conversation}`);
  await visible(kabir.getByRole("textbox", { name: "Message to Leela" })).fill("I am sorry about before.");
  await visible(kabir.getByRole("button", { name: "Send message" })).click();
  await expect(visible(kabir.getByRole("log", { name: "Messages" })).locator("li[data-seq]")).toHaveCount(3);
  await expect(visible(pages.leela.getByRole("log", { name: "Messages" })).locator("li[data-seq]")).toHaveCount(3, { timeout: 20_000 }); // arrives live on Leela's open chat
  // In the second event his profile is still closed.
  await kabir.goto(`/events/${second.slug}/partners`);
  await expect(kabir.getByRole("region", { name: "Your profile for this event" })).toContainText("Closed");
});

test("a suspension with an end date lifts itself; marking 'under review' restricts nothing and is not shown to the student", async () => {
  const root = pages.root;
  await root.goto(`/admin/students/${ids.mira}`);
  await root.getByRole("button", { name: "Suspend" }).click();
  const suspendDialog = root.getByRole("dialog", { name: "Suspend Mira?" });
  await suspendDialog.getByLabel("How long").selectOption({ label: "7 days" });
  await suspendDialog.getByLabel("Reason").fill("Short cooling-off period.");
  await suspendDialog.getByRole("button", { name: "Continue" }).click();
  await suspendDialog.getByRole("button", { name: "Confirm: suspend" }).click();
  await expect(root.getByText("Account suspended. It is recorded in the activity log.")).toBeVisible();
  const mira = pages.mira;
  await mira.goto("/dashboard");
  await expect(visible(mira.getByRole("heading", { name: "Your account is suspended" }))).toBeVisible();
  // …and then the end date passes.
  const { AccountModeration } = await db();
  await AccountModeration.updateOne({ _id: ids.mira }, { $set: { suspended_at: new Date(Date.now() - 2 * 86400000), suspended_until: new Date(Date.now() - 60000) } });
  await mira.goto("/matches");
  await expect(mira).toHaveURL(/\/dashboard$/);
  await expect(mira.getByRole("heading", { name: "Hi, Mira" })).toBeVisible();
  const log = await auditRows("profiles", ids.mira);
  expect(log.map((r) => [r.actor_id, r.action, r.metadata.automatic ?? false])).toEqual([[ids.root, "profiles.suspend", false], [null, "profiles.restore", true]]);

  // Under review, through the UI.
  const page = pages.mod;
  await page.goto(`/admin/students/${ids.mira}`);
  await page.getByRole("button", { name: "Mark as under review" }).click();
  const dialog = page.getByRole("dialog", { name: "Mark Mira as under review?" });
  await dialog.getByLabel("Reason").fill("Second suspension this term; keep an eye on it.");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Confirm: mark as under review" }).click();
  await expect(page.getByText("Account marked as under review.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove review flag" })).toBeVisible();
  await page.goto("/admin/students?status=under_review");
  await expect(page.getByRole("table", { name: "Students" }).getByRole("row")).toHaveCount(2);
  await mira.goto("/dashboard");
  await expect(mira.getByRole("heading", { name: "Hi, Mira" })).toBeVisible();
  expect(await mira.content()).not.toMatch(/under review/i);
  expect(await profileStatus(ids.mira)).toBe("active");
});

test("13, 14 & 16. scope and privilege: no acting on other colleges, on yourself, on staff, or on your own permissions", async () => {
  // (Each refusal, for any request: tests/services/02-roles-colleges-profiles and 06-moderation-analytics.
  // Here: what the screens offer.)
  const missing = (page) => expect(visible(page.getByRole("heading", { name: "We could not find that student" }))).toBeVisible();

  // 13. Other colleges, or the right college without the permission.
  await pages.mod.goto(`/admin/students/${ids.nikhil}`); // a college B student
  await missing(pages.mod);
  await pages.adminB.goto(`/admin/students/${ids.leela}`); // a college A student
  await missing(pages.adminB);
  await pages.viewer.goto(`/admin/students/${ids.leela}`); // right college, no student permission
  await expect(pages.viewer).toHaveURL(/\/admin$/);
  for (const id of [ids.nikhil, ids.leela]) expect(await profileStatus(id)).toBe("active");

  // 14. Roles and assignments: a college admin has no screen for them, and nothing has changed for this one.
  for (const path of ["/admin/admins", "/admin/colleges"]) {
    await pages.mod.goto(path);
    await expect(pages.mod).toHaveURL(/\/admin$/);
  }
  const { AdminCollegeAccess, Profile, User } = await db();
  expect((await User.findById(ids.mod).lean()).role).toBe("admin");
  const access = await AdminCollegeAccess.find({ admin_user_id: ids.mod }).lean();
  expect(access).toHaveLength(1);
  expect([...access[0].permissions]).toEqual(["moderate_reports", "view_students", "manage_students"]);

  // Staff: a college admin cannot act on another admin; nobody suspends a Super Admin, including themselves.
  const staffProfile = (id, firstName) => ({ _id: id, first_name: firstName, first_name_lower: firstName.toLowerCase(), college_id: colleges.a, course: "M.A. English", study_year: 1 });
  await Profile.create([staffProfile(ids.viewer, "Viewer"), staffProfile(ids.root, "Root")]);
  for (const id of [ids.viewer, ids.root]) {
    await pages.mod.goto(`/admin/students/${id}`);
    await expect(pages.mod.getByText("This account holds an admin role. Only a Super Admin can act on it.")).toBeVisible();
    await expect(pages.mod.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  }
  await pages.root.goto(`/admin/students/${ids.root}`);
  await expect(pages.root.getByRole("heading", { name: "Root", level: 1 })).toBeVisible();
  await expect(pages.root.getByRole("button", { name: "Suspend" })).toHaveCount(0);
  await Profile.deleteMany({ _id: { $in: [ids.viewer, ids.root] } });
});

test("8, 16 & 17. the activity log: scoped per admin, complete for the Super Admin, and not editable by anyone", async () => {
  // The moderator of college A: reports and account moderation of that college, by "you" / "A Super Admin".
  const page = pages.mod;
  await page.goto("/admin/activity");
  const list = page.getByRole("list").filter({ hasText: "Suspended" });
  await expect(list).toContainText("Report moved from Pending to Under review");
  await expect(list).toContainText(`(${chatReportRef}) by you`);
  await expect(list).toContainText("Shared messages viewed");
  await expect(list).toContainText(`Suspended: ${collegeA} (${refOf("U", ids.kabir)}) by you`);
  await expect(list).toContainText(`Reason: ${REASON}`);
  await expect(list).toContainText("Suspension ended");
  await expect(list).toContainText("by another admin"); // the Super Admin's and the other moderator's steps, unnamed
  const html = await page.content();
  for (const secret of [emails.root, emails.viewer, "Admin role granted", "College assigned to an admin", collegeB, CANARY, "Spoke to Leela"]) expect(html).not.toContain(secret);
  // Filter by kind.
  await page.getByLabel("About").selectOption({ label: "Student accounts" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Report moved from")).toHaveCount(0);
  await expect(page.getByText("Restored").first()).toBeVisible();
  await expect(page.getByLabel("About").locator("option")).toHaveText(["Everything", "Reports", "Student accounts", "Events"]);

  // The Super Admin sees everything, with admins' emails.
  const root = pages.root;
  await root.goto("/admin/activity?category=reports");
  await expect(visible(root.getByRole("list")).filter({ hasText: "Report moved" })).toContainText(`by ${emails.mod}`);
  await root.goto("/admin/activity?category=admin_college_access");
  await expect(root.getByText("College assigned to an admin").first()).toBeVisible();
  await expect(root.getByText("Showing 1–")).toBeVisible();
  // Paging through the log works on the server.
  await root.goto("/admin/activity");
  await root.getByRole("link", { name: "Next" }).click();
  await expect(root).toHaveURL(/page=2/);
  await expect(root.getByText(/Showing 21–/)).toBeVisible();

  // Another college's admin sees none of it.
  await pages.adminB.goto("/admin/activity");
  const other = await pages.adminB.content();
  for (const secret of [chatReportRef, refOf("U", ids.kabir), REASON, collegeA]) expect(other).not.toContain(secret);
  // Nothing in the app edits or removes an entry (the model itself refuses: tests/services/06-moderation-analytics).
  await expect(root.getByRole("button", { name: /edit|delete|remove/i })).toHaveCount(0);
  expect((await auditRows("reports", chatReportId)).length).toBeGreaterThanOrEqual(6);
});

test("18. private chat text is nowhere it should not be: analytics, audit log, server logs", async () => {
  // In the database: only in messages and in the one report it was attached to.
  const { AuditLog, Report, ReportNote } = await db();
  const holds = (documents) => documents.filter((document) => JSON.stringify(document).includes(CANARY)).length;
  expect({
    audit: holds(await AuditLog.find({}).lean()),
    notes: holds(await ReportNote.find({}).lean()),
    details: holds(await Report.find({}).select("details resolution_note").lean()),
    evidence: holds(await Report.find({}).select("evidence").lean()),
  }).toEqual({ audit: 0, notes: 0, details: 0, evidence: 1 });
  // In every admin page a Super Admin can open (except the evidence, which needs a click).
  const page = pages.root;
  for (const path of ["/admin", "/admin/analytics", "/admin/activity", "/admin/reports", `/admin/reports/${chatReportId}`, "/admin/students", `/admin/students/${ids.kabir}`, `/admin/events/${event.id}`]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    expect(await page.content(), path).not.toContain(CANARY);
  }
  // In the application server's log (written by scripts/test-e2e-local.sh).
  test.skip(!process.env.E2E_SERVER_LOG, "E2E_SERVER_LOG is not set; the server-log check needs scripts/test-e2e-local.sh");
  const log = readFileSync(process.env.E2E_SERVER_LOG, "utf8");
  for (const secret of [CANARY, "He insults me in every message.", "Spoke to Leela", REASON, emails.kabir, PASSWORD, "mongodb://", "mongodb+srv://"]) expect(log, secret).not.toContain(secret);
  expect(log).not.toMatch(/token=[A-Za-z0-9_-]{43}/); // no emailed link
  for (const cookie of await pages.root.context().cookies()) if (cookie.name === "cpf_session") expect(log).not.toContain(cookie.value);
});

test("launch checks: health endpoint says nothing but 'ok'; admin screens fit a phone", async ({ browser, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: "ok" });
  expect(health.headers()["cache-control"]).toBe("no-store");
  expect((await request.post("/api/health")).status()).toBe(405);

  const context = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await login(page, emails.mod);
  await expect(page).toHaveURL(/\/admin$/);
  for (const path of ["/admin", "/admin/reports", `/admin/reports/${chatReportId}`, "/admin/students", `/admin/students/${ids.kabir}`, "/admin/analytics", "/admin/activity"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} must not scroll sideways`).toBeLessThanOrEqual(0); // wide tables scroll inside their own frame
  }
  if (process.env.E2E_SHOTS_DIR) {
    await page.goto("/admin/reports");
    await expect(page.getByRole("table", { name: "Reports" })).toBeVisible();
    await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/admin-mobile.png`, fullPage: true });
  }
  await context.close();

  if (process.env.E2E_SHOTS_DIR) {
    const shots = [["/admin", "admin-overview", pages.root], [`/admin/reports/${chatReportId}`, "admin-report", pages.mod], ["/admin/reports", "admin-reports", pages.mod], ["/admin/analytics", "admin-analytics", pages.root], [`/admin/students/${ids.kabir}`, "admin-student", pages.mod], ["/admin/activity", "admin-activity", pages.mod]];
    for (const [path, name, shooter] of shots) {
      await shooter.setViewportSize({ width: 1280, height: 900 });
      await shooter.goto(path);
      await expect(shooter.getByRole("navigation", { name: "Admin" })).toBeVisible();
      await expect(shooter.locator("main h1").filter({ visible: true }).first()).toBeVisible();
      await shooter.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/${name}.png`, fullPage: true });
    }
  }
});
