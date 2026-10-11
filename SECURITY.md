# Security notes

How ParvLink protects accounts and data now that it runs on MongoDB with its own sign-in, what was tested, and — plainly — what is weaker than before, what is not verified, and what remains to be hardened.

> **No professional penetration test or external audit has been done.** The checks described here were written and run by the same process that wrote the code. Nothing has been verified on MongoDB Atlas, with a real email provider, or on Vercel.

- [1. What changed with the move from Supabase to MongoDB](#1-what-changed-with-the-move-from-supabase-to-mongodb)
- [2. Model](#2-model)
- [3. Accounts, passwords, sessions and emailed links](#3-accounts-passwords-sessions-and-emailed-links)
- [4. Rate limits](#4-rate-limits)
- [5. Input handling](#5-input-handling)
- [6. Secrets and logs](#6-secrets-and-logs)
- [7. What was tested, and how](#7-what-was-tested-and-how)
- [8. Review of this migration: found and fixed](#8-review-of-this-migration-found-and-fixed)
- [9. Known limitations and residual risks](#9-known-limitations-and-residual-risks)
- [10. Not verified](#10-not-verified)
- [11. Manual checklist on the real installation](#11-manual-checklist-on-the-real-installation)
- [12. Reporting a vulnerability](#12-reporting-a-vulnerability)

## 1. What changed with the move from Supabase to MongoDB

Read this first if you knew the earlier version.

| | Before (Supabase) | Now (MongoDB + this app) |
|---|---|---|
| Who enforces "may this person see / change this?" | The database itself: row level security, grants and self-checking SQL functions applied to every statement, including ones the app forgot to guard | **Only the application.** MongoDB has no row level security. The services in `src/lib/services` are the access control; a query written outside them would be unchecked |
| Second line of defence if the app has a bug | The database | **None.** A missing check in a service is an exposure |
| Data API reachable from the browser | Yes (protected by the rules above) | **No.** The browser can reach data only through this app's pages, Server Actions and two read-only routes |
| Passwords, sessions, emailed tokens | Supabase Auth | This app: bcrypt hashes, random session tokens and single-use link tokens, all stored as hashes (section 3) |
| Email | Supabase | Nodemailer over SMTP, with your provider's credentials held by this app |
| Database credential held by the app | A public key with no privileges of its own | **A full read-write connection string.** Whoever obtains `MONGODB_URI` can read and change everything, including private messages |
| Audit log cannot be altered | Enforced by database triggers, even against the service role | Enforced by the app's model only; anyone with the connection string can alter it |
| "Exactly one match", message numbering, one open report per pair | Transactions and locks | Unique indexes and atomic single-document updates (no transactions) |
| Chat live updates | Supabase Realtime private channels | A Server-Sent Events route in this app that sends a number, never text |
| Photos | Private storage bucket, signed links | Stored in MongoDB, served by two app routes that check the caller |

The net effect: **fewer moving parts and no public data API, but no defence in depth at the database.** The service layer and its tests carry all of it. That is a real reduction in safety margin and the reason `tests/services` exists.

## 2. Model

**Roles.** `student` (every new account), `admin` (limited to assigned colleges and to the permissions `view_students`, `manage_students`, `manage_events`, `moderate_reports` per college), `super_admin` (all colleges; made only by the operator's command-line script — nothing reachable from the website grants it, and registering first grants nothing).

**Three layers, in the order a request meets them**

1. **`src/proxy.js`** — a coarse gate. Visitors without a session cookie are redirected away from protected paths before anything renders. It only looks at whether a well-formed cookie is present; it decides nothing about identity.
2. **Guards in `src/lib/auth/session.js`** — every page and every Server Action begins with one (`requireUser`, `requireProfile`, `requireAdmin`, `requireSuperAdmin`, …). A unit test reads the source of every action file and fails if an action does not. The guard resolves the cookie to a live session and reads the user's role from the database on every request.
3. **Services in `src/lib/services`** — the only code that imports the models. `call(name, args)` builds the caller's context from the session; there is no parameter by which a request could supply a user id, a role or a college. Each service starts with a `require…` check and narrows its queries to what that caller may see. `SERVICES` is a frozen list: a helper that is not on it cannot be invoked from a request.

**Rules the services hold, whatever page or request is used**

- A student addresses other students only by a per-event random handle; user ids, emails, dates of birth, gender and photo keys never leave the server in partner or chat responses.
- "Not found" and "not yours" give the same answer (events of other colleges, other people's conversations, reports and students outside an admin's scope).
- A suspended account is refused by every partner and chat service.
- A conversation is readable and writable only by the two matched students. Admins and Super Admins get "not found". No service edits or deletes a message.
- Message text reaches a moderator only if the reporter chose to attach it to a report, and each viewing is written to the audit log before the text is returned.
- A reported person is never told about a report: not on any page, not as the reason a deletion is held.
- An admin never handles a report they filed or that is about them; nobody moderates themselves; college admins cannot act on staff; nobody suspends a Super Admin.
- A college id in a request can only narrow an admin's scope, never widen it.
- Role and college-access changes are Super Admin only and are logged with the real actor.

**Response headers** (`next.config.mjs`): a Content-Security-Policy that allows connections, images, fonts and frames from this origin only (inline scripts are still allowed — see section 9), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and HSTS when served over HTTPS.

## 3. Accounts, passwords, sessions and emailed links

**Passwords** are hashed with bcrypt, cost 12 (`src/lib/auth/passwords.js`). Minimum 10 characters with a letter and a number; passwords longer than bcrypt's 72 bytes are refused rather than silently cut. A wrong password, an unknown address and an account without a usable password all take one full bcrypt comparison and give the same answer.

**Sessions.** Logging in creates a document in `sessions` and sets the cookie `cpf_session` to a 32-byte random token. The database stores only the token's SHA-256 hash, so a copy of the database does not let anyone sign in. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` whenever `APP_URL` is `https://` (or on Vercel). Sessions last 30 days and are looked up on every request: logging out, changing the password (all other sessions), deleting the account and a role change all take effect on the next request.

**Email verification.** Registration creates an unconfirmed account and emails a link `APP_URL/auth/confirm?token=…&type=email`.

- The token is 32 random bytes, stored only as a hash, valid for 24 hours, and **single use**: it is claimed by one atomic update, so the same link opened twice — even at the same instant — is accepted once.
- Asking for a new link (or registering the same unconfirmed address again) makes every earlier link useless.
- Invalid, expired, already-used and wrong-purpose tokens are refused with a fixed message; nothing from the link is echoed back.
- An unconfirmed account cannot sign in. Someone who enters the right password is sent to "confirm your email"; a wrong password gets the usual "do not match" answer, so the form does not reveal which addresses exist.
- **Registering with someone else's address does not plant a password.** The link is tied to the browser that registered (a hash of a cookie). Opened anywhere else, it confirms the address but discards the registration password and asks the person holding the mailbox to choose one.
- The link is built from `APP_URL`, never from the request's `Host` header, so a forged header cannot make the app email a link to another site.

**Password reset.** The same mechanism with `type=recovery`: 60 minutes, single use, stored hashed, at most three emails per address per hour. Opening the link signs that device in with a 15-minute permission to choose a new password; the change spends the permission and signs out every other device. A normal signed-in session cannot change the password.

**Not revealing who has an account.** Registration, "send the link again" and "forgot password" answer identically for known and unknown addresses, and send nothing to an address that already has a confirmed account.

**Cross-site request forgery.** State changes happen only through Next.js Server Actions (POST, with the framework's same-origin check) and the cookie is `SameSite=Lax`. The two GET routes that serve data (photos, the chat stream) change nothing.

## 4. Rate limits

Fixed-window counters in MongoDB (`src/lib/auth/rate-limit.js`), shared by all server instances. The subject is stored as a hash.

| What | Limit |
|---|---|
| Failed logins per email address | 8 per 15 minutes; then even the right password is refused until the window passes. A successful login clears the count. |
| Login attempts per network address | 300 per 15 minutes |
| Registrations per network address | 100 per hour |
| Confirmation emails per address | 1 per minute, 5 per hour |
| Password-reset emails per address | 3 per hour (silently: the answer stays the same) |
| "Send again" / "forgot password" requests per network address | 60 per hour |
| Re-checks of the current password (before account deletion) | 8 wrong attempts per 15 minutes |
| Interests sent | 50 per event per day |
| Reports | 10 per person per day |
| Chat messages | 20 per sender per minute |
| Feedback | 5 per person per day |

Per-address limits are strict; per-network limits are loose on purpose, because a whole campus can sit behind one address. See section 9 for what this does not stop.

## 5. Input handling

- Every Server Action validates its input with a Zod schema on the server before calling a service; the services validate again (lengths, enumerations, id shapes) because they are the last line.
- **Query injection.** Ids are accepted only if they are UUID strings; search text is escaped before it is used in a prefix match; the Mongoose connection runs with `strictQuery: "throw"` and schemas with `strict: "throw"`, so an unknown field in a filter or a document is an error rather than "match everything" or silent storage. Tests send operator objects (`{ $ne: null }`, `{ $gt: "" }`) where strings are expected.
- **Output.** React escapes everything it renders; no user text is passed to `dangerouslySetInnerHTML`. Messages, feedback and report text are stored and shown as text. Emails contain no user-supplied text at all — only the link.
- **Photos** are decoded and re-encoded by `sharp` to a 512 px WebP, which removes EXIF data (location, device) and rejects files that are not images. They are served with `X-Content-Type-Options: nosniff` from routes that check the caller.
- **Redirects.** `?next=` is honoured only for paths on this site.

## 6. Secrets and logs

- `MONGODB_URI` and `SMTP_PASS` are read only by server modules (`src/lib/db/connection.js`, `src/lib/mail/mailer.js`). No variable that holds a secret has a `NEXT_PUBLIC_` name, and no secret is passed to a Client Component.
- `.env*` is git-ignored except `.env.example`, which holds placeholders only.
- Logs carry a scope and an error code or class name (`[service.send_interest] MongoNetworkError`, `[auth.register.mail] EAUTH`). They never contain a password, a token or link, a cookie value, an email address, message text, report text or feedback text; browser tests read the server log of a whole run and assert that. `SERVICE_DEBUG=1` prints full errors for a developer and is ignored in production.
- `/api/health` says only `ok` or `misconfigured`.
- SMTP: STARTTLS is required on ports other than 465 unless the host is this machine; the server certificate is verified.

## 7. What was tested, and how

Results of the last run and the exact environment are in [docs/TESTING.md](./docs/TESTING.md). In outline:

- **`tests/services`** — every service called directly with a caller context against a real MongoDB: who is refused, what each answer contains, and races run as concurrent calls (double join, simultaneous mutual interest, the same link opened twice, two moderators deciding one report, concurrent message sends). `00-lockdown` pins the list of services and asserts each one refuses a signed-out caller and, for admin services, a student.
- **`tests/services/01-auth`** — registration, hashing, login, sessions, verification and reset links, with mail really sent through Nodemailer over SMTP to a local sink; the tests read the link from the delivered message because the database holds only its hash.
- **`tests/e2e`** — the production build in Chromium with several people signed in at once, including replaying one person's captured Server Action request with other people's cookies.
- **`tests/unit`** — validation, configuration readers, tokens, password hashing, cookie options, email templates, and the scan that every Server Action begins with a guard.

What this cannot show is in section 10.

## 8. Review of this migration: found and fixed

Problems found while porting and testing, all fixed before delivery:

| Severity | Problem | Fix |
|---|---|---|
| High | The audit log's "append-only" hooks were attached after the model was compiled, so Mongoose ignored them: updates and deletes through the model succeeded. | Hooks are now attached before compilation, cover update, replace, delete, `findOneAnd…`, `bulkWrite` and re-saving a loaded entry, and a test exercises each. |
| High | Registering an unconfirmed address again replaced its password even when no new email could be sent (hourly limit reached), leaving the earlier link — tied to the first person's browser — able to confirm an account that now carried someone else's password. | When no email may be sent, a repeat registration changes nothing; otherwise the password changes only together with a new link that invalidates all earlier ones. Two tests. |
| Medium | The student list showed an admin who is also a student the number of open reports about themselves. | The count is withheld for the caller's own row, as the detail screen already did. |
| Medium | A helper cached a query object instead of its result; a second use in the same request raised an error (a failure, not a leak). | It caches the promise. |
| Low | A NUL character in a chat message was stored. | Stripped with the other control characters; non-text bodies are refused. |
| Low | Sessions, rate-limit counters and expired link tokens were never removed. | TTL indexes. |

## 9. Known limitations and residual risks

**From the architecture**

- **No database-level access control** (section 1). Every future change to a service is security-relevant. Keep the rule: models are imported only by `src/lib/services`, and every new service gets a refusal test.
- **The connection string is the keys to everything.** Protect it like a root password: sensitive variable in Vercel, a database user limited to `readWrite` on the one database, two-factor authentication on the Atlas account, rotate it if anyone who has seen it leaves.
- **The audit log and stored reports can be altered by anyone with direct database access.** They are tamper-resistant against the app's admins, not against the operator.
- **No multi-document transactions.** Invariants rest on unique indexes and atomic single-document updates, which the concurrency tests exercise. Two things are not atomic: account deletion (ordered so that an interruption leaves an account that can be deleted again — the sign-in record goes last) and a few "write, then log" pairs (a crash between the two would leave an action without its audit entry).
- **Messages, reports and photos are not encrypted beyond what the database host provides.** They are not end-to-end encrypted; the privacy notice says so.

**Authentication**

- No second factor, no CAPTCHA, no breached-password check, no "new sign-in" notification email, no way to change an account's email address, no list of active sessions for the user.
- Sessions last 30 days with no idle timeout.
- Per-network rate limits trust the first address in `x-forwarded-for`. Vercel sets it; behind another proxy that does not overwrite it, a client can vary it and avoid the per-network limits (the per-address limits still hold).
- The per-address login lock means someone who knows a student's address can keep that student locked out by failing eight logins every 15 minutes. The student can still reset the password by email.
- Likewise, five registrations or resend requests an hour for someone else's unconfirmed address exhaust that address's confirmation emails for the hour.
- Emailed links are bearer tokens: anyone who can read the mailbox within the validity window can use them. That is inherent to email verification.

**Application**

- College membership is self-declared: there is no college-email-domain check and no identity verification.
- The Content-Security-Policy allows inline scripts (Next.js needs them without nonces), so it limits where data can be sent but is not a complete XSS defence. React's escaping is the primary one.
- The chat stream holds one request open per open chat screen and reads the database every 1.5 seconds. There is no cap on how many streams one signed-in participant may open; that is a cost and availability risk, not a confidentiality one.
- Photos are stored in the database (about 20–60 KB each). Fine for a pilot; at scale move them to object storage.
- Analytics and some admin lists load all matching ids into memory before counting; correct, but written for hundreds to low thousands of students per college, not more.
- Not built: notifications, data export, re-consent when the terms change, automatic retention limits.

## 10. Not verified

- **MongoDB Atlas, or any current MongoDB server.** The service and browser tests ran against a MongoDB **3.6.8** server binary — the only one obtainable in the development environment — reached through a small proxy that makes the current driver accept it. The queries used are ordinary ones, but behaviour on MongoDB 6–8 and on Atlas (TLS, `mongodb+srv`, replica-set failover, connection limits) has not been observed. Run `npm run test:services` against a real server before relying on it (TESTING.md).
- **A real email provider.** Mail was sent with Nodemailer over real SMTP to a local sink without TLS or authentication. STARTTLS, provider authentication, deliverability, SPF/DKIM and spam placement are untested.
- **Vercel.** No deployment was made: the 60-second streaming route, connection reuse across function instances, the forwarded-address header, cold starts and production headers are unverified there.
- **Real browsers and devices.** Chromium only, with phone emulation. No Safari, Firefox, real phone or screen reader.
- **Load.** No performance or capacity measurements.
- **Moving existing Supabase data.** The procedure in DEPLOYMENT §9 is documented, not executed; no conversion script is shipped.

## 11. Manual checklist on the real installation

Do these once the app is deployed; LAUNCH.md has the full launch list.

- [ ] The database user in `MONGODB_URI` has `readWrite` on this database only; Atlas network access is as narrow as your hosting allows; the Atlas account has two-factor authentication.
- [ ] `MONGODB_URI` and `SMTP_PASS` are marked sensitive in Vercel and appear nowhere else.
- [ ] `APP_URL` is the real `https://` origin. After login, `cpf_session` shows as HttpOnly, Secure, SameSite=Lax.
- [ ] `curl -I https://<domain>/dashboard` answers `307` to `/login`; response headers include the CSP and HSTS.
- [ ] Register with a real mailbox: the email arrives (not in spam), the link works once, a second click shows "That link did not work".
- [ ] Open a confirmation link in a different browser from the one that registered: you are asked to choose a password.
- [ ] Nine wrong passwords for one address: the ninth answer is "Too many attempts".
- [ ] As a student, open `/admin` → back to the dashboard. As a college admin, open a student or report of another college by id → "could not find".
- [ ] As a third student, request `/matches/<someone else's conversation id>/events` → `404`.
- [ ] In the browser's network tab, the chat stream shows lines like `data: {"seq":12}` and no message text.
- [ ] `npm run test:services` passes against a scratch database on the same MongoDB service you use in production.
- [ ] No `@campus.test` seed account exists in the production database.
- [ ] Vercel's log for a day of use contains no email address, link or message text.

## 12. Reporting a vulnerability

Write to the operator's support address shown on the privacy notice (set `NEXT_PUBLIC_SUPPORT_EMAIL`). Please do not test against other people's accounts or data; describe what you found and how to reproduce it, and give the operator reasonable time to fix it before publishing.
