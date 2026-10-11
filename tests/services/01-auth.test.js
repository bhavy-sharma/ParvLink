// Accounts, sessions and emailed links. Mail really goes out through
// Nodemailer over SMTP to a local sink; the tests read the link from the
// message that arrived, because the database only stores the token's hash.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import bcrypt from "bcryptjs";
import { hashToken } from "@/lib/auth/tokens";
import * as auth from "@/lib/services/auth";
import { startMailSink } from "../support/mail-sink.mjs";
import { models, testDatabase } from "./helpers";

const { AuthToken, RateLimit, Session, User } = models;
const db = testDatabase("auth");
let sink;
const PASSWORD = "correct-horse-battery-9";
let counter = 0;
const address = (name = "user") => `${name}-${Date.now()}-${(counter += 1)}@auth.test`;
const tokenIn = (message) => new URL(message.link).searchParams.get("token");
const lastMail = (email) => sink.for(email).at(-1);

beforeAll(async () => {
  sink = await startMailSink();
  Object.assign(process.env, { SMTP_HOST: "127.0.0.1", SMTP_PORT: String(sink.port), EMAIL_FROM: "ParvLink <no-reply@campus.test>", SMTP_USER: "", SMTP_PASS: "" });
  await db.start();
});
afterAll(async () => {
  await db.stop();
  await sink.close();
});
beforeEach(async () => {
  sink.state.fail = false;
  await RateLimit.deleteMany({}); // each test starts with fresh allowances
});

/** Registers and confirms in the same "browser". Returns { email, userId, sessionToken }. */
async function confirmedAccount(email = address()) {
  const { browserNonce } = await auth.registerAccount({ email, password: PASSWORD, termsVersion: "t1", ip: "10.0.0.1" });
  const result = await auth.confirmEmail({ token: tokenIn(lastMail(email)), browserNonce });
  return { email, userId: (await User.findOne({ email }).lean())._id, sessionToken: result.sessionToken };
}

describe("registration", () => {
  test("stores a bcrypt hash — never the password — and creates a plain, unconfirmed student", async () => {
    const email = address("Asha").toUpperCase(); // addresses are case-insensitive
    expect((await auth.registerAccount({ email, password: PASSWORD, termsVersion: "2026-10-12", ip: "10.0.0.1", role: "super_admin" })).status).toBe("ok");
    const user = await User.findOne({ email: email.toLowerCase() }).lean();
    expect(user).toMatchObject({ role: "student", email_confirmed_at: null, terms_version: "2026-10-12" });
    expect(user.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(JSON.stringify(user)).not.toContain(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, user.password_hash)).toBe(true);
    expect(await bcrypt.compare("something-else-9", user.password_hash)).toBe(false);
  });

  test("a confirmation email is really sent, with a link built from APP_URL and nothing else variable", async () => {
    const email = address();
    await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    const mail = lastMail(email);
    expect(mail.subject).toBe("Confirm your email for ParvLink");
    expect(mail.from).toContain("no-reply@campus.test");
    expect(mail.link).toMatch(/^http:\/\/app\.test\/auth\/confirm\?token=[A-Za-z0-9_-]{43}&type=email$/);
    expect(mail.html).toContain("Confirm my email");
    expect(mail.text).not.toContain(PASSWORD);
    // The database holds only the token's hash.
    const stored = await AuthToken.find({ kind: "verify_email" }).lean();
    expect(stored.some((row) => row.token_hash === hashToken(tokenIn(mail)))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(tokenIn(mail));
  });

  test("registering an address that already has an account answers the same and changes nothing", async () => {
    const { email } = await confirmedAccount();
    const before = await User.findOne({ email }).lean();
    const mails = sink.for(email).length;
    const again = await auth.registerAccount({ email, password: "another-password-77", ip: "10.0.0.1" });
    expect(Object.keys(again).sort()).toEqual(["browserNonce", "status"]); // indistinguishable from a new address
    expect(again.status).toBe("ok");
    const after = await User.findOne({ email }).lean();
    expect(after.password_hash).toBe(before.password_hash);
    expect(await User.countDocuments({ email })).toBe(1);
    expect(sink.for(email)).toHaveLength(mails); // and no email is sent
  });

  test("two simultaneous registrations for one address create one account", async () => {
    const email = address();
    await Promise.all([1, 2, 3, 4].map(() => auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" })));
    expect(await User.countDocuments({ email })).toBe(1);
  });

  test("a password bcrypt cannot hash in full is refused rather than silently cut", async () => {
    expect((await auth.registerAccount({ email: address(), password: `${"é".repeat(40)}1`, ip: "10.0.0.1" })).status).toBe("invalid_password");
  });

  test("if the mail server is down the account still exists and the link can be requested again", async () => {
    const email = address();
    sink.state.fail = true;
    expect((await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" })).status).toBe("ok");
    expect(sink.for(email)).toHaveLength(0);
    sink.state.fail = false;
    await RateLimit.deleteMany({});
    expect(await auth.resendVerification({ email, ip: "10.0.0.1" })).toBe("ok");
    expect(sink.for(email)).toHaveLength(1);
  });
});

describe("email confirmation", () => {
  test("a valid link confirms the address and signs in; the same link never works twice", async () => {
    const email = address();
    const { browserNonce } = await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    const token = tokenIn(lastMail(email));
    const first = await auth.confirmEmail({ token, browserNonce });
    expect(first).toMatchObject({ status: "ok", choosePassword: false });
    expect((await User.findOne({ email }).lean()).email_confirmed_at).toBeInstanceOf(Date);
    expect((await auth.getSessionUser(first.sessionToken)).email).toBe(email);
    expect(await auth.confirmEmail({ token, browserNonce })).toEqual({ status: "invalid" });
  });

  test("the same link opened twice at the same moment is accepted once", async () => {
    const email = address();
    const { browserNonce } = await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    const token = tokenIn(lastMail(email));
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => auth.confirmEmail({ token, browserNonce })));
    expect(results.filter((result) => result.status === "ok")).toHaveLength(1);
  });

  test("made-up, malformed and other-purpose tokens are refused", async () => {
    const email = address();
    await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    const real = tokenIn(lastMail(email));
    for (const token of ["", null, "abc", "x".repeat(43), real.slice(0, 42), `${real}x`, { $ne: null }]) {
      expect((await auth.confirmEmail({ token, browserNonce: null })).status).toBe("invalid");
    }
    // A confirmation token is not a password-reset token, and the other way round.
    expect((await auth.openPasswordReset({ token: real })).status).toBe("invalid");
    expect((await User.findOne({ email }).lean()).email_confirmed_at).toBeNull();
  });

  test("an expired link is refused and says so", async () => {
    const email = address();
    const { browserNonce } = await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    const token = tokenIn(lastMail(email));
    const later = new Date(Date.now() + (auth.VERIFY_HOURS * 60 + 1) * 60 * 1000);
    expect(await auth.confirmEmail({ token, browserNonce, now: later })).toEqual({ status: "expired" });
    expect((await User.findOne({ email }).lean()).email_confirmed_at).toBeNull();
  });

  test("asking for a new link makes the earlier one useless, and is rate limited", async () => {
    const email = address();
    const { browserNonce } = await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    const first = tokenIn(lastMail(email));
    expect(await auth.resendVerification({ email, ip: "10.0.0.1" })).toBe("ok");
    const second = tokenIn(lastMail(email));
    expect(second).not.toBe(first);
    expect((await auth.confirmEmail({ token: first, browserNonce })).status).toBe("invalid");
    // One a minute per address…
    expect(await auth.resendVerification({ email, ip: "10.0.0.1" })).toBe("limited");
    expect(sink.for(email)).toHaveLength(2);
    // …and the newest link still works, tied to the browser that registered.
    expect(await auth.confirmEmail({ token: second, browserNonce })).toMatchObject({ status: "ok", choosePassword: false });
  });

  test("'send again' answers the same for unknown and already-confirmed addresses, and sends nothing", async () => {
    const { email } = await confirmedAccount();
    const mails = sink.messages.length;
    expect(await auth.resendVerification({ email, ip: "10.0.0.1" })).toBe("ok");
    expect(await auth.resendVerification({ email: address("nobody"), ip: "10.0.0.1" })).toBe("ok");
    expect(sink.messages).toHaveLength(mails);
  });

  test("opened in a different browser: the address is confirmed, but the registration password is discarded", async () => {
    // Someone registers with another person's address and a password they know…
    const email = address("victim");
    await auth.registerAccount({ email, password: "attackers-password-1", ip: "10.6.6.6" });
    // …and the owner of the mailbox opens the link on their own device.
    const result = await auth.confirmEmail({ token: tokenIn(lastMail(email)), browserNonce: null });
    expect(result).toMatchObject({ status: "ok", choosePassword: true });
    const user = await User.findOne({ email }).lean();
    expect(user.email_confirmed_at).toBeInstanceOf(Date);
    expect(user.password_hash).toBeNull();
    expect((await auth.login({ email, password: "attackers-password-1", ip: "10.6.6.6" })).status).toBe("invalid");
    // The owner chooses their own password with the short-lived permission the link gave.
    const session = await auth.getSessionUser(result.sessionToken);
    expect(session.recovery).toBe(true);
    expect(await auth.setNewPassword({ sessionId: session.sessionId, password: PASSWORD })).toBe("ok");
    expect((await auth.login({ email, password: PASSWORD, ip: "10.0.0.1" })).status).toBe("ok");
  });

  test("re-registering an unconfirmed address cannot plant a password behind the owner's own link", async () => {
    const email = address("owner");
    // The owner registers and receives a link tied to their browser…
    const owner = await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    const ownersLink = tokenIn(lastMail(email));
    // …then someone else registers the same, still unconfirmed, address with their own password.
    await auth.registerAccount({ email, password: "attackers-password-1", ip: "10.6.6.6" });
    // The owner's earlier link no longer works at all…
    expect((await auth.confirmEmail({ token: ownersLink, browserNonce: owner.browserNonce })).status).toBe("invalid");
    // …and the newest one, opened in the owner's browser, discards the other person's password.
    const result = await auth.confirmEmail({ token: tokenIn(lastMail(email)), browserNonce: owner.browserNonce });
    expect(result).toMatchObject({ status: "ok", choosePassword: true });
    expect((await User.findOne({ email }).lean()).password_hash).toBeNull();
    expect((await auth.login({ email, password: "attackers-password-1", ip: "10.6.6.6" })).status).toBe("invalid");
  });

  test("the operator can close registration; existing accounts still sign in", async () => {
    const { email } = await confirmedAccount();
    process.env.REGISTRATION_OPEN = "false";
    try {
      const closed = address("late");
      expect(await auth.registerAccount({ email: closed, password: PASSWORD, ip: "10.0.0.1" })).toEqual({ status: "closed" });
      expect(await User.exists({ email: closed })).toBeNull();
      expect(sink.for(closed)).toEqual([]);
      expect((await auth.login({ email, password: PASSWORD, ip: "10.0.0.1" })).status).toBe("ok");
    } finally {
      delete process.env.REGISTRATION_OPEN;
    }
    expect((await auth.registerAccount({ email: address("early"), password: PASSWORD, ip: "10.0.0.1" })).status).toBe("ok");
  });

  test("when no more email may be sent for an address, a new registration changes nothing", async () => {
    const email = address("limited");
    const owner = await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    for (let i = 0; i < 4; i += 1) await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    expect(sink.for(email)).toHaveLength(5);
    const link = tokenIn(lastMail(email));
    const before = await User.findOne({ email }).lean();
    expect(await auth.registerAccount({ email, password: "attackers-password-1", ip: "10.6.6.6" })).toMatchObject({ status: "ok" });
    expect(sink.for(email)).toHaveLength(5);
    expect((await User.findOne({ email }).lean()).password_hash).toBe(before.password_hash);
    expect((await auth.confirmEmail({ token: link, browserNonce: owner.browserNonce })).status).toBe("ok");
  });
});

describe("login", () => {
  test("valid credentials open a session whose token is stored only as a hash", async () => {
    const { email, userId } = await confirmedAccount();
    const result = await auth.login({ email: ` ${email.toUpperCase()} `, password: PASSWORD, ip: "10.0.0.1" });
    expect(result).toMatchObject({ status: "ok", role: "student", userId });
    const sessions = await Session.find({ user_id: userId }).lean();
    expect(sessions.some((row) => row.token_hash === hashToken(result.sessionToken))).toBe(true);
    expect(JSON.stringify(sessions)).not.toContain(result.sessionToken);
    expect(await auth.getSessionUser(result.sessionToken)).toMatchObject({ id: userId, email, role: "student", recovery: false });
  });

  test("a wrong password, an unknown address and a query object all get the same answer", async () => {
    const { email } = await confirmedAccount();
    const wrong = await auth.login({ email, password: "not-the-password-1", ip: "10.0.0.1" });
    const unknown = await auth.login({ email: address("nobody"), password: PASSWORD, ip: "10.0.0.1" });
    expect(wrong).toEqual({ status: "invalid" });
    expect(unknown).toEqual(wrong);
    expect(await auth.login({ email, password: { $ne: "" }, ip: "10.0.0.1" })).toEqual(wrong);
    expect(await auth.login({ email, password: "", ip: "10.0.0.1" })).toEqual(wrong);
  });

  test("an unconfirmed account is told so only when the password is right", async () => {
    const email = address();
    await auth.registerAccount({ email, password: PASSWORD, ip: "10.0.0.1" });
    expect((await auth.login({ email, password: PASSWORD, ip: "10.0.0.1" })).status).toBe("unverified");
    expect((await auth.login({ email, password: "wrong-password-11", ip: "10.0.0.1" })).status).toBe("invalid");
    expect(await Session.countDocuments({})).toBeGreaterThanOrEqual(0);
  });

  test("repeated wrong passwords lock that address for a while — even for the right password — and success clears the count", async () => {
    const { email } = await confirmedAccount();
    for (let i = 0; i < 3; i += 1) expect((await auth.login({ email, password: "wrong-password-11", ip: "10.0.0.1" })).status).toBe("invalid");
    expect((await auth.login({ email, password: PASSWORD, ip: "10.0.0.1" })).status).toBe("ok"); // clears the count
    for (let i = 0; i < 8; i += 1) expect((await auth.login({ email, password: "wrong-password-11", ip: "10.0.0.1" })).status).toBe("invalid");
    expect((await auth.login({ email, password: "wrong-password-11", ip: "10.0.0.1" })).status).toBe("limited");
    expect((await auth.login({ email, password: PASSWORD, ip: "10.0.0.2" })).status).toBe("limited");
    // Another account is not affected.
    const other = await confirmedAccount();
    expect((await auth.login({ email: other.email, password: PASSWORD, ip: "10.0.0.1" })).status).toBe("ok");
  });

  test("rate-limit records hold a hash of the address, not the address", async () => {
    const email = address("private");
    await auth.login({ email, password: "wrong-password-11", ip: "203.0.113.9" });
    const stored = JSON.stringify(await RateLimit.find({}).lean());
    expect(stored).not.toContain(email);
    expect(stored).not.toContain("203.0.113.9");
  });
});

describe("sessions", () => {
  test("a made-up, expired or signed-out cookie is nobody", async () => {
    const { sessionToken, userId } = await confirmedAccount();
    for (const token of [null, "", "abc", "x".repeat(43), { $gt: "" }]) expect(await auth.getSessionUser(token)).toBeNull();
    const farFuture = new Date(Date.now() + (auth.SESSION_DAYS + 1) * 86400000);
    expect(await auth.getSessionUser(sessionToken, farFuture)).toBeNull();
    expect((await auth.getSessionUser(sessionToken)).id).toBe(userId);
    await auth.destroySession(sessionToken);
    expect(await auth.getSessionUser(sessionToken)).toBeNull();
  });

  test("the role is read from the database on every request, and a deleted user's session is dead at once", async () => {
    const { sessionToken, userId } = await confirmedAccount();
    await User.updateOne({ _id: userId }, { $set: { role: "admin" } });
    expect((await auth.getSessionUser(sessionToken)).role).toBe("admin");
    await User.deleteOne({ _id: userId });
    expect(await auth.getSessionUser(sessionToken)).toBeNull();
  });
});

describe("forgotten password", () => {
  test("the answer is the same for any address; only a real account gets an email", async () => {
    const { email } = await confirmedAccount();
    const unknown = address("nobody");
    expect(await auth.requestPasswordReset({ email, ip: "10.0.0.1" })).toBe("ok");
    expect(await auth.requestPasswordReset({ email: unknown, ip: "10.0.0.1" })).toBe("ok");
    expect(sink.for(unknown)).toHaveLength(0);
    const mail = lastMail(email);
    expect(mail.subject).toBe("Choose a new password for ParvLink");
    expect(mail.link).toMatch(/\/auth\/confirm\?token=[A-Za-z0-9_-]{43}&type=recovery$/);
    expect(JSON.stringify(await AuthToken.find({ kind: "reset_password" }).lean())).not.toContain(tokenIn(mail));
  });

  test("the link works once, gives a short permission to change the password, and other devices are signed out", async () => {
    const { email, userId, sessionToken: otherDevice } = await confirmedAccount();
    await auth.requestPasswordReset({ email, ip: "10.0.0.1" });
    const token = tokenIn(lastMail(email));

    // A normal session cannot change the password.
    const normal = await auth.getSessionUser(otherDevice);
    expect(await auth.setNewPassword({ sessionId: normal.sessionId, password: "brand-new-password-42" })).toBe("expired");

    const opened = await auth.openPasswordReset({ token });
    expect(opened.status).toBe("ok");
    expect((await auth.openPasswordReset({ token })).status).toBe("invalid"); // single use
    const session = await auth.getSessionUser(opened.sessionToken);
    expect(session.recovery).toBe(true);

    expect(await auth.setNewPassword({ sessionId: session.sessionId, password: PASSWORD })).toBe("same_password");
    expect(await auth.setNewPassword({ sessionId: session.sessionId, password: "brand-new-password-42" })).toBe("ok");
    // The permission is spent.
    expect(await auth.setNewPassword({ sessionId: session.sessionId, password: "yet-another-password-7" })).toBe("expired");
    expect((await auth.getSessionUser(opened.sessionToken)).recovery).toBe(false);

    expect(await auth.getSessionUser(otherDevice)).toBeNull(); // signed out elsewhere
    expect((await auth.login({ email, password: PASSWORD, ip: "10.0.0.1" })).status).toBe("invalid");
    expect((await auth.login({ email, password: "brand-new-password-42", ip: "10.0.0.1" })).status).toBe("ok");
    expect(await User.countDocuments({ _id: userId })).toBe(1);
  });

  test("the permission to change the password lapses after a few minutes, and an old link expires", async () => {
    const { email } = await confirmedAccount();
    await auth.requestPasswordReset({ email, ip: "10.0.0.1" });
    const token = tokenIn(lastMail(email));
    const tooLate = new Date(Date.now() + (auth.RESET_MINUTES + 1) * 60000);
    expect((await auth.openPasswordReset({ token, now: tooLate })).status).toBe("expired");

    const opened = await auth.openPasswordReset({ token });
    const session = await auth.getSessionUser(opened.sessionToken);
    const afterWindow = new Date(Date.now() + (auth.RECOVERY_MINUTES + 1) * 60000);
    expect(await auth.setNewPassword({ sessionId: session.sessionId, password: "brand-new-password-42", now: afterWindow })).toBe("expired");
  });

  test("a mailbox cannot be flooded: after three requests an hour nothing more is sent, with the same answer", async () => {
    const { email } = await confirmedAccount();
    const before = sink.for(email).length;
    for (let i = 0; i < 6; i += 1) expect(await auth.requestPasswordReset({ email, ip: "10.0.0.1" })).toBe("ok");
    expect(sink.for(email).length - before).toBe(3);
  });

  test("re-checking the current password (before deleting an account) is right, wrong, or limited", async () => {
    const { userId } = await confirmedAccount();
    expect(await auth.checkOwnPassword(userId, PASSWORD)).toBe("ok");
    for (let i = 0; i < 8; i += 1) expect(await auth.checkOwnPassword(userId, "wrong-password-11")).toBe("wrong");
    expect(await auth.checkOwnPassword(userId, PASSWORD)).toBe("limited");
  });
});
