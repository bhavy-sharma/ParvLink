// Phase 2 — event management and discovery, end to end. Numbers in test names
// refer to the acceptance criteria in the Phase 2 brief.
import { expect, test } from "@playwright/test";
import {
  bootstrapSuperAdmin,
  closeDb,
  createAccount,
  createStudent,
  db,
  eventRow,
  field,
  fillEventForm,
  localDateTime,
  login,
  logout,
  makeAdmin,
  photoWithGps,
  runTag,
  seedCollege,
  uniqueEmail,
  userId,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const collegeA = `Ruia College ${runTag}`;
const collegeB = `Mithibai College ${runTag}`;
const collegeC = `Wilson College ${runTag}`;
const colleges = {};

const dandiya = `Navratri Dandiya Night ${runTag}`;
const freshers = `Freshers Welcome ${runTag}`;
const fest = `Malhar Fest ${runTag}`;

const emails = {
  superAdmin: uniqueEmail("ev-root"),
  adminA: uniqueEmail("ev-admin-a"),
  viewOnly: uniqueEmail("ev-viewonly"),
  studentA: uniqueEmail("ev-arjun"),
  studentB: uniqueEmail("ev-bela"),
  studentC: uniqueEmail("ev-chirag"),
};
const pages = {};

test.beforeAll(async ({ browser }) => {
  colleges.a = await seedCollege(collegeA);
  colleges.b = await seedCollege(collegeB);
  colleges.c = await seedCollege(collegeC);
  for (const name of Object.keys(emails)) pages[name] = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  for (const page of Object.values(pages)) await page.context().close();
  await closeDb();
});

const eventsBase = "/admin/events";

test("set-up: a super admin, an events admin for college A, a view-only admin, and a student in each college", async () => {
  await createAccount(pages.superAdmin, emails.superAdmin);
  await bootstrapSuperAdmin(emails.superAdmin);
  await createAccount(pages.adminA, emails.adminA);
  await makeAdmin(emails.adminA, colleges.a, ["manage_events"]);
  await createAccount(pages.viewOnly, emails.viewOnly);
  await makeAdmin(emails.viewOnly, colleges.a, ["view_students"]);
  await createStudent(pages.studentA, { email: emails.studentA, firstName: "Arjun", college: collegeA });
  await createStudent(pages.studentB, { email: emails.studentB, firstName: "Bela", college: collegeB });
  await createStudent(pages.studentC, { email: emails.studentC, firstName: "Chirag", college: collegeC });
});

test("4. signed-out visitors and students cannot open any event-management page", async ({ request }) => {
  for (const path of [eventsBase, `${eventsBase}/new`, `${eventsBase}/3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b/edit`, "/events"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location).toContain("/login");
  }
  for (const path of [eventsBase, `${eventsBase}/new`]) {
    await pages.studentA.goto(path);
    await expect(pages.studentA).toHaveURL(/\/dashboard$/);
  }
  await expect(pages.studentA.getByRole("link", { name: "Admin" })).toHaveCount(0);
});

test("8. the create form rejects missing fields and invalid dates, and keeps what was typed", async () => {
  const page = pages.superAdmin;
  await page.goto(eventsBase);
  await expect(page.getByText("No events yet", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Create the first event" }).click();
  await expect(page.getByRole("heading", { name: "Create event" })).toBeVisible();

  await page.getByRole("button", { name: "Save as draft" }).click();
  for (const message of ["Enter the event title.", "Choose the type of event.", "Choose the host college.", "Describe the event in at least 20 characters.", "Enter the venue.", "Enter when the event starts.", "Enter when the event ends."]) {
    await expect(page.getByText(message)).toBeVisible();
  }

  await fillEventForm(page, {
    title: dandiya,
    host: collegeB,
    description: "Garba and dandiya on the main lawn. Come as a pair or find a partner here.",
    venue: "Main lawn",
    starts: localDateTime(10, "19:00"),
    ends: localDateTime(10, "18:00"),
    minimumAge: 16,
  });
  await field(page, `${collegeB} and selected colleges`).check();
  await field(page, collegeC, { exact: true }).check();
  await field(page, "2nd year").check();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("The event must end after it starts.")).toBeVisible();
  // choices survive the failed save
  await expect(field(page, `${collegeB} and selected colleges`)).toBeChecked();
  await expect(field(page, collegeC, { exact: true })).toBeChecked();
  await expect(field(page, collegeA, { exact: true })).not.toBeChecked();
  await expect(field(page, "2nd year")).toBeChecked();
  await field(page, `Only ${collegeB}`).check();
  await field(page, "2nd year").uncheck();
  await expect(page.getByText("The minimum age cannot be below 18.")).toBeVisible();
  await expect(field(page, "Event title")).toHaveValue(dandiya);
  await expect(field(page, "Event type").locator("option:checked")).toHaveText("Dandiya Night");
  await expect(field(page, "Host college", { exact: true }).locator("option:checked")).toContainText(collegeB);

  await fillEventForm(page, { type: null, starts: localDateTime(-3, "19:00"), ends: localDateTime(-3, "23:00"), minimumAge: 18 });
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("That time has already passed.")).toBeVisible();

  await fillEventForm(page, { type: null, starts: localDateTime(10, "19:00"), ends: localDateTime(10, "23:00") });
  await field(page, "Participation closes").fill(localDateTime(12, "10:00"));
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("Participation cannot close after the event ends.")).toBeVisible();
  expect(await eventRow(dandiya)).toBeNull();
});

test("1. a super admin creates an event for any college; it is saved as a draft and opens in preview", async () => {
  const page = pages.superAdmin;
  await field(page, "Participation closes").fill("");
  await field(page, "What students need").fill("College ID card.\nTraditional dress.");
  await page.getByRole("button", { name: "Save and preview" }).click();

  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\/preview$/);
  await expect(page.getByText("This is how the event will look to students once published.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: dandiya })).toBeVisible();
  await expect(page.getByText(`Hosted by ${collegeB}`)).toBeVisible();
  await expect(page.getByText("Main lawn", { exact: true })).toBeVisible();
  await expect(page.getByText("Traditional dress.")).toBeVisible();
  await expect(page.getByText(`Students of ${collegeB}.`)).toBeVisible();
  await expect(page.getByText("18 or older on the day of the event.")).toBeVisible();
  // E. the preview shows nothing internal
  const body = await page.locator("main").innerText();
  expect(body).not.toMatch(/created|last edited|draft/i);

  const row = await eventRow(dandiya);
  expect(row.status).toBe("draft");
  expect(row.college_id).toBe(colleges.b);
  expect(row.created_by).toBe(await userId(emails.superAdmin));
  expect(row.published_at).toBeNull();
  expect(row.slug).toMatch(/^navratri-dandiya-night-/);
});

test("5. a draft does not appear in student discovery, by list or by direct link", async () => {
  const { slug } = await eventRow(dandiya);
  const page = pages.studentB;
  await page.goto("/events");
  await expect(page.getByText("No events yet", { exact: true })).toBeVisible();
  await page.goto(`/events/${slug}`);
  await expect(page.getByRole("heading", { name: "We could not find that event" })).toBeVisible();
  await page.goto("/events?when=all");
  await expect(page.getByText(dandiya)).toHaveCount(0);
});

test("11. a replayed 'publish' request is refused for a student, an admin of another college, a view-only admin and a signed-out visitor", async ({ browser }) => {
  const page = pages.superAdmin;
  const { id } = await eventRow(dandiya);
  await page.goto(`${eventsBase}/${id}`);

  let captured;
  await page.route(`**${eventsBase}/${id}`, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      captured = { url: request.url(), headers: await request.allHeaders(), body: request.postDataBuffer() };
      return route.abort();
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "Publish event" }).click();
  await page.getByRole("button", { name: "Yes, publish" }).click();
  await expect.poll(() => captured).toBeTruthy();
  await page.unroute(`**${eventsBase}/${id}`);

  const replayAs = (context) => {
    const headers = Object.fromEntries(Object.entries(captured.headers).filter(([name]) => !name.startsWith(":") && !["cookie", "content-length", "host", "connection"].includes(name)));
    return context.request.post(captured.url, { headers, data: captured.body, maxRedirects: 0 });
  };

  const anonymous = await browser.newContext();
  for (const [who, context] of [
    ["student of the host college", pages.studentB.context()],
    ["events admin of another college", pages.adminA.context()],
    ["view-only admin", pages.viewOnly.context()],
    ["signed-out visitor", anonymous],
  ]) {
    const response = await replayAs(context);
    expect(response.status(), who).toBeLessThan(500);
    expect((await eventRow(dandiya)).status, `${who} must not be able to publish`).toBe("draft");
  }
  await anonymous.close();

  // Control: the same bytes with the super admin's session do publish it.
  expect((await replayAs(page.context())).ok()).toBe(true);
  expect((await eventRow(dandiya)).status).toBe("published");
});

test("D. publishing asks for confirmation and is shown on the event page", async () => {
  const page = pages.superAdmin;
  const { id } = await eventRow(dandiya);
  await page.goto(`${eventsBase}/${id}`);
  await expect(page.getByText("Currently").locator("..")).toContainText("Published");
  // Offered next steps for a published event, each needing a second press:
  await page.getByRole("button", { name: "Close to new participants" }).click();
  await expect(page.getByRole("button", { name: "Yes, close it" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await eventRow(dandiya)).status).toBe("published");
  await expect(page.getByRole("link", { name: /\/events\/navratri-dandiya-night-/ })).toBeVisible();
});

test("6. once published, students of the host college see it; other colleges do not", async () => {
  const { slug } = await eventRow(dandiya);

  const page = pages.studentB;
  await page.goto("/events");
  const card = page.getByRole("article").filter({ hasText: dandiya });
  await expect(card).toContainText("Dandiya Night");
  await expect(card).toContainText("Open");
  await expect(card).toContainText(`Hosted by ${collegeB}`);
  await expect(card).toContainText("Main lawn");
  await expect(card).toContainText("Garba and dandiya");
  await card.getByRole("link", { name: dandiya }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: dandiya })).toBeVisible();
  await expect(page.getByText("Open for participation until the event ends.")).toBeVisible();
  // also on the dashboard
  await page.goto("/dashboard");
  await expect(page.getByRole("article").filter({ hasText: dandiya })).toBeVisible();

  for (const outsider of [pages.studentA, pages.studentC]) {
    await outsider.goto("/events?when=all");
    await expect(outsider.getByText(dandiya)).toHaveCount(0);
    await outsider.goto(`/events/${slug}`);
    await expect(outsider.getByRole("heading", { name: "We could not find that event" })).toBeVisible();
  }
});

test("the student page explains what is missing before they can take part, and updates when it is fixed", async () => {
  const { slug } = await eventRow(dandiya);
  const page = pages.studentB;
  await page.goto(`/events/${slug}`);
  const panel = page.getByRole("region", { name: "Can you take part?" });
  await expect(panel).toContainText("Not yet. Here is why:");
  await expect(panel).toContainText("Add a profile photo.");
  await expect(panel).toContainText("Your college has not verified your profile yet.");

  await panel.getByRole("link", { name: "Add a photo" }).click();
  await field(page, "Choose a photo").setInputFiles({ name: "me.jpg", mimeType: "image/jpeg", buffer: await photoWithGps() });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo updated.")).toBeVisible();

  await page.goto(`/events/${slug}`);
  await expect(panel).toContainText("Yes. You meet every requirement.");
  await expect(panel.getByRole("link", { name: "Find Your Partner" })).toBeVisible();
});

test("2. an admin with 'Manage events' creates an event for their assigned college only", async () => {
  const page = pages.adminA;
  await page.goto("/admin");
  await page.getByRole("link", { name: "Manage events" }).click();
  await expect(page).toHaveURL(/\/admin\/events$/);
  await expect(page.getByText(`Events for ${collegeA}.`)).toBeVisible();
  await page.getByRole("link", { name: "Create the first event" }).click();
  await expect(page.getByRole("heading", { name: "Create event" })).toBeVisible();

  // Their only college is pre-selected, and no other college is offered as host.
  const hostOptions = await field(page, "Host college", { exact: true }).locator("option").allTextContents();
  expect(hostOptions.filter((text) => text !== "Choose a college")).toEqual([collegeA]);
  await expect(field(page, "Host college", { exact: true }).locator("option:checked")).toHaveText(collegeA);

  await fillEventForm(page, {
    title: freshers,
    type: "Freshers",
    description: "Welcome evening for the new batch, with a talent round in pairs.",
    venue: "Auditorium",
    starts: localDateTime(20, "17:00"),
    ends: localDateTime(20, "21:00"),
  });
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page).toHaveURL(/\/admin\/events\/[0-9a-f-]{36}\?saved=created$/);
  await expect(page.getByText("Draft saved. Preview it, then publish when it is ready.")).toBeVisible();

  const row = await eventRow(freshers);
  expect(row.college_id).toBe(colleges.a);
  expect(row.status).toBe("draft");
  expect(row.created_by).toBe(await userId(emails.adminA));
});

test("3. an admin cannot see or manage another college's events", async () => {
  const page = pages.adminA;
  const other = await eventRow(dandiya); // hosted by college B, published

  await page.goto(eventsBase);
  await expect(page.getByRole("row").filter({ hasText: freshers })).toBeVisible();
  await expect(page.getByText(dandiya)).toHaveCount(0);
  const collegeFilter = await field(page, "Host college", { exact: true }).locator("option").allTextContents();
  expect(collegeFilter).toEqual(["Any college", collegeA]);

  for (const path of ["", "/edit", "/preview"]) {
    await page.goto(`${eventsBase}/${other.id}${path}`);
    await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  }
  // a hand-made filter for the other college is ignored
  await page.goto(`${eventsBase}?college=${colleges.b}`);
  await expect(page.getByText(dandiya)).toHaveCount(0);
});

test("3. an admin assigned WITHOUT the events permission cannot manage events", async () => {
  const page = pages.viewOnly;
  const own = await eventRow(freshers); // their own college's draft
  await page.goto(eventsBase);
  await expect(page.getByText("You cannot manage events yet")).toBeVisible();
  await page.goto(`${eventsBase}/new`);
  await expect(page.getByText("No open college to host an event")).toBeVisible();
  for (const path of ["", "/edit", "/preview"]) {
    await page.goto(`${eventsBase}/${own.id}${path}`);
    await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  }
});

test("7 & 9. editing loads the saved event, and saves changes including eligibility settings", async () => {
  const page = pages.adminA;
  const { id } = await eventRow(freshers);
  await page.goto(`${eventsBase}/${id}`);
  await page.getByRole("link", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit event" })).toBeVisible();

  // loads what was saved
  await expect(field(page, "Event title")).toHaveValue(freshers);
  await expect(field(page, "Event type").locator("option:checked")).toHaveText("Freshers");
  await expect(field(page, "Venue")).toHaveValue("Auditorium");
  await expect(field(page, "Starts", { exact: true })).toHaveValue(localDateTime(20, "17:00"));
  await expect(field(page, "Ends", { exact: true })).toHaveValue(localDateTime(20, "21:00"));
  await expect(field(page, `Only ${collegeA}`)).toBeChecked();
  await expect(page.getByText("Fixed when the event was created.")).toBeVisible();

  // change content and eligibility
  await field(page, "Venue").fill("Open-air theatre");
  await field(page, "Minimum age").fill("19");
  await field(page, `${collegeA} and selected colleges`).check();
  await field(page, collegeB).check();
  await field(page, "Limit to courses").fill("B.Tech\nMBA");
  await field(page, "1st year").check();
  await field(page, "3rd year").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  const row = await eventRow(freshers);
  expect(row.venue).toBe("Open-air theatre");
  expect(row.minimum_age).toBe(19);
  expect(row.eligibility_rules).toEqual({
    colleges: { mode: "selected", ids: [colleges.a, colleges.b].sort() },
    courses: ["B.Tech", "MBA"],
    study_years: [1, 3],
  });

  // …and the form shows the saved settings when opened again
  await page.reload();
  await expect(field(page, `${collegeA} and selected colleges`)).toBeChecked();
  await expect(field(page, collegeB)).toBeChecked();
  await expect(field(page, collegeC)).not.toBeChecked();
  await expect(field(page, "Limit to courses")).toHaveValue("B.Tech\nMBA");
  await expect(field(page, "1st year")).toBeChecked();
  await expect(field(page, "2nd year")).not.toBeChecked();
  await expect(field(page, "3rd year")).toBeChecked();

  // invalid edits are refused
  await field(page, "Ends", { exact: true }).fill(localDateTime(19, "21:00"));
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("The event must end after it starts.")).toBeVisible();
  expect((await eventRow(freshers)).venue).toBe("Open-air theatre");
});

test("9. eligibility is shown to students, and an ineligible student is told why", async () => {
  const page = pages.adminA;
  const { id, slug } = await eventRow(freshers);
  await page.goto(`${eventsBase}/${id}`);
  await page.getByRole("button", { name: "Publish event" }).click();
  await page.getByRole("button", { name: "Yes, publish" }).click();
  await expect(page.getByText("Event published.")).toBeVisible();

  // Arjun: college A, B.Tech Computer Science, 2nd year, aged 20, no photo.
  const arjun = pages.studentA;
  await arjun.goto(`/events/${slug}`);
  const rules = arjun.getByRole("region", { name: "Who can take part" });
  await expect(rules).toContainText(`Students of ${collegeA} or ${collegeB}.`); // host first
  await expect(rules).toContainText("19 or older on the day of the event.");
  await expect(rules).toContainText("B.Tech or MBA.");
  await expect(rules).toContainText("1st year or 3rd year.");
  const panel = arjun.getByRole("region", { name: "Can you take part?" });
  await expect(panel).toContainText("Not yet. Here is why:");
  await expect(panel).toContainText("This event is limited to other years of study.");
  await expect(panel).toContainText("Add a profile photo.");
  await expect(panel).not.toContainText("limited to other courses"); // B.Tech matches

  // Bela (invited college B) sees it too; Chirag (college C, not invited) does not.
  await pages.studentB.goto("/events");
  await expect(pages.studentB.getByRole("article").filter({ hasText: freshers })).toContainText(`Hosted by ${collegeA}`);
  await pages.studentC.goto(`/events/${slug}`);
  await expect(pages.studentC.getByRole("heading", { name: "We could not find that event" })).toBeVisible();
  await pages.studentC.goto("/events?when=all");
  await expect(pages.studentC.getByText(freshers)).toHaveCount(0);
});

test("C. editing a published event warns that students already see it, and changes reach them", async () => {
  const page = pages.adminA;
  const { id, slug } = await eventRow(freshers);
  await page.goto(`${eventsBase}/${id}/edit`);
  await expect(page.getByText("Students can already see this event")).toBeVisible();
  await field(page, "3rd year").uncheck();
  await field(page, "2nd year").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved. Students see them straight away.")).toBeVisible();

  await pages.studentA.goto(`/events/${slug}`);
  await expect(pages.studentA.getByRole("region", { name: "Can you take part?" })).not.toContainText("other years of study");
});

test("A. the admin list supports search and filters", async () => {
  const page = pages.superAdmin;
  // a third event, left as a draft
  await page.goto(`${eventsBase}/new`);
  await fillEventForm(page, {
    title: fest,
    type: "College Fest",
    host: collegeA,
    description: "Three days of music, theatre and quizzes across the campus.",
    venue: "Whole campus",
    starts: localDateTime(40, "10:00"),
    ends: localDateTime(42, "22:00"),
  });
  await field(page, "All colleges").check();
  await page.getByRole("button", { name: "Save as draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();

  await page.goto(eventsBase);
  const rows = (title) => page.getByRole("row").filter({ hasText: title });
  for (const title of [dandiya, freshers, fest]) await expect(rows(title)).toBeVisible();
  await expect(rows(dandiya)).toContainText(collegeB);
  await expect(rows(dandiya)).toContainText("Published");
  await expect(rows(fest)).toContainText("Draft");

  await field(page, "Status").selectOption({ label: "Draft" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(rows(fest)).toBeVisible();
  await expect(rows(dandiya)).toHaveCount(0);

  await page.goto(`${eventsBase}?college=${colleges.b}`);
  await expect(rows(dandiya)).toBeVisible();
  await expect(rows(freshers)).toHaveCount(0);

  await page.goto(`${eventsBase}?type=freshers`);
  await expect(rows(freshers)).toBeVisible();
  await expect(rows(fest)).toHaveCount(0);

  await page.goto(eventsBase);
  await field(page, "Search by title").fill(`malhar FEST ${runTag}`);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(rows(fest)).toBeVisible();
  await expect(rows(dandiya)).toHaveCount(0);

  await page.goto(`${eventsBase}?q=100%25_no_such_event`);
  await expect(page.getByText("No events match those filters")).toBeVisible();
});

test("student discovery supports search and filters, and never lists drafts", async () => {
  const page = pages.studentB; // sees dandiya (own college) and freshers (invited); fest is a draft
  await page.goto("/events");
  const card = (title) => page.getByRole("article").filter({ hasText: title });
  await expect(card(dandiya)).toBeVisible();
  await expect(card(freshers)).toBeVisible();
  await expect(card(fest)).toHaveCount(0);

  await field(page, "Type").selectOption({ label: "Freshers" });
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(card(freshers)).toBeVisible();
  await expect(card(dandiya)).toHaveCount(0);

  await page.goto("/events?host=mine");
  await expect(card(dandiya)).toBeVisible();
  await expect(card(freshers)).toHaveCount(0);

  await page.goto("/events");
  await field(page, "Search events").fill("auditorium talent");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No events match those filters")).toBeVisible();
  await field(page, "Search events").fill("OPEN-AIR");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(card(freshers)).toBeVisible();

  await page.goto("/events?when=past");
  await expect(page.getByText("No events match those filters")).toBeVisible();
});

test("11. events outside a caller's role and colleges cannot be reached, changed or seen as drafts", async () => {
  // (Every write rule — forged status, created_by, moving an event to another
  // college, a student writing at all — is tested against the services in
  // tests/services/03-events.test.js. Here: what the pages do.)
  const b = await eventRow(dandiya);
  const draft = await eventRow(fest);
  const { Event } = await db();
  const before = await Event.countDocuments({});
  const missing = (page) => expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();

  // an events admin for college A, against college B's event
  for (const path of [`${eventsBase}/${b.id}`, `${eventsBase}/${b.id}/edit`]) {
    await pages.adminA.goto(path);
    await missing(pages.adminA);
  }
  // a student: no management pages at all, and drafts do not exist for them
  for (const path of [`${eventsBase}/${b.id}/edit`, `${eventsBase}/new`]) {
    await pages.studentB.goto(path);
    await expect(pages.studentB).toHaveURL(/\/dashboard$/);
  }
  for (const path of [`/events/${draft.slug}`, `/events/${draft.slug}/join`]) {
    await pages.studentB.goto(path);
    await expect(pages.studentB.getByRole("heading", { name: /We could not find that (event|page)/ }).filter({ visible: true })).toBeVisible();
    await expect(pages.studentB.getByText(fest)).toHaveCount(0);
  }

  expect(await Event.countDocuments({})).toBe(before);
  expect((await eventRow(dandiya)).status).toBe("published");
  expect((await eventRow(dandiya)).title).toBe(dandiya);
});

test("10 & D. closing an event stops new participation; students see it as closed", async () => {
  const page = pages.superAdmin;
  const { id, slug } = await eventRow(dandiya);
  await page.goto(`${eventsBase}/${id}`);
  await page.getByRole("button", { name: "Close to new participants" }).click();
  await expect(page.getByText("Nobody new can take part.")).toBeVisible();
  await page.getByRole("button", { name: "Yes, close it" }).click();
  await expect(page.getByText("Event closed to new participants.")).toBeVisible();
  expect((await eventRow(dandiya)).status).toBe("closed");

  const bela = pages.studentB;
  await bela.goto(`/events/${slug}`);
  await expect(bela.getByText("Closed to new participants by the organisers.")).toBeVisible();
  const panel = bela.getByRole("region", { name: "Can you take part?" });
  await expect(panel).toContainText("Not right now.");
  await expect(panel).toContainText("The organisers have closed this event to new participants.");
  await bela.goto("/events");
  await expect(bela.getByRole("article").filter({ hasText: dandiya })).toHaveCount(0); // default view: open and upcoming
  await bela.goto("/events?when=past");
  await expect(bela.getByRole("article").filter({ hasText: dandiya })).toContainText("Closed");

  // Going straight to the join page does not get round it: no form, and nothing is stored.
  const closedNotice = bela.getByText("The organisers have closed this event to new participants.").filter({ visible: true });
  await bela.goto(`/events/${slug}/join`);
  await expect(bela.getByText("You cannot take part in this event right now")).toBeVisible();
  await expect(closedNotice).toBeVisible();
  await expect(bela.getByRole("button", { name: "Continue" })).toHaveCount(0);
  const { EventParticipant } = await db();
  expect(await EventParticipant.countDocuments({ event_id: id })).toBe(0);

  // Re-opening works, and that reason is gone for the same student (control).
  await page.getByRole("button", { name: "Re-open event" }).click();
  await page.getByRole("button", { name: "Yes, re-open" }).click();
  await expect(page.getByText("Event re-opened.")).toBeVisible();
  expect((await eventRow(dandiya)).status).toBe("published");
  await bela.goto(`/events/${slug}/join`);
  await expect(bela.getByRole("heading", { name: "Find your partner" })).toBeVisible();
  await expect(closedNotice).toHaveCount(0);
});

test("10 & D. a completed event stays as a record, takes no participants and cannot be edited", async () => {
  const page = pages.superAdmin;
  const { id, slug } = await eventRow(dandiya);
  await page.goto(`${eventsBase}/${id}`);
  await page.getByRole("button", { name: "Mark as completed" }).click();
  await page.getByRole("button", { name: "Yes, mark completed" }).click();
  await expect(page.getByText("Event marked as completed.")).toBeVisible();
  await expect(page.getByText("Its status can no longer change.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0);

  await page.goto(`${eventsBase}/${id}/edit`);
  await expect(page.getByText("Completed events are kept as a record and can no longer be edited.")).toBeVisible();
  await expect(field(page, "Event title")).toBeDisabled();

  const bela = pages.studentB;
  await bela.goto(`/events/${slug}`);
  await expect(bela.getByText("This event is over. It stays here as a record.")).toBeVisible();
  await expect(bela.getByRole("region", { name: "Can you take part?" })).toContainText("This event is over.");
  await bela.goto("/events?when=past");
  await expect(bela.getByRole("article").filter({ hasText: dandiya })).toContainText("Completed");

  await bela.goto(`/events/${slug}/join`);
  await expect(bela.getByText("You cannot take part in this event right now")).toBeVisible();
  await expect(bela.getByRole("button", { name: "Continue" })).toHaveCount(0);
  const { EventParticipant } = await db();
  expect(await EventParticipant.countDocuments({ event_id: id })).toBe(0);
  expect(await eventRow(dandiya)).toMatchObject({ status: "completed", title: dandiya });
});

test("every event status change appears in the super admin's activity log", async () => {
  const page = pages.superAdmin;
  await page.goto("/admin");
  const activity = page.getByRole("list").filter({ hasText: "Event completed" });
  await expect(activity).toContainText("Event closed");
  await expect(activity).toContainText("Event published");
  await expect(activity).toContainText(dandiya);
});

test("revoking the events permission ends an admin's access on their next request", async () => {
  const { AdminCollegeAccess } = await db();
  await AdminCollegeAccess.updateOne({ admin_user_id: await userId(emails.adminA) }, { $set: { permissions: ["view_students"] } });
  const page = pages.adminA;
  const { id } = await eventRow(freshers);
  await page.goto(`${eventsBase}/${id}/edit`);
  await expect(page.getByRole("heading", { name: "We could not find that page" })).toBeVisible();
  await page.goto(eventsBase);
  await expect(page.getByText("You cannot manage events yet")).toBeVisible();
  await logout(page);
  await login(page, emails.adminA);
  await expect(page).toHaveURL(/\/admin$/);
});
