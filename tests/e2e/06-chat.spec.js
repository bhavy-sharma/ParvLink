// Phase 4 — private chat between matched students, in real browsers: two (and
// three) signed-in students at once. Numbers refer to the 20 cases in the
// Phase 4 brief. Service-level versions of the same rules (every refusal, for
// any request a script could send): tests/services/05-chat.
//
// Live updates are the app's own Server-Sent Events stream, served by the same
// production build; nothing is stubbed. See docs/TESTING.md.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  ageMessages,
  closeDb,
  createStudent,
  db,
  makeMatch,
  readLiveStream,
  runTag,
  seedCollege,
  seedEvent,
  setLiveUpdates,
  storedMessages,
  storeMessage,
  uniqueEmail,
  uploadPhoto,
  userId,
} from "./helpers";

test.describe.configure({ mode: "serial" });

const college = `Sophia College ${runTag}`;
const eventTitle = `Navratri Night ${runTag}`;
const secondTitle = `Freshers Mixer ${runTag}`;
const emails = {
  ravi: uniqueEmail("c-ravi"), // male
  sana: uniqueEmail("c-sana"), // female — matched with Ravi
  tara: uniqueEmail("c-tara"), // female — matched with Ravi (a separate conversation)
  omar: uniqueEmail("c-omar"), // male — matched with nobody
};
const pages = {};
const ids = {};
let event;
let second;
let raviSana; // { matchId, conversation }
let raviTara;
let raviSanaSecond; // the same pair in another event

const chatUrl = (c) => `/matches/${c.conversation}`;
const log = (page) => page.getByRole("log", { name: "Messages" }).filter({ visible: true });
const bubbles = (page) => log(page).locator("li[data-seq]");
const box = (page) => page.getByRole("textbox", { name: /^Message to / }).filter({ visible: true });
const sendButton = (page) => page.getByRole("button", { name: "Send message" }).filter({ visible: true });
const scroller = (page) => page.getByTestId("chat-scroller").filter({ visible: true });

async function send(page, text) {
  await box(page).fill(text);
  await sendButton(page).click();
  await expect(log(page).locator("li[data-seq]", { hasText: text })).toHaveCount(1);
}
/** Saves a screenshot for a human to look at, when E2E_SHOTS_DIR is set. */
async function shot(page, name) {
  if (process.env.E2E_SHOTS_DIR) await page.screenshot({ path: `${process.env.E2E_SHOTS_DIR}/${name}.png` });
}

test.beforeAll(async ({ browser }) => {
  const collegeId = await seedCollege(college);
  event = await seedEvent(eventTitle, collegeId);
  second = await seedEvent(secondTitle, collegeId);
  for (const name of Object.keys(emails)) pages[name] = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  for (const page of Object.values(pages)) await page.context().close();
  await closeDb();
});

test("set-up: four students; Ravi is matched with Sana and with Tara", async () => {
  test.setTimeout(120_000);
  for (const [who, firstName] of [["ravi", "Ravi"], ["sana", "Sana"], ["tara", "Tara"], ["omar", "Omar"]]) {
    await createStudent(pages[who], { email: emails[who], firstName, college });
    await uploadPhoto(pages[who]);
    ids[who] = await userId(emails[who]);
  }
  const person = (who, gender) => ({ email: emails[who], gender, lookingFor: gender === "male" ? "female" : "male" });
  raviSana = await makeMatch(event, person("ravi", "male"), person("sana", "female"));
  raviTara = await makeMatch(event, person("ravi", "male"), person("tara", "female"));
  raviSanaSecond = await makeMatch(second, person("ravi", "male"), person("sana", "female"));
  const { EventParticipant, ProfilePrivate } = await db();
  await ProfilePrivate.updateOne({ _id: ids.omar }, { $set: { gender: "male" } });
  await EventParticipant.create({ event_id: event.id, user_id: ids.omar, looking_for: "female" });
  expect(raviSana.conversation).not.toBe(raviSana.matchId);
});

test("1. a matched student finds the conversation in their matches and opens it", async () => {
  const page = pages.ravi;
  await page.goto("/matches");
  const row = page.getByRole("listitem").filter({ hasText: "Sana" }).filter({ hasText: eventTitle });
  await expect(row).toContainText("No messages yet.");
  await expect(row.locator("img")).toHaveAttribute("src", /\/partners\/photo\//);
  await row.getByRole("link", { name: "Say hello with Sana" }).click();

  await expect(page).toHaveURL(new RegExp(`${chatUrl(raviSana)}$`));
  const chat = page.getByRole("region", { name: "Chat with Sana" });
  await expect(chat.getByRole("heading", { name: "Sana", level: 1 })).toBeVisible();
  await expect(chat.getByRole("link", { name: eventTitle })).toHaveAttribute("href", `/events/${event.slug}/partners`);
  await expect(chat.getByRole("link", { name: "Back to my matches" })).toHaveAttribute("href", "/matches");
  await expect(chat.locator("header img")).toHaveAttribute("src", /\/partners\/photo\//);
  // Empty state for a new conversation, the message box, the safety reminder and an honest privacy note.
  await expect(chat.getByText("You and Sana matched")).toBeVisible();
  await expect(bubbles(page)).toHaveCount(0);
  await expect(box(page)).toBeVisible();
  await expect(chat.getByText("Stay safe: do not share passwords, OTPs, bank or payment details")).toBeVisible();
  await chat.getByText("Stay safe:").click();
  await expect(chat.getByText("they are not end-to-end encrypted")).toBeVisible();
  // Nothing that is not implemented is hinted at.
  await expect(chat.getByText(/online|typing|seen|delivered|unread/i)).toHaveCount(0);

  // No private identifiers in the page.
  const html = await page.content();
  for (const secret of [ids.sana, emails.sana, raviSana.matchId]) expect(html).not.toContain(secret);
});

test("2. another student cannot open the conversation by URL, by id guessing, or through its live stream", async () => {
  // Tara has a conversation of her own with Ravi, and still cannot see Ravi–Sana. Omar has no match at all.
  for (const who of ["tara", "omar"]) {
    const page = pages[who];
    for (const path of [chatUrl(raviSana), `/matches/${raviSana.matchId}`, "/matches/3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b", "/matches/not-an-id", `/matches/${ids.sana}`]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "We could not find that conversation" }).filter({ visible: true }), `${who} ${path}`).toBeVisible();
      await expect(page.getByRole("textbox", { name: /^Message to / }).filter({ visible: true })).toHaveCount(0);
    }
    // The live-update stream of the conversation does not exist for them either.
    for (const id of [raviSana.conversation, raviSana.matchId, "not-an-id"]) {
      expect((await page.context().request.get(`/matches/${id}/events`)).status(), `${who} stream ${id}`).toBe(404);
    }
  }
  // Their own list holds their own conversations only.
  await pages.tara.goto("/matches");
  const taraHtml = await pages.tara.content();
  expect(taraHtml).toContain(raviTara.conversation);
  expect(taraHtml).not.toContain(raviSana.conversation);
  expect(taraHtml).not.toContain(raviSanaSecond.conversation);
  await pages.omar.goto("/matches");
  expect(await pages.omar.content()).not.toMatch(/\/matches\/[0-9a-f]{8}-/);
  expect(await storedMessages(raviSana.matchId)).toEqual([]);
});

test("3. a visitor who is not signed in is sent to log in, and gets nothing from the live stream", async ({ request }) => {
  const response = await request.get(chatUrl(raviSana), { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/login?next=");
  expect(await response.text()).not.toContain("Sana");

  const stream = await request.get(`${chatUrl(raviSana)}/events`, { maxRedirects: 0 });
  expect(stream.status()).toBe(307);
  expect(stream.headers().location).toContain("/login");
  expect(stream.headers()["content-type"] ?? "").not.toContain("event-stream");
});

test("4 & 9. a participant sends a message; it is stored and is still there after reopening", async () => {
  const page = pages.ravi;
  await page.goto(chatUrl(raviSana));
  await box(page).fill("Hi Sana! Ready for Navratri?");
  await box(page).press("Enter"); // Enter sends on a keyboard
  const mine = bubbles(page).filter({ hasText: "Hi Sana! Ready for Navratri?" });
  await expect(mine).toHaveCount(1);
  await expect(mine).toHaveAttribute("data-mine", "true");
  await expect(mine.locator("time")).toHaveText(/\d{1,2}:\d{2}/);
  await expect(box(page)).toHaveValue("");
  await expect(page.getByText("You and Sana matched")).toHaveCount(0);

  // Shift+Enter makes a new line instead of sending; line breaks are kept.
  await box(page).fill("Line one");
  await box(page).press("Shift+Enter");
  await box(page).pressSequentially("Line two");
  await sendButton(page).click();
  await expect(bubbles(page)).toHaveCount(2);

  expect(await storedMessages(raviSana.matchId)).toEqual([
    { seq: 1, body: "Hi Sana! Ready for Navratri?", sender_id: ids.ravi },
    { seq: 2, body: "Line one\nLine two", sender_id: ids.ravi },
  ]);

  await page.reload();
  await expect(bubbles(page)).toHaveCount(2);
  await expect(bubbles(page).nth(1).locator("p").first()).toHaveText("Line one\nLine two");
  await expect(bubbles(page).nth(1).locator("p").first()).toHaveCSS("white-space", "pre-wrap");

  // The other participant sees the same history, as received messages.
  await pages.sana.goto(chatUrl(raviSana));
  await expect(bubbles(pages.sana)).toHaveCount(2);
  await expect(bubbles(pages.sana).first()).toHaveAttribute("data-mine", "false");
  await expect(bubbles(pages.sana).first()).toContainText("Hi Sana! Ready for Navratri?");
});

test("10 & 11. a new message reaches the other participant live, exactly once, in both directions", async () => {
  const [ravi, sana] = [pages.ravi, pages.sana];
  await send(ravi, "Are you free on Saturday?");
  // No reload on Sana's side; well inside the 15 s fallback check, so this is the live stream.
  await expect(bubbles(sana).filter({ hasText: "Are you free on Saturday?" })).toHaveCount(1, { timeout: 5000 });
  await send(sana, "Yes — 6 pm at the main gate?");
  await expect(bubbles(ravi).filter({ hasText: "Yes — 6 pm at the main gate?" })).toHaveCount(1, { timeout: 5000 });
  await expect(bubbles(ravi).last()).toHaveAttribute("data-mine", "false");

  // 11. The sender's own message is announced on their live stream as well; it must not appear twice.
  await ravi.waitForTimeout(1500);
  for (const page of [ravi, sana]) {
    await expect(bubbles(page)).toHaveCount(4);
    const seqs = await bubbles(page).evaluateAll((items) => items.map((item) => Number(item.dataset.seq)));
    expect(seqs).toEqual([1, 2, 3, 4]);
    await expect(log(page).locator("li[data-pending]")).toHaveCount(0);
  }
  expect((await storedMessages(raviSana.matchId)).map((m) => m.seq)).toEqual([1, 2, 3, 4]);
});

test("6 & 7. blank and over-long messages cannot be sent", async () => {
  const page = pages.ravi;
  await expect(sendButton(page)).toBeDisabled();
  await box(page).fill("   \n  ");
  await expect(sendButton(page)).toBeDisabled();
  await box(page).press("Enter");
  await box(page).fill("x".repeat(2001));
  await expect(page.getByText("2001 / 2000 — too long to send").filter({ visible: true })).toBeVisible();
  await expect(sendButton(page)).toBeDisabled();
  await box(page).press("Enter");
  await box(page).fill("x".repeat(2000));
  await expect(page.getByText("2000 / 2000").filter({ visible: true })).toBeVisible();
  await expect(sendButton(page)).toBeEnabled();
  await box(page).fill("");

  // (The server refuses the same things whatever is sent to it: tests/services/05-chat.)
  expect(await storedMessages(raviSana.matchId)).toHaveLength(4);
  await expect(bubbles(page)).toHaveCount(4);
});

test("5. the sender is whoever is signed in: a copied request sends as its sender, or not at all", async ({ browser }) => {
  // Capture the exact request Ravi's browser makes to send a message — and stop it reaching the server.
  const page = pages.ravi;
  let captured;
  const pattern = `**${chatUrl(raviSana)}`;
  await page.route(pattern, async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.headers()["next-action"]) {
      captured = { url: request.url(), headers: await request.allHeaders(), body: request.postDataBuffer() };
      return route.abort();
    }
    return route.continue();
  });
  await box(page).fill("Copied request");
  await sendButton(page).click();
  await expect.poll(() => captured).toBeTruthy();
  await page.unroute(pattern);
  expect(captured.body.toString()).not.toContain(ids.ravi); // the request names no sender at all
  const before = await storedMessages(raviSana.matchId);

  const replayAs = (context) => {
    const headers = Object.fromEntries(Object.entries(captured.headers).filter(([name]) => !name.startsWith(":") && !["cookie", "content-length", "host", "connection"].includes(name)));
    return context.request.post(captured.url, { headers, data: captured.body, maxRedirects: 0 });
  };
  // Someone outside the conversation, and nobody at all: nothing is stored.
  const anonymous = await browser.newContext();
  for (const context of [pages.tara.context(), pages.omar.context(), anonymous]) {
    expect((await replayAs(context)).status()).toBeLessThan(500);
    expect(await storedMessages(raviSana.matchId)).toEqual(before);
  }
  await anonymous.close();
  // The other participant: it is stored — as HER message, because the sender comes from the session.
  expect((await replayAs(pages.sana.context())).ok()).toBe(true);
  const after = await storedMessages(raviSana.matchId);
  expect(after).toHaveLength(before.length + 1);
  expect(after.at(-1)).toMatchObject({ body: "Copied request", sender_id: ids.sana });
  expect(after.filter((m) => m.sender_id === ids.ravi)).toHaveLength(before.filter((m) => m.sender_id === ids.ravi).length);

  await page.reload(); // drop the unsent bubble left by the stopped request
  await expect(bubbles(page).filter({ hasText: "Copied request" })).toHaveAttribute("data-mine", "false");
  await pages.sana.reload();
});

test("8. a double press stores one message", async () => {
  const page = pages.ravi;
  await box(page).fill("Only once, please");
  await sendButton(page).dblclick();
  await expect(bubbles(page).filter({ hasText: "Only once, please" })).toHaveCount(1);
  await box(page).fill("Enter twice");
  await box(page).press("Enter");
  await box(page).press("Enter");
  await expect(bubbles(page).filter({ hasText: "Enter twice" })).toHaveCount(1);

  // (A repeated request with the same message id is answered with the stored message: tests/services/05-chat.)
  const bodies = (await storedMessages(raviSana.matchId)).map((m) => m.body);
  for (const text of ["Only once, please", "Enter twice"]) expect(bodies.filter((b) => b === text), text).toHaveLength(1);
  // …and each arrived exactly once on the other side.
  for (const text of ["Only once, please", "Enter twice"]) {
    await expect(bubbles(pages.sana).filter({ hasText: text })).toHaveCount(1);
  }
  await ageMessages();
});

test("message text is shown as text: markup in a message is never run or rendered", async () => {
  const [ravi, sana] = [pages.ravi, pages.sana];
  const attack = `<img src=x onerror="window.__xss=1"> <b>bold</b> <script>window.__xss=2</script> https://example.com`;
  await send(ravi, attack);
  const received = bubbles(sana).filter({ hasText: "<b>bold</b>" });
  await expect(received).toHaveCount(1);
  await expect(received.locator("p").first()).toHaveText(attack);
  await shot(sana, "chat-desktop");
  for (const page of [ravi, sana]) {
    await expect(log(page).locator("img, b, script, a")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  }
  // Message text is not kept in browser storage or in the address.
  for (const page of [ravi, sana]) {
    const stored = await page.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
    expect(stored).not.toContain("Saturday");
    expect(stored).not.toContain("bold");
    expect(page.url()).toMatch(/\/matches\/[0-9a-f-]{36}$/);
  }
});

test("9. long conversations load a page at a time, oldest to newest, without jumping", async () => {
  // 70 older messages in the Ravi–Tara conversation, written directly (not through the rate limit).
  const { Match, Message } = await db();
  const threeDaysAgo = Date.now() - 3 * 86400000;
  await Message.collection.insertMany(
    Array.from({ length: 70 }, (_, i) => i + 1).map((n) => ({
      _id: randomUUID(), match_id: raviTara.matchId, sender_id: n % 2 === 0 ? ids.ravi : ids.tara, body: `history ${n}`, seq: n, client_id: randomUUID(),
      created_at: new Date(threeDaysAgo - (100 - n) * 60000),
    })),
  );
  await Match.updateOne({ _id: raviTara.matchId }, { $set: { last_seq: 70 } });
  const page = pages.tara;
  await page.goto(chatUrl(raviTara));

  // Opens on the latest page, at the newest message.
  await expect(bubbles(page)).toHaveCount(30);
  await expect(bubbles(page).last()).toContainText("history 70");
  await expect(bubbles(page).last()).toBeInViewport();
  await expect(bubbles(page).first()).toContainText("history 41");
  await expect(log(page).getByText(/^\d{1,2} \w{3} \d{4}$/).first()).toBeVisible(); // a date separator

  // Loading earlier messages adds them above and keeps the reader where they were.
  await scroller(page).evaluate((el) => (el.scrollTop = 0));
  await page.getByRole("button", { name: "Load earlier messages" }).filter({ visible: true }).click();
  await expect(bubbles(page)).toHaveCount(60);
  await expect(log(page).locator('li[data-seq="41"]')).toBeInViewport();
  await page.getByRole("button", { name: "Load earlier messages" }).filter({ visible: true }).click();
  await expect(bubbles(page)).toHaveCount(70);
  await expect(page.getByRole("button", { name: "Load earlier messages" }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("This is the start of your conversation with Ravi.").filter({ visible: true })).toBeVisible();

  const seqs = await bubbles(page).evaluateAll((items) => items.map((item) => Number(item.dataset.seq)));
  expect(seqs).toEqual(Array.from({ length: 70 }, (_, i) => i + 1));
});

test("a message arriving while reading older history does not pull the reader away", async () => {
  const tara = pages.tara;
  await scroller(tara).evaluate((el) => (el.scrollTop = 200));
  await expect(bubbles(tara).last()).not.toBeInViewport();
  await pages.ravi.goto(chatUrl(raviTara));
  await send(pages.ravi, "Tara, are you there?");

  const button = tara.getByRole("button", { name: "New messages" }).filter({ visible: true });
  await expect(button).toBeVisible({ timeout: 5000 });
  expect(await scroller(tara).evaluate((el) => el.scrollTop)).toBeLessThan(400); // still where she was reading
  await button.click();
  await expect(bubbles(tara).filter({ hasText: "Tara, are you there?" })).toBeInViewport();
  await expect(button).toHaveCount(0);

  // At the bottom, the next message is followed automatically.
  await send(pages.ravi, "Second ping");
  await expect(bubbles(tara).filter({ hasText: "Second ping" })).toBeInViewport({ timeout: 5000 });
  await expect(tara.getByRole("button", { name: "New messages" }).filter({ visible: true })).toHaveCount(0);
});

test("moving between chats: the previous conversation stops delivering, and the list shows the latest message", async () => {
  // Ravi is on the Tara chat (previous test). Sana writes in the Ravi–Sana conversation.
  const ravi = pages.ravi;
  await send(pages.sana, "Message for the other chat");
  await ravi.waitForTimeout(3500);
  await expect(ravi.getByRole("region", { name: "Chat with Tara" }).getByText("Message for the other chat")).toHaveCount(0);

  // In-app navigation: back to the list, into the other chat.
  await ravi.getByRole("link", { name: "Back to my matches" }).filter({ visible: true }).click();
  await expect(ravi).toHaveURL(/\/matches$/);
  const rows = ravi.getByRole("list").filter({ visible: true }).first().getByRole("listitem");
  // Most recent conversation first, with a preview and a time — and nothing invented (no unread counts).
  await expect(rows.first()).toContainText("Sana");
  await expect(rows.first().getByTestId("last-message")).toContainText("Sana: Message for the other chat");
  await expect(rows.first().getByTestId("last-message").locator("time")).toHaveText(/\d{1,2} \w{3}, \d{1,2}:\d{2}/);
  await expect(rows.nth(1).getByTestId("last-message")).toContainText("You: Second ping");
  await expect(rows.filter({ hasText: secondTitle })).toContainText("No messages yet.");
  await shot(ravi, "chat-list");
  await expect(ravi.getByText(/unread|online/i)).toHaveCount(0);

  await rows.first().getByRole("link", { name: "Open chat with Sana" }).click();
  await expect(bubbles(ravi).filter({ hasText: "Message for the other chat" })).toHaveCount(1);

  // Now a message in the Tara conversation must not show up here.
  await storeMessage(raviTara.matchId, ids.tara, "Only for the Tara chat");
  await ravi.waitForTimeout(3500);
  await expect(ravi.getByRole("region", { name: "Chat with Sana" }).filter({ visible: true }).getByText("Only for the Tara chat")).toHaveCount(0);
  await ageMessages();
});

test("12. nobody else can listen to a conversation's live stream, and what it carries has no message text", async () => {
  const conversation = raviSana.conversation;
  // Other students and guesses at the address are refused; they get no stream at all.
  for (const who of ["tara", "omar"]) {
    const attempt = await readLiveStream(pages[who], conversation, 1500);
    expect(attempt.status, who).toBe(404);
    expect(attempt.text).toBe("");
  }
  for (const guess of [raviSana.matchId, raviTara.conversation, "*", `${conversation}:x`, ids.ravi]) {
    expect((await readLiveStream(pages.sana, guess, 1500)).status, guess).toBe(404);
  }

  // A participant may listen — and receives a number, never the text.
  const secret = "the secret plan is the east gate";
  const listening = readLiveStream(pages.sana, conversation, 6000);
  await pages.sana.waitForTimeout(1000);
  const seq = await storeMessage(raviSana.matchId, ids.ravi, secret);
  const heard = await listening;
  expect(heard.status).toBe(200);
  expect(heard.contentType).toContain("text/event-stream");
  const events = heard.text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  expect(events.length).toBeGreaterThanOrEqual(2); // "ready", then the ping
  for (const event of events) expect(Object.keys(event)).toEqual(["seq"]);
  expect(events.at(-1)).toEqual({ seq });
  expect(heard.text).not.toContain("secret");
  expect(heard.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no ids either
  // The stream is read-only: there is nothing to post to it.
  expect((await pages.sana.context().request.post(`${chatUrl(raviSana)}/events`, { data: { seq: 999 } })).status()).toBeGreaterThanOrEqual(400);
});

test("if live updates are cut off, the chat says so, still works, and catches up when they return", async () => {
  test.setTimeout(120_000);
  const sana = pages.sana;
  await sana.goto(chatUrl(raviSana));
  await expect(bubbles(sana).last()).toContainText("the secret plan is the east gate");

  // The connection to the live stream fails from now on (as on a network that blocks it).
  await setLiveUpdates(sana, false);
  await sana.reload();
  await expect(sana.getByText("Live updates are paused.").filter({ visible: true })).toBeVisible({ timeout: 20_000 });

  // Sending still works without it…
  await send(sana, "Sent while live updates were down");
  // …and "Reload messages" fetches what the other person wrote meanwhile.
  await storeMessage(raviSana.matchId, ids.ravi, "Written during the outage");
  await sana.getByRole("button", { name: "Reload messages" }).filter({ visible: true }).click();
  await expect(bubbles(sana).filter({ hasText: "Written during the outage" })).toHaveCount(1);
  // Left alone, the slower check picks up new messages too.
  await storeMessage(raviSana.matchId, ids.ravi, "Found by the slow check");
  await expect(bubbles(sana).filter({ hasText: "Found by the slow check" })).toHaveCount(1, { timeout: 25_000 });

  // The stream returns: the notice goes away by itself and live delivery resumes, with nothing duplicated.
  await storeMessage(raviSana.matchId, ids.ravi, "Missed ping");
  await setLiveUpdates(sana, true);
  await expect(sana.getByText("Live updates are paused.").filter({ visible: true })).toHaveCount(0, { timeout: 40_000 });
  await expect(bubbles(sana).filter({ hasText: "Missed ping" })).toHaveCount(1);
  await storeMessage(raviSana.matchId, ids.ravi, "Live again");
  await expect(bubbles(sana).filter({ hasText: "Live again" })).toHaveCount(1, { timeout: 5000 });
  const seqs = await bubbles(sana).evaluateAll((items) => items.map((item) => Number(item.dataset.seq)));
  expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  expect(new Set(seqs).size).toBe(seqs.length);
  await ageMessages();
});

test("13. there is no way to edit or delete a message", async () => {
  // Nothing on either screen offers it, and no address exists for it. (No service
  // can change or remove a message either: tests/services/05-chat.)
  const before = await storedMessages(raviSana.matchId);
  for (const who of ["ravi", "sana"]) {
    const page = pages[who];
    await page.goto(chatUrl(raviSana));
    await expect(bubbles(page).last()).toBeVisible();
    await expect(page.getByRole("button", { name: /edit|delete|unsend|remove/i }).filter({ visible: true })).toHaveCount(0);
    await bubbles(page).last().click({ button: "right" });
    await expect(page.getByRole("menu")).toHaveCount(0);
    for (const method of ["put", "patch", "delete"]) {
      const response = await page.context().request[method](`${chatUrl(raviSana)}/events`, { failOnStatusCode: false });
      expect(response.status(), method).toBeGreaterThanOrEqual(400);
    }
  }
  expect(await storedMessages(raviSana.matchId)).toEqual(before);
});

test("16 & 17. reporting from a chat stores a protected report; the reported student sees nothing of it", async () => {
  const sana = pages.sana;
  await sana.getByRole("button", { name: "Report user" }).filter({ visible: true }).click();
  const dialog = sana.getByRole("dialog", { name: "Report Ravi" });
  await expect(dialog.getByRole("combobox", { name: "What is wrong?" }).locator("option")).toHaveText([
    "Choose a reason",
    "Harassment or abusive messages",
    "Threats or intimidation",
    "Spam or scam",
    "Fake or misleading profile",
    "Inappropriate content",
    "Other",
  ]);
  // A reason is required.
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("Choose a reason.")).toBeVisible();
  await dialog.getByLabel("What is wrong?").selectOption({ label: "Threats or intimidation" });
  await dialog.getByLabel("What happened?").fill("Test report from the chat screen.");
  await dialog.getByLabel(/Share the last 20 messages/).check();
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("Report sent to the moderators. Thank you.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  const { Report } = await db();
  const rows = await Report.find({ reporter_id: ids.sana }).lean();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ reported_user_id: ids.ravi, event_id: event.id, match_id: raviSana.matchId, reason: "threats", details: "Test report from the chat screen.", status: "open" });
  expect(rows[0].evidence.length).toBeGreaterThan(5);
  expect(rows[0].evidence.length).toBeLessThanOrEqual(20);
  expect(rows[0].evidence.at(-1)).toMatchObject({ body: "Live again", from: "reported" });
  expect(JSON.stringify(rows[0].evidence)).not.toContain(ids.ravi); // "reporter"/"reported", never an account id

  // A second report of the same conversation does not pile up.
  await sana.reload();
  await sana.getByRole("button", { name: "Report user" }).filter({ visible: true }).click();
  await dialog.getByLabel("What is wrong?").selectOption({ label: "Spam or scam" });
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(dialog.getByText("You have already reported this conversation. The moderators have it.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  expect(await Report.countDocuments({ match_id: raviSana.matchId })).toBe(1);
  // Ravi's screen shows nothing about having been reported.
  await pages.ravi.reload();
  await expect(pages.ravi.getByText(/report(ed)? /i).filter({ visible: true })).toHaveCount(0);
});

test("14 & 15. a block stops messages from both sides, keeps the history readable, and names nobody", async () => {
  const [ravi, sana] = [pages.ravi, pages.sana];
  await ravi.goto(chatUrl(raviSana));
  const historyBefore = await storedMessages(raviSana.matchId);

  await sana.getByRole("button", { name: "Block Ravi" }).filter({ visible: true }).click();
  const dialog = sana.getByRole("dialog", { name: "Block Ravi?" });
  await expect(dialog).toContainText("Ravi is not told.");
  await dialog.getByRole("button", { name: "Block Ravi" }).click();

  // The blocker: no message box, a neutral notice, her own block mentioned to her only; history still there.
  const sanaChat = sana.getByRole("region", { name: "Chat with Sana" }).or(sana.getByRole("region", { name: "Chat with Ravi" })).filter({ visible: true });
  await expect(sanaChat.getByText("Messaging is unavailable in this conversation.")).toBeVisible();
  await expect(sanaChat.getByText("You blocked Ravi")).toBeVisible();
  await expect(box(sana)).toHaveCount(0);
  await expect(bubbles(sana).filter({ hasText: "Live again" })).toHaveCount(1);

  // The blocked person still has the box on screen (nothing told them). Their next message is refused by the server.
  await box(ravi).fill("Hello? Are we still on?");
  await sendButton(ravi).click();
  const raviChat = ravi.getByRole("region", { name: "Chat with Sana" }).filter({ visible: true });
  await expect(raviChat.locator("li[data-pending='failed']")).toContainText("Messaging is unavailable in this conversation.");
  await expect(raviChat.getByText("You can still read the messages above.")).toBeVisible();
  await expect(box(ravi)).toHaveCount(0);
  await expect(raviChat.getByText(/blocked/i)).toHaveCount(0); // not told who or why
  await shot(ravi, "chat-unavailable");

  // Their conversation from the other event is closed too; Ravi's chat with Tara is not.
  await ravi.goto(chatUrl(raviSanaSecond));
  await expect(ravi.getByText("Messaging is unavailable in this conversation.").filter({ visible: true })).toBeVisible();
  await expect(box(ravi)).toHaveCount(0);
  await ravi.goto(chatUrl(raviTara));
  await send(ravi, "Still fine with Tara");
  await ravi.goto(chatUrl(raviSana));

  // 15. After reloading, both still read the history; neither can write. Nothing was deleted.
  await ravi.reload();
  await expect(bubbles(ravi).filter({ hasText: "Live again" })).toHaveCount(1);
  await expect(box(ravi)).toHaveCount(0);
  await expect(ravi.getByText("Messaging is unavailable in this conversation.").filter({ visible: true })).toBeVisible();
  await expect(ravi.getByRole("region", { name: "Chat with Sana" }).filter({ visible: true }).getByText(/blocked/i)).toHaveCount(0);
  await expect(ravi.getByRole("region", { name: "Chat with Sana" }).filter({ visible: true }).locator("header img")).toHaveCount(0); // photo hidden across a block
  expect(await storedMessages(raviSana.matchId)).toEqual(historyBefore);
  const { Block, Match } = await db();
  expect(await Match.countDocuments({ _id: raviSana.matchId })).toBe(1);
  expect(await Block.countDocuments({ blocker_id: ids.sana, blocked_id: ids.ravi })).toBe(1);

  // The list agrees with the chat screen.
  await ravi.goto("/matches");
  await expect(ravi.getByText("Blocked by you").filter({ visible: true })).toHaveCount(0);
  await sana.goto("/matches");
  await expect(sana.getByRole("listitem").filter({ hasText: eventTitle }).getByText("Blocked by you")).toBeVisible();

  // Sana removes the block; messaging works again for both.
  await sana.getByRole("button", { name: "Unblock Ravi" }).click();
  await expect(sana.getByText("Nobody. You can block someone from their card")).toBeVisible();
  await ravi.goto(chatUrl(raviSana));
  await send(ravi, "Back in touch");
  await sana.goto(chatUrl(raviSana));
  await expect(bubbles(sana).filter({ hasText: "Back in touch" })).toHaveCount(1);
  await expect(box(sana)).toBeVisible();
});

test("18 & 19. conversations stay with their own event, and closing a discovery profile keeps match and history", async () => {
  const ravi = pages.ravi;
  // The same two students have a second, separate conversation for the other event.
  await ravi.goto(chatUrl(raviSanaSecond));
  await expect(ravi.getByRole("region", { name: "Chat with Sana" }).filter({ visible: true }).getByRole("link", { name: secondTitle })).toBeVisible();
  await expect(ravi.getByText("You and Sana matched").filter({ visible: true })).toBeVisible();
  await send(ravi, "About the freshers mixer");
  expect(await storedMessages(raviSanaSecond.matchId)).toMatchObject([{ seq: 1, body: "About the freshers mixer" }]);
  expect((await storedMessages(raviSana.matchId)).length).toBeGreaterThan(10);

  // 19. Ravi closes his discovery profile for the first event.
  const before = await storedMessages(raviSana.matchId);
  await ravi.goto(`/events/${event.slug}/partners`);
  await ravi.getByRole("button", { name: "Close My Profile for This Event" }).click();
  await ravi.getByRole("dialog").getByRole("button", { name: "Yes, close my profile" }).click();
  await expect(ravi.getByRole("region", { name: "Your profile for this event" })).toContainText("Closed");
  await ravi.goto("/matches");
  await expect(ravi.getByRole("listitem").filter({ hasText: eventTitle }).filter({ hasText: "Sana" }).getByTestId("last-message")).toContainText("You: Back in touch");
  await ravi.goto(chatUrl(raviSana));
  await expect(bubbles(ravi).filter({ hasText: "Back in touch" })).toHaveCount(1);
  await send(ravi, "Profile closed, chat still open");
  expect(await storedMessages(raviSana.matchId)).toHaveLength(before.length + 1);
  await ageMessages();
});

test("the rate limit is real: the 21st message in a minute is refused with a clear message", async () => {
  const tara = pages.tara;
  await tara.goto(chatUrl(raviTara));
  // Twenty messages from her within the last minute (stored directly, to keep the test short).
  for (let i = 1; i <= 20; i += 1) await storeMessage(raviTara.matchId, ids.tara, `burst ${i}`);
  await box(tara).fill("One too many");
  await sendButton(tara).click();
  const failed = log(tara).locator("li[data-pending='failed']");
  await expect(failed).toContainText("You are sending messages very quickly. Wait a moment, then try again.");
  await expect(box(tara)).toBeVisible(); // still allowed to write — just not yet

  await shot(tara, "chat-failed");
  // After the wait, "Try again" sends the very same message (once).
  await ageMessages();
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(bubbles(tara).filter({ hasText: "One too many" })).toHaveCount(1);
  await expect(log(tara).locator("li[data-pending]")).toHaveCount(0);
  expect((await storedMessages(raviTara.matchId)).filter((m) => m.body === "One too many")).toHaveLength(1);
  await ageMessages();
});

test("a suspended student loses the conversation; the other keeps the history but cannot send", async () => {
  const { Profile } = await db();
  await Profile.updateOne({ _id: ids.tara }, { $set: { status: "suspended" } });
  await pages.tara.goto(chatUrl(raviTara));
  await expect(pages.tara.getByRole("heading", { name: "Your account is suspended" }).filter({ visible: true })).toBeVisible();
  expect((await pages.tara.context().request.get(`${chatUrl(raviTara)}/events`)).status()).toBe(404); // her live stream is gone too

  await pages.ravi.goto(chatUrl(raviTara));
  await expect(bubbles(pages.ravi).filter({ hasText: "One too many" })).toHaveCount(1);
  await expect(pages.ravi.getByText("Messaging is unavailable in this conversation.").filter({ visible: true })).toBeVisible();
  await Profile.updateOne({ _id: ids.tara }, { $set: { status: "active" } });
});

test("on a phone: full-height chat, message box on screen, no sideways scrolling", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(emails.sana);
  await page.getByLabel("Password").fill("correct-horse-battery-9");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/matches");
  const tabs = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
  await expect(tabs).toHaveCount(1); // the bottom tab bar
  await page.getByRole("link", { name: "Open chat with Ravi" }).first().click();
  await expect(page).toHaveURL(new RegExp(`${chatUrl(raviSana)}$`));

  await expect(box(page)).toBeInViewport({ ratio: 1 });
  await expect(sendButton(page)).toBeInViewport({ ratio: 1 });
  await expect(bubbles(page).last()).toBeInViewport();
  await expect(page.getByRole("link", { name: "Back to my matches" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("navigation", { name: "Main" }).filter({ visible: true })).toHaveCount(0); // tab bar steps aside
  const overflow = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - window.innerWidth, y: document.documentElement.scrollHeight - window.innerHeight }));
  expect(overflow.x).toBeLessThanOrEqual(0);
  expect(overflow.y).toBeLessThanOrEqual(1); // the page itself does not scroll; the history does

  // On a touch screen, Enter makes a new line; the button sends.
  await box(page).fill("From my phone");
  await box(page).press("Enter");
  await expect(bubbles(page).filter({ hasText: "From my phone" })).toHaveCount(0);
  await sendButton(page).click();
  await expect(bubbles(page).filter({ hasText: "From my phone" })).toHaveCount(1);
  await shot(page, "chat-mobile");
  await context.close();
});

test("an expired session: the next action sends the student to log in", async () => {
  const sana = pages.sana;
  await sana.goto(chatUrl(raviSana));
  await expect(box(sana)).toBeVisible();
  await sana.context().clearCookies();
  await box(sana).fill("After my session ended");
  // The press leads to a full page load a moment later; do not let the click itself wait on it
  // (Playwright occasionally stalls there although the browser has already arrived).
  await sendButton(sana).click({ noWaitAfter: true });
  // One navigation, by a full page load, with the way back to this conversation.
  await expect(sana).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(chatUrl(raviSana))}$`), { timeout: 15_000 });
  await expect(sana.getByRole("heading", { name: "Log in" })).toBeVisible();
  expect((await storedMessages(raviSana.matchId)).some((m) => m.body === "After my session ended")).toBe(false);
});
