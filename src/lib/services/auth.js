import "server-only";

// Accounts, sessions and the emailed links (confirm address, reset password).
//
// Nothing here reads cookies or headers: the Server Actions and route handlers
// do that and pass plain values in, which keeps these rules testable.
//
// Rules worth knowing:
//   * Passwords are stored as bcrypt hashes only.
//   * Session, confirmation and reset tokens are random; the database stores
//     their SHA-256 hash. Emailed tokens work once and expire.
//   * Answers never reveal whether an address has an account.
//   * A confirmation link opened in a DIFFERENT browser from the one that
//     registered still confirms the address, but the password typed at
//     registration is discarded and a new one must be chosen. So somebody who
//     registers with another person's address never ends up knowing the
//     password of the account that person then confirms.

import { hashPassword, passwordFitsBcrypt, verifyPassword } from "@/lib/auth/passwords";
import { consume, isLimited, reset as resetLimit } from "@/lib/auth/rate-limit";
import { hashToken, looksLikeToken, newToken, sameHash } from "@/lib/auth/tokens";
import { connectDb, isDuplicateKey } from "@/lib/db/connection";
import { AuthToken, Session, User } from "@/lib/db/models";
import { MailNotConfiguredError, sendMail } from "@/lib/mail/mailer";
import { passwordResetEmail, verificationEmail } from "@/lib/mail/messages";
import { getSiteUrl } from "@/lib/site-url";

export const VERIFY_HOURS = 24;
export const RESET_MINUTES = 60;
export const RECOVERY_MINUTES = 15;
export const SESSION_DAYS = 30;
const TOUCH_AFTER_MS = 10 * 60 * 1000;

const minutes = (n) => n * 60 * 1000;
const normalizeEmail = (email) => String(email ?? "").trim().toLowerCase();
const log = (scope, error) => console.error(`[${scope}]`, error?.code ?? error?.name ?? "error");

// ----------------------------------------------------------------------------- sessions
/** Opens a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(userId, { recovery = false, now = new Date() } = {}) {
  await connectDb();
  const token = newToken();
  await Session.create({
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    last_seen_at: now,
    recovery_until: recovery ? new Date(now.getTime() + minutes(RECOVERY_MINUTES)) : null,
  });
  return token;
}

/**
 * The signed-in user for a cookie value, or null. Looks the session up by the
 * token's hash, refuses expired ones, and reads the user fresh from the
 * database — so a role change, deletion or sign-out applies on the next request.
 */
export async function getSessionUser(token, now = new Date()) {
  if (!looksLikeToken(token)) return null;
  await connectDb();
  const session = await Session.findOne({ token_hash: hashToken(token) }).lean();
  if (!session || session.expires_at <= now) return null;
  const user = await User.findById(session.user_id).select("email role email_confirmed_at").lean();
  if (!user) return null;
  if (now - session.last_seen_at > TOUCH_AFTER_MS) {
    await Session.updateOne({ _id: session._id }, { $set: { last_seen_at: now } }).catch(() => {});
  }
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    email_confirmed_at: user.email_confirmed_at ? user.email_confirmed_at.toISOString() : null,
    sessionId: session._id,
    // True for a few minutes after a reset (or cross-device confirmation) link was opened.
    recovery: Boolean(session.recovery_until && session.recovery_until > now),
  };
}

export async function destroySession(token) {
  if (!looksLikeToken(token)) return;
  await connectDb();
  await Session.deleteOne({ token_hash: hashToken(token) });
}

/** Ends every session of a user, optionally keeping one (the device that just changed the password). */
export async function destroyUserSessions(userId, { exceptSessionId = null } = {}) {
  await connectDb();
  await Session.deleteMany(exceptSessionId ? { user_id: userId, _id: { $ne: exceptSessionId } } : { user_id: userId });
}

// ----------------------------------------------------------------------------- emailed links
async function issueToken(userId, kind, { ttlMs, browserHash = null, now = new Date() }) {
  // One working link per purpose: asking again makes earlier links useless.
  await AuthToken.deleteMany({ user_id: userId, kind });
  const token = newToken();
  await AuthToken.create({ user_id: userId, kind, token_hash: hashToken(token), browser_hash: browserHash, expires_at: new Date(now.getTime() + ttlMs) });
  return token;
}

const linkFor = (token, type) => `${getSiteUrl()}/auth/confirm?token=${token}&type=${type}`;

/**
 * Sends an email, or explains why it could not. Never throws: the caller's
 * answer to the person is the same either way. In development without SMTP the
 * message is printed to the server console so the flow can still be tried.
 */
async function deliver(scope, to, message) {
  try {
    await sendMail({ to, ...message });
    return true;
  } catch (error) {
    if (error instanceof MailNotConfiguredError && process.env.NODE_ENV !== "production") {
      console.warn(`[${scope}] SMTP is not configured — DEVELOPMENT ONLY, the email would have been:\n  To: ${to}\n  ${message.text.replace(/\n/g, "\n  ")}`);
      return true;
    }
    log(scope, error);
    return false;
  }
}

// ----------------------------------------------------------------------------- registration
/**
 * Creates the account (or refreshes a not-yet-confirmed one) and emails a
 * confirmation link. The return value is the same for a new address and for
 * one that already has a confirmed account.
 *   → { status: "ok", browserNonce } | { status: "limited" } | { status: "invalid_password" } | { status: "closed" }
 */
export async function registerAccount({ email, password, termsVersion, ip }) {
  await connectDb();
  const address = normalizeEmail(email);
  // The operator's switch for the beta (docs/LAUNCH.md): existing accounts are unaffected.
  if (process.env.REGISTRATION_OPEN === "false") return { status: "closed" };
  if (!passwordFitsBcrypt(password)) return { status: "invalid_password" };
  if (!(await consume("registerPerIp", ip ?? "unknown")).allowed) return { status: "limited" };

  // The nonce is handed to this browser as a cookie; its hash travels with the token.
  const browserNonce = newToken();
  const existing = await User.findOne({ email: address }).select("email_confirmed_at").lean();
  if (existing?.email_confirmed_at) return { status: "ok", browserNonce }; // reveal nothing, send nothing

  const passwordHash = await hashPassword(password);
  const terms = { terms_version: termsVersion ?? null, terms_accepted_at: new Date() };
  let userId = existing?._id;
  if (userId) {
    // Still unconfirmed: the latest registration wins — but only together with
    // a fresh link (issuing one makes every earlier link useless), so a link
    // that was issued for one browser's password can never confirm an account
    // that now carries another's. When no email may be sent right now, nothing
    // changes at all.
    if (!(await consume("verifyEmailPerEmailHour", address)).allowed) return { status: "ok", browserNonce };
    await User.updateOne({ _id: userId, email_confirmed_at: null }, { $set: { password_hash: passwordHash, ...terms } });
  } else {
    try {
      // The role is fixed here. Nothing a browser sends can choose it.
      userId = (await User.create({ email: address, password_hash: passwordHash, role: "student", ...terms }))._id;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return { status: "ok", browserNonce }; // two registrations for one address raced; the other one sent the email
    }
    await consume("verifyEmailPerEmailHour", address);
  }

  const token = await issueToken(userId, "verify_email", { ttlMs: VERIFY_HOURS * 60 * 60 * 1000, browserHash: hashToken(browserNonce) });
  await deliver("auth.register.mail", address, verificationEmail(linkFor(token, "email"), { hours: VERIFY_HOURS }));
  return { status: "ok", browserNonce };
}

/** "Send the link again". → "ok" (also for unknown or already-confirmed addresses) | "limited" */
export async function resendVerification({ email, ip }) {
  await connectDb();
  const address = normalizeEmail(email);
  if (!(await consume("emailRequestsPerIp", ip ?? "unknown")).allowed) return "limited";
  const user = await User.findOne({ email: address }).select("email_confirmed_at").lean();
  if (!user || user.email_confirmed_at) return "ok";

  if (!(await consume("verifyEmailPerEmailMinute", address)).allowed) return "limited";
  if (!(await consume("verifyEmailPerEmailHour", address)).allowed) return "limited";
  // Keep the link tied to the browser that registered, if a link was issued before.
  const previous = await AuthToken.findOne({ user_id: user._id, kind: "verify_email" }).sort({ created_at: -1 }).select("browser_hash").lean();
  const token = await issueToken(user._id, "verify_email", { ttlMs: VERIFY_HOURS * 60 * 60 * 1000, browserHash: previous?.browser_hash ?? null });
  await deliver("auth.resend.mail", address, verificationEmail(linkFor(token, "email"), { hours: VERIFY_HOURS }));
  return "ok";
}

/** Marks a token as used — atomically, so two requests with the same link cannot both win. */
async function claimToken(token, kind, now) {
  if (!looksLikeToken(token)) return { status: "invalid" };
  const tokenHash = hashToken(token);
  const claimed = await AuthToken.findOneAndUpdate({ token_hash: tokenHash, kind, used_at: null, expires_at: { $gt: now } }, { $set: { used_at: now } }, { new: true }).lean();
  if (claimed) return { status: "ok", record: claimed };
  const seen = await AuthToken.findOne({ token_hash: tokenHash, kind }).select("used_at expires_at").lean();
  return { status: seen && !seen.used_at && seen.expires_at <= now ? "expired" : "invalid" };
}

/**
 * Opens a confirmation link.
 *   → { status: "ok", sessionToken, choosePassword } | { status: "expired" } | { status: "invalid" }
 * `browserNonce` is the cookie value set at registration, if this browser has one.
 */
export async function confirmEmail({ token, browserNonce, now = new Date() }) {
  await connectDb();
  const claim = await claimToken(token, "verify_email", now);
  if (claim.status !== "ok") return { status: claim.status };

  const user = await User.findById(claim.record.user_id).select("email_confirmed_at").lean();
  if (!user) return { status: "invalid" };
  const sameBrowser = Boolean(claim.record.browser_hash) && looksLikeToken(browserNonce) && sameHash(claim.record.browser_hash, hashToken(browserNonce));

  const changes = { email_confirmed_at: user.email_confirmed_at ?? now };
  // Opened somewhere else: confirm the address, but do not trust the password
  // that was typed at registration.
  if (!sameBrowser && !user.email_confirmed_at) changes.password_hash = null;
  await User.updateOne({ _id: user._id }, { $set: changes });
  await AuthToken.deleteMany({ user_id: user._id, kind: "verify_email", _id: { $ne: claim.record._id } });

  const choosePassword = !sameBrowser;
  return { status: "ok", choosePassword, sessionToken: await createSession(user._id, { recovery: choosePassword, now }) };
}

// ----------------------------------------------------------------------------- sign in
/**
 * → { status: "ok", sessionToken, role } | { status: "invalid" } | { status: "unverified" } | { status: "limited" }
 * "invalid" covers a wrong password, an unknown address and an account with no
 * usable password alike.
 */
export async function login({ email, password, ip }) {
  await connectDb();
  const address = normalizeEmail(email);
  if (!(await consume("loginPerIp", ip ?? "unknown")).allowed) return { status: "limited" };
  if (await isLimited("loginFailuresPerEmail", address)) return { status: "limited" };

  const user = await User.findOne({ email: address }).select("password_hash email_confirmed_at role").lean();
  const correct = await verifyPassword(password, user?.password_hash ?? null); // always one bcrypt comparison
  if (!user || !correct) {
    await consume("loginFailuresPerEmail", address);
    return { status: "invalid" };
  }
  // Told only to someone who knows the password.
  if (!user.email_confirmed_at) return { status: "unverified" };

  await resetLimit("loginFailuresPerEmail", address);
  return { status: "ok", role: user.role, userId: user._id, sessionToken: await createSession(user._id) };
}

/** Re-checks the signed-in user's own password (before deleting the account). → "ok" | "wrong" | "limited" */
export async function checkOwnPassword(userId, password) {
  await connectDb();
  if (await isLimited("passwordChecksPerUser", userId)) return "limited";
  const user = await User.findById(userId).select("password_hash").lean();
  if (await verifyPassword(password, user?.password_hash ?? null)) return "ok";
  await consume("passwordChecksPerUser", userId);
  return "wrong";
}

// ----------------------------------------------------------------------------- forgotten password
/** → "ok" (whether or not the address has an account) | "limited" */
export async function requestPasswordReset({ email, ip }) {
  await connectDb();
  const address = normalizeEmail(email);
  if (!(await consume("emailRequestsPerIp", ip ?? "unknown")).allowed) return "limited";
  const user = await User.findOne({ email: address }).select("_id").lean();
  if (!user) return "ok";
  // Quietly stop after a few per hour: the answer stays the same, so this
  // cannot be used to find out who has an account, or to flood a mailbox.
  if (!(await consume("resetPerEmailHour", address)).allowed) return "ok";
  const token = await issueToken(user._id, "reset_password", { ttlMs: minutes(RESET_MINUTES) });
  await deliver("auth.recover.mail", address, passwordResetEmail(linkFor(token, "recovery"), { minutes: RESET_MINUTES }));
  return "ok";
}

/**
 * Opens a reset link: signs the person in on this device with a short-lived
 * permission to choose a new password. Opening the link proves control of the
 * mailbox, so it also confirms the address if that had not happened yet.
 *   → { status: "ok", sessionToken } | { status: "expired" } | { status: "invalid" }
 */
export async function openPasswordReset({ token, now = new Date() }) {
  await connectDb();
  const claim = await claimToken(token, "reset_password", now);
  if (claim.status !== "ok") return { status: claim.status };
  const user = await User.findById(claim.record.user_id).select("email_confirmed_at").lean();
  if (!user) return { status: "invalid" };
  if (!user.email_confirmed_at) await User.updateOne({ _id: user._id }, { $set: { email_confirmed_at: now } });
  return { status: "ok", sessionToken: await createSession(user._id, { recovery: true, now }) };
}

/**
 * Sets a new password. Only for a session that was opened by an emailed link
 * within the last few minutes — a normal signed-in session cannot do this.
 *   → "ok" | "expired" | "same_password" | "invalid_password"
 */
export async function setNewPassword({ sessionId, password, now = new Date() }) {
  await connectDb();
  if (!passwordFitsBcrypt(password)) return "invalid_password";
  const session = await Session.findOne({ _id: sessionId, recovery_until: { $gt: now } }).lean();
  if (!session) return "expired";
  const user = await User.findById(session.user_id).select("password_hash").lean();
  if (!user) return "expired";
  if (user.password_hash && (await verifyPassword(password, user.password_hash))) return "same_password";

  // The permission is spent first, so a second submission cannot reuse it.
  const spent = await Session.updateOne({ _id: session._id, recovery_until: { $gt: now } }, { $set: { recovery_until: null } });
  if (spent.modifiedCount !== 1) return "expired";
  await User.updateOne({ _id: user._id }, { $set: { password_hash: await hashPassword(password) } });
  await AuthToken.deleteMany({ user_id: user._id, kind: "reset_password" });
  // Anyone signed in elsewhere with the old password is signed out.
  await destroyUserSessions(user._id, { exceptSessionId: session._id });
  return "ok";
}
