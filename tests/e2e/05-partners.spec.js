// Phase 3 — find your partner: joining, discovery, interest, mutual match,
// closing a profile per event, blocking and reporting. Numbers refer to the
// 20 scenarios in the Phase 3 brief.
import { expect, test } from "@playwright/test";
import {
  closeDb,
  createStudent,
  db,
  field,
  handleOf,
  joinEvent,
  partnerCounts,
  runTag,
  seedCollege,
  seedEvent,
  uniqueEmail,
  uploadPhoto,
  userId,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const collegeA = `Podar College ${runTag}`;
const collegeB = `Jai Hind College ${runTag}`;
const collegeC = `Khalsa College ${runTag}`;
const colleges = {};
const ev = {}; // main: A + B invited · other: A only · seniors: A, 4th years only

const emails = {
  aman: uniqueEmail("p-aman"), // college A, male
  bina: uniqueEmail("p-bina"), // college B, female
  chitra: uniqueEmail("p-chitra"), // college A, female
  dev: uniqueEmail("p-dev"), // college C — invited to nothing here
};
const pages = {};

test.beforeAll(async ({ browser }) => {
  colleges.a = await seedCollege(collegeA);
  colleges.b = await seedCollege(collegeB);
  colleges.c = await seedCollege(collegeC);
  ev.main = await seedEvent(`Dandiya Finals ${runTag}`, colleges.a, { colleges: { mode: "selected", ids: [colleges.b] } });
  ev.other = await seedEvent(`Garba Warm-up ${runTag}`, colleges.a);
  ev.seniors = await seedEvent(`Seniors Night ${runTag}`, colleges.a, { study_years: [4] });
  for (const name of Object.keys(emails)) pages[name] = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  for (const page of Object.values(pages)) await page.context().close();
  await closeDb();
});

const partnersUrl = (event) => `/events/${event.slug}/partners`;
const card = (page, name) => page.getByRole("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
const section = (page, name) => page.getByRole("region", { name });

test("set-up: four students with photos", async () => {
  await createStudent(pages.aman, { email: emails.aman, firstName: "Aman", college: collegeA });
  await createStudent(pages.bina, { email: emails.bina, firstName: "Bina", college: collegeB });
  await createStudent(pages.chitra, { email: emails.chitra, firstName: "Chitra", college: collegeA });
  await createStudent(pages.dev, { email: emails.dev, firstName: "Dev", college: collegeC });
  for (const who of ["aman", "bina", "chitra", "dev"]) await uploadPhoto(pages[who]);
});

test("2. a signed-out visitor cannot join, browse partners, see matches or fetch a photo", async ({ request }) => {
  for (const path of [`/events/${ev.main.slug}/join`, partnersUrl(ev.main), "/matches", `/events/${ev.main.slug}/partners/photo/3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b`]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location).toContain("/login");
  }
});

test("1. an eligible student joins through 'Find Your Partner'; nothing is saved until they confirm", async () => {
  const page = pages.aman;
  await page.goto(`/events/${ev.main.slug}`);
  await page.getByRole("link", { name: "Find Your Partner" }).click();
  await expect(page.getByRole("heading", { name: "Find your partner" })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Answer both questions to continue.")).toBeVisible();

  await field(page, "Male", { exact: true }).check();
  await field(page, "Looking for a female partner").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("looking for a female partner.")).toBeVisible();
  await expect(page.getByText("This cannot be changed later.")).toBeVisible();
  expect((await partnerCounts(ev.main.id)).participants).toBe(0); // not saved yet

  // going back keeps the choices; confirming saves
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(field(page, "Looking for a female partner")).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm and join" }).click();

  await expect(page).toHaveURL(new RegExp(`${partnersUrl(ev.main)}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`Find your partner: Dandiya Finals ${runTag}`);
  await expect(section(page, "Your profile for this event")).toContainText("Open");
  await expect(section(page, "Your profile for this event")).toContainText("You are looking for a female partner.");
  await expect(page.getByText("No one to show yet")).toBeVisible();
  await expect(page.getByText("No one is waiting for an answer")).toBeVisible();

  const { EventParticipant, ProfilePrivate } = await db();
  const joined = await EventParticipant.find({ event_id: ev.main.id }).lean();
  expect(joined).toMatchObject([{ user_id: await userId(emails.aman), status: "active", looking_for: "female" }]);
  expect((await ProfilePrivate.findById(joined[0].user_id).lean()).gender).toBe("male");

  // the event page now leads to the partner page instead of the join form
  await page.goto(`/events/${ev.main.slug}`);
  await expect(page.getByText("You have joined, looking for a female partner.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open partner discovery" })).toBeVisible();
});

test("joining again does not create a second record, and gender is not asked twice", async () => {
  const page = pages.aman;
  await page.goto(`/events/${ev.main.slug}/join`);
  await expect(page.getByRole("heading", { name: "Change your preference" })).toBeVisible();
  await expect(page.getByText("I am", { exact: true })).toHaveCount(0);
  await expect(field(page, "Looking for a female partner")).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm and join" }).click();
  await expect(page).toHaveURL(new RegExp(`${partnersUrl(ev.main)}$`));
  expect((await partnerCounts(ev.main.id)).participants).toBe(1);
});

test("3. an ineligible student is told why and cannot join or browse; an uninvited college sees nothing", async () => {
  const page = pages.aman; // 2nd year; the event is for 4th years
  await page.goto(`/events/${ev.seniors.slug}`);
  await expect(page.getByText("This event is limited to other years of study.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Find Your Partner" })).toHaveCount(0);
  await page.goto(`/events/${ev.seniors.slug}/join`);
  await expect(page.getByText("You cannot take part in this event right now")).toBeVisible();
  await expect(page.getByText("This event is limited to other years of study.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  await page.goto(partnersUrl(ev.seniors));
  await expect(page).toHaveURL(new RegExp(`/events/${ev.seniors.slug}/join$`));
  expect((await partnerCounts(ev.seniors.id)).participants).toBe(0);

  for (const path of [`/events/${ev.main.slug}/join`, partnersUrl(ev.main)]) {
    await pages.dev.goto(path);
    await expect(pages.dev.getByRole("heading", { name: "We could not find that event" })).toBeVisible();
  }
});

test("4, 13 & 16. students discover compatible profiles across invited colleges — and only name, course, year and photo", async () => {
  await joinEvent(pages.bina, ev.main.slug, { gender: "Female", lookingFor: "male" });
  const page = pages.bina;

  await expect(section(page, "Students you can partner with")).toContainText("1 student");
  const aman = card(page, "Aman");
  await expect(aman).toContainText("B.Tech Computer Science, 2nd year");
  await expect(aman.getByRole("button", { name: "Send Interest to Aman" })).toBeVisible();
  await expect(card(page, "Bina")).toHaveCount(0); // never herself

  // The photo is served by the app under an event-specific handle…
  const handle = await handleOf(ev.main.id, emails.aman);
  const img = aman.locator("img");
  await expect(img).toHaveAttribute("src", `/events/${ev.main.slug}/partners/photo/${handle}`);
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(512);

  // …and nothing in the page identifies Aman beyond what the card shows.
  const html = await page.content();
  const amanId = await userId(emails.aman);
  expect(handle).not.toBe(amanId);
  for (const secret of [amanId, emails.aman]) expect(html, secret).not.toContain(secret);
  // (Her own header photo is served at an address that names nobody; no user id appears in any image address.)
  const imageSources = await page.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  expect(imageSources.join(" ")).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp/);
  for (const id of [amanId, await userId(emails.bina)]) expect(imageSources.join(" ")).not.toContain(id);

  // Chitra (college A) joins too; both women see Aman, and neither sees the other.
  await joinEvent(pages.chitra, ev.main.slug, { gender: "Female", lookingFor: "male" });
  await expect(card(pages.chitra, "Aman")).toBeVisible();
  await expect(card(pages.chitra, "Bina")).toHaveCount(0);
  await pages.aman.goto(partnersUrl(ev.main));
  await expect(section(pages.aman, "Students you can partner with")).toContainText("2 students");
  await expect(card(pages.aman, "Bina")).toBeVisible();
  await expect(card(pages.aman, "Chitra")).toBeVisible();
});

test("13 & 14. a partner's photo cannot be fetched by someone who may not see them", async () => {
  const photo = `/events/${ev.main.slug}/partners/photo/${await handleOf(ev.main.id, emails.aman)}`;
  expect((await pages.bina.context().request.get(photo)).status()).toBe(200); // discoverable to her
  expect((await pages.dev.context().request.get(photo)).status()).toBe(404); // event not visible to him
  // a handle is only good for its own event
  const otherEvent = `/events/${ev.other.slug}/partners/photo/${await handleOf(ev.main.id, emails.aman)}`;
  expect((await pages.chitra.context().request.get(otherEvent)).status()).toBe(404);
  // Bina and Chitra cannot discover each other (both look for a male partner)
  const chitraPhoto = `/events/${ev.main.slug}/partners/photo/${await handleOf(ev.main.id, emails.chitra)}`;
  expect((await pages.bina.context().request.get(chitraPhoto)).status()).toBe(404);
  expect((await pages.aman.context().request.get(chitraPhoto)).status()).toBe(200);
});

test("8. sending interest does not create a match; the other person sees it under 'Interests received'", async () => {
  const page = pages.bina;
  await page.goto(partnersUrl(ev.main));
  await card(page, "Aman").getByRole("button", { name: "Send Interest to Aman" }).click();
  await expect(card(page, "Aman").getByText("Interest Sent")).toBeVisible();
  await expect(card(page, "Aman").getByRole("button", { name: /Send Interest/ })).toHaveCount(0);
  expect(await partnerCounts(ev.main.id)).toMatchObject({ interests: 1, matches: 0 });

  await page.reload();
  await expect(card(page, "Aman").getByText("Interest Sent")).toBeVisible();
  await page.goto("/matches");
  await expect(page.getByText("No matches yet", { exact: true })).toBeVisible();

  const aman = pages.aman;
  await aman.goto("/dashboard");
  await expect(section(aman, "Your partner search")).toContainText("Someone has sent you interest.");
  await aman.goto(partnersUrl(ev.main));
  const received = section(aman, "Interests received");
  await expect(received.getByRole("article")).toHaveCount(1);
  await expect(received.getByRole("heading", { name: "Bina" })).toBeVisible();
  await expect(received).toContainText("Sent you interest.");
  await expect(received.getByRole("button", { name: "Send Interest Back to Bina" })).toBeVisible();
  await expect(aman.getByRole("heading", { name: "Your matches for this event" })).toHaveCount(0);
});

test("9. sending interest back creates exactly one match, shown to both", async () => {
  const aman = pages.aman;
  await section(aman, "Interests received").getByRole("button", { name: "Send Interest Back to Bina" }).click();
  const matches = section(aman, "Your matches for this event");
  await expect(matches.getByRole("listitem")).toHaveCount(1);
  await expect(matches).toContainText("Bina");
  await expect(matches).toContainText("Matched");
  await expect(aman.getByText("No one is waiting for an answer")).toBeVisible();
  await expect(card(aman, "Bina").getByText("Matched", { exact: true })).toBeVisible();
  expect(await partnerCounts(ev.main.id)).toMatchObject({ interests: 2, matches: 1 });

  const bina = pages.bina;
  await bina.goto("/matches");
  const row = bina.getByRole("listitem").filter({ hasText: "Aman" });
  await expect(row).toContainText("B.Tech Computer Science, 2nd year");
  await expect(row.getByRole("link", { name: `Dandiya Finals ${runTag}` })).toBeVisible();
  await expect(row).toContainText("matched on");
  await expect(row.locator("img")).toHaveAttribute("src", /\/partners\/photo\//);
  // Since Phase 4 a match comes with a private conversation (tested in 06-chat).
  await expect(row).toContainText("No messages yet.");
  await expect(row.getByRole("link", { name: "Say hello with Aman" })).toHaveAttribute("href", /^\/matches\/[0-9a-f-]{36}$/);
  const html = await bina.content();
  expect(html).not.toContain(await userId(emails.aman));
  expect(html).not.toContain(emails.aman);
});

test("10. pressing 'Send Interest' twice in a row stores one interest", async () => {
  const page = pages.aman;
  await page.goto(partnersUrl(ev.main));
  await card(page, "Chitra").getByRole("button", { name: "Send Interest to Chitra" }).dblclick();
  await expect(card(page, "Chitra").getByText("Interest Sent")).toBeVisible();
  const { Interest } = await db();
  expect(await Interest.countDocuments({ event_id: ev.main.id, to_user_id: await userId(emails.chitra) })).toBe(1);
  expect((await partnerCounts(ev.main.id)).matches).toBe(1);
});

test("5, 6 & 18. closing a profile asks first, hides it from discovery, blocks new interest and keeps the match", async () => {
  const bina = pages.bina;
  await bina.goto(partnersUrl(ev.main));
  await bina.getByRole("button", { name: "Close My Profile for This Event" }).click();
  const dialog = bina.getByRole("dialog", { name: "Close your profile for this event?" });
  await expect(dialog).toContainText("You will no longer appear in partner discovery for this event.");
  await expect(dialog).toContainText("Your matches and the interest you already exchanged are kept.");
  await dialog.getByRole("button", { name: "Keep it open" }).click();
  await expect(dialog).toBeHidden();
  await expect(section(bina, "Your profile for this event")).toContainText("Open");

  await bina.getByRole("button", { name: "Close My Profile for This Event" }).click();
  await dialog.getByRole("button", { name: "Yes, close my profile" }).click();
  await expect(bina.getByText("Your profile is closed for this event.").first()).toBeVisible();
  await expect(section(bina, "Your profile for this event")).toContainText("Closed");
  await expect(bina.getByText("Re-open it above to see students and be seen again.")).toBeVisible();
  await expect(bina.getByRole("article")).toHaveCount(0); // no cards, so nothing to send
  await expect(section(bina, "Your matches for this event")).toContainText("Aman"); // 18

  const aman = pages.aman;
  await aman.goto(partnersUrl(ev.main));
  await expect(card(aman, "Bina")).toHaveCount(0); // 5
  await expect(section(aman, "Students you can partner with")).toContainText("1 student");
  await expect(section(aman, "Your matches for this event")).toContainText("Bina"); // 18

  // 6. Nothing was added or lost by closing. (That the services refuse interest to and
  // from a closed profile, whatever request is sent, is tested in tests/services/04-partners.)
  expect(await partnerCounts(ev.main.id)).toMatchObject({ participants: 3, interests: 3, matches: 1 });
  const { EventParticipant } = await db();
  expect(await EventParticipant.findOne({ event_id: ev.main.id, user_id: await userId(emails.bina) }).lean()).toMatchObject({ status: "closed", looking_for: "male" });
});

test("7. re-opening restores the same profile for that event", async () => {
  const bina = pages.bina;
  const before = await handleOf(ev.main.id, emails.bina);
  await bina.getByRole("button", { name: "Re-open my profile for this event" }).click();
  await expect(bina.getByText("Your profile is open for this event again.")).toBeVisible();
  await expect(section(bina, "Your profile for this event")).toContainText("Open");
  await expect(card(bina, "Aman").getByText("Matched", { exact: true })).toBeVisible();
  expect(await handleOf(ev.main.id, emails.bina)).toBe(before);
  expect(await partnerCounts(ev.main.id)).toMatchObject({ participants: 3, matches: 1 });
  await pages.aman.reload();
  await expect(card(pages.aman, "Bina")).toBeVisible();
});

test("17. closing for one event leaves the student's other events untouched", async () => {
  const chitra = pages.chitra;
  await joinEvent(chitra, ev.other.slug, { lookingFor: "male" }); // gender already saved
  await joinEvent(pages.aman, ev.other.slug, { lookingFor: "female" });

  await chitra.goto(partnersUrl(ev.main));
  await chitra.getByRole("button", { name: "Close My Profile for This Event" }).click();
  await chitra.getByRole("dialog").getByRole("button", { name: "Yes, close my profile" }).click();
  await expect(section(chitra, "Your profile for this event")).toContainText("Closed");

  await chitra.goto(partnersUrl(ev.other));
  await expect(section(chitra, "Your profile for this event")).toContainText("Open");
  await expect(card(chitra, "Aman")).toBeVisible();
  await pages.aman.goto(partnersUrl(ev.other));
  await expect(card(pages.aman, "Chitra")).toBeVisible();
  await pages.aman.goto(partnersUrl(ev.main));
  await expect(card(pages.aman, "Chitra")).toHaveCount(0);

  // put it back for the tests that follow
  await chitra.goto(partnersUrl(ev.main));
  await chitra.getByRole("button", { name: "Re-open my profile for this event" }).click();
  await expect(section(chitra, "Your profile for this event")).toContainText("Open");
});

test("reporting a profile: reason required, stored for moderators, not readable by students", async () => {
  const bina = pages.bina;
  await bina.goto(partnersUrl(ev.main));
  await card(bina, "Aman").getByRole("button", { name: "Report profile of Aman" }).click();
  const dialog = bina.getByRole("dialog", { name: "Report Aman’s profile" });
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("Choose a reason.")).toBeVisible();

  await field(dialog, "What is wrong?").selectOption({ label: "Misleading information" });
  await field(dialog, "What happened?").fill("Says B.Tech but is not in that course.");
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("Report sent to your college’s moderators.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  const { Report } = await db();
  const reports = await Report.find({ event_id: ev.main.id }).lean();
  expect(reports).toMatchObject([
    { reason: "misleading_information", details: "Says B.Tech but is not in that course.", status: "open", reporter_id: await userId(emails.bina), reported_user_id: await userId(emails.aman), college_id: colleges.a },
  ]);

  // The same report again does not pile up.
  await bina.reload();
  await card(bina, "Aman").getByRole("button", { name: "Report profile of Aman" }).click();
  await field(dialog, "What is wrong?").selectOption({ label: "Spam" });
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("You have already reported this profile. Your college’s moderators have it.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  expect(await Report.countDocuments({ event_id: ev.main.id })).toBe(1);

  // The reported student is shown nothing about it, anywhere.
  for (const path of [partnersUrl(ev.main), "/matches", "/dashboard", "/profile"]) {
    await pages.aman.goto(path);
    expect(await pages.aman.content(), path).not.toMatch(/not in that course|been reported|reported you|report about you/i);
  }
});

test("12. blocking hides two students from each other everywhere, quietly; only the blocker can undo it", async () => {
  const chitra = pages.chitra;
  // A second window of Aman's, left open on the other event from before the block.
  const stale = await pages.aman.context().newPage();
  await stale.goto(partnersUrl(ev.other));
  await expect(card(stale, "Chitra").getByRole("button", { name: "Send Interest to Chitra" })).toBeVisible();

  await chitra.goto(partnersUrl(ev.main));
  // Aman sent Chitra interest earlier, so she sees him under "Interests received" and in discovery.
  await expect(section(chitra, "Interests received").getByRole("heading", { name: "Aman" })).toBeVisible();
  await section(chitra, "Students you can partner with").getByRole("button", { name: "Block Aman" }).click();
  const dialog = chitra.getByRole("dialog", { name: "Block Aman?" });
  await expect(dialog).toContainText("Aman is not told.");
  await dialog.getByRole("button", { name: "Block Aman" }).click();

  await expect(chitra.getByRole("article")).toHaveCount(0);
  await expect(chitra.getByText("No one is waiting for an answer")).toBeVisible();
  await chitra.goto(partnersUrl(ev.other));
  await expect(card(chitra, "Aman")).toHaveCount(0); // in the other event too

  const aman = pages.aman;
  for (const event of [ev.main, ev.other]) {
    await aman.goto(partnersUrl(event));
    await expect(card(aman, "Chitra")).toHaveCount(0);
  }
  await aman.goto("/matches");
  await expect(aman.getByText("Nobody. You can block someone from their card")).toBeVisible(); // he is told nothing

  // Interest is refused by the server even from a page that still shows her card — with the
  // same neutral answer as for anyone unavailable — so no match can form.
  await card(stale, "Chitra").getByRole("button", { name: "Send Interest to Chitra" }).click();
  await expect(stale.getByText("That person is no longer available for this event.").filter({ visible: true })).toBeVisible();
  await stale.close();
  expect(await partnerCounts(ev.other.id)).toMatchObject({ interests: 0, matches: 0 });
  expect((await partnerCounts(ev.main.id)).matches).toBe(1);
  const { Block } = await db();
  expect(await Block.countDocuments({ blocker_id: await userId(emails.chitra), blocked_id: await userId(emails.aman) })).toBe(1);
  // Her photo is no longer served to him either.
  const photo = await pages.aman.context().request.get(`${partnersUrl(ev.other)}/photo/${await handleOf(ev.other.id, emails.chitra)}`);
  expect(photo.status()).toBe(404);

  // Chitra unblocks from her Matches page; they can see each other again.
  await chitra.goto("/matches");
  const blocked = section(chitra, "People you have blocked");
  await expect(blocked).toContainText("Aman");
  await blocked.getByRole("button", { name: "Unblock Aman" }).click();
  await expect(chitra.getByText("Nobody. You can block someone from their card")).toBeVisible();
  await chitra.goto(partnersUrl(ev.main));
  await expect(section(chitra, "Interests received").getByRole("heading", { name: "Aman" })).toBeVisible();
});

test("14, 15 & 20. a student is shown nothing beyond their own partner data, by any address", async () => {
  // (Direct writes do not exist — there is no data API — and what each service
  // returns and refuses is tested in tests/services/04-partners. Here: the pages
  // and the photo route, as the browser sees them.)
  const [amanId, binaId, chitraId] = [await userId(emails.aman), await userId(emails.bina), await userId(emails.chitra)];
  const before = await partnerCounts(ev.main.id);
  const chitra = pages.chitra;

  // 14. Aman and Bina are matched; Chitra can learn nothing about it.
  await chitra.goto("/matches");
  await expect(chitra.getByRole("listitem").filter({ hasText: "Bina" })).toHaveCount(0);
  await chitra.goto(partnersUrl(ev.main));
  await expect(section(chitra, "Interests received").getByRole("heading", { name: "Aman" })).toBeVisible(); // only what was sent to her
  expect(await chitra.locator("main").filter({ visible: true }).innerText()).not.toContain("Bina");
  for (const path of [partnersUrl(ev.main), "/matches"]) {
    const html = await (await chitra.context().request.get(path)).text();
    for (const secret of [amanId, binaId, chitraId, emails.aman, emails.bina]) expect(html, path).not.toContain(secret);
  }

  // Photos: only of someone she may see in that event.
  const photoOf = async (context, event, email) => (await context.request.get(`${partnersUrl(event)}/photo/${await handleOf(event.id, email)}`, { maxRedirects: 0 })).status();
  expect(await photoOf(chitra.context(), ev.main, emails.aman)).toBe(200); // compatible, and he sent her interest
  expect(await photoOf(chitra.context(), ev.main, emails.bina)).toBe(404); // not someone she is shown
  expect(await photoOf(chitra.context(), ev.other, emails.bina)).toBe(404); // a handle that does not exist in that event
  expect((await chitra.context().request.get(`${partnersUrl(ev.main)}/photo/${binaId}`)).status()).toBe(404); // a user id is not a handle

  // 20. Dev's college is not invited: the event, its partner pages and its photos do not exist for him.
  const dev = pages.dev;
  for (const path of [`/events/${ev.main.slug}`, `/events/${ev.main.slug}/join`, partnersUrl(ev.main)]) {
    await dev.goto(path);
    await expect(dev.getByRole("heading", { name: /We could not find that (event|page)/ }).filter({ visible: true })).toBeVisible();
  }
  expect(await photoOf(dev.context(), ev.main, emails.bina)).toBe(404);
  await dev.goto("/matches");
  await expect(dev.getByRole("listitem").filter({ hasText: /Aman|Bina|Chitra/ })).toHaveCount(0);

  // 15. Nothing changed through any of that.
  expect(await partnerCounts(ev.main.id)).toEqual(before);
});

test("19. a suspended student drops out of discovery and can no longer use partner pages", async () => {
  const { Profile } = await db();
  await Profile.updateOne({ _id: await userId(emails.chitra) }, { $set: { status: "suspended" } });
  await pages.aman.goto(partnersUrl(ev.other));
  await expect(card(pages.aman, "Chitra")).toHaveCount(0);
  await expect(pages.aman.getByText("No one to show yet")).toBeVisible();
  await pages.chitra.goto(partnersUrl(ev.other));
  // Since Phase 5 a suspended student sees one notice instead of the app.
  await expect(pages.chitra.getByRole("heading", { name: "Your account is suspended" }).filter({ visible: true })).toBeVisible();
  await Profile.updateOne({ _id: await userId(emails.chitra) }, { $set: { status: "active" } });
});

test("when the event closes, discovery ends but matches stay", async () => {
  const { Event } = await db();
  await Event.updateOne({ _id: ev.main.id }, { $set: { status: "closed" } });
  const aman = pages.aman;
  await aman.goto(partnersUrl(ev.main));
  await expect(section(aman, "Your profile for this event")).toContainText("Ended");
  await expect(aman.getByText("The organisers have closed this event to new participants.")).toBeVisible();
  await expect(aman.getByText("Partner discovery has ended for this event")).toBeVisible();
  await expect(aman.getByRole("button", { name: /Send Interest/ })).toHaveCount(0);
  await expect(aman.getByRole("button", { name: "Close My Profile for This Event" })).toHaveCount(0);
  await expect(section(aman, "Your matches for this event")).toContainText("Bina");
  await aman.goto("/matches");
  await expect(aman.getByRole("listitem").filter({ hasText: "Bina" })).toBeVisible();
});
