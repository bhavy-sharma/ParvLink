# Testing

What is tested, how to run it, the results of the last run, and — just as important — what the tests cannot tell you.

## Commands

```bash
npm run lint                  # ESLint
npm test                      # unit tests (no services needed)
npm run build                 # production build

npm run test:services:local   # service tests against a throw-away MongoDB database
npm run test:e2e:local        # browser tests: production build + MongoDB + a local SMTP mailbox
```

The last two need a MongoDB server. Either have `mongod` on your `PATH` (the scripts start a throw-away one in a temporary folder and stop it afterwards), or point them at a server you can use for scratch databases:

```bash
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:services:local
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:e2e:local
```

Every test file and every browser run creates its own uniquely named database (`cpf_test_…`, `cpf_e2e_…`) and drops it at the end; nothing else on that server is touched. **Never point `TEST_MONGODB_URI` at a production cluster.** No Docker is needed. For the browser tests run `npx playwright install chromium` once.

`npm run test:services` (without `:local`) runs the same tests against `MONGO_BASE_URI` if you prefer to set that yourself.

## Results of the last run (MongoDB migration)

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm test` | **220 passed** (10 files) |
| `npm run build` | succeeded (Next.js 16.4.0) |
| `npm run test:services:local` | **241 passed** (8 files) |
| `npm run test:e2e:local` | **156 passed** (9 spec files), Chromium — three consecutive full runs from a freshly unpacked copy of the delivered archive (`npm ci`, then each run builds the app again) |

**What these ran against — read this before trusting the numbers.**

- **MongoDB 3.6.8, not a current server and not Atlas.** The development environment could not download any MongoDB release; the only obtainable server binary was version 3.6.8 from a Linux distribution's archive. The current driver refuses servers that old, so the tests reached it through a small local proxy that adjusts the version handshake, with `retryWrites=false`. The application code under test is unchanged by this and uses nothing newer than 3.6 offers (no transactions, no change streams, no pipeline updates), but **its behaviour on MongoDB 6, 7, 8 or Atlas has not been observed.** Run the two commands above against a real server before relying on these results; that is the first thing to do after cloning.
- **Email:** the app sent real SMTP mail through Nodemailer to a local mail sink (`tests/support/mail-sink.mjs`) — plain SMTP on `127.0.0.1`, no TLS, no login. The tests read the confirmation and reset links from the delivered messages, because the database only holds hashes of the tokens. No real provider was used.
- **The app:** the real production build (`next build` + `next start`) on `127.0.0.1`. Not Vercel.

One browser test failed once before those three runs and is worth knowing about: in "an expired session: the next action sends the student to log in" the browser reached the login page with the right address, but Playwright's click call did not return and the test timed out. The application had done the right thing; the test now tells the click not to wait for the page load it triggers. It has passed in every run since, but one stall in about ten runs was seen, so treat a repeat as the same harness issue first.

Corrections made while getting to clean runs — the last three are **defects in the application found by the new tests**, not test problems:

- several first-draft assertions expected the wrong thing (a photo-less student "appearing" in discovery although a photo is required to take part; a section that is absent rather than empty; a report dialog that keeps its "sent" state until the page is reloaded) and were corrected to the actual, intended behaviour;
- the audit log's append-only protection was not active (SECURITY.md §8) — fixed, with a test for every way of changing an entry;
- a repeat registration could leave an old confirmation link able to confirm an account carrying a newer password (SECURITY.md §8) — fixed, two tests;
- an admin who is also a student saw the number of open reports about themselves in the student list — fixed, one test.

## The suites

| Suite | Runs against | Proves |
|---|---|---|
| `tests/unit` | plain Node | Validation schemas, safe `?next=` handling, the configuration readers (`MONGODB_URI`, SMTP settings and their TLS rules, `APP_URL`), token generation and hashing, bcrypt password hashing and its 72-byte guard, cookie options, the two email templates, photo re-encoding, fixed error wording, event and partner rules, chat message merging and paging, admin filters and wording, and `guards.test.js`, which reads the source of every Server Action and fails if one does not begin with an access check |
| `tests/services` | a real MongoDB, one database per file | Every service called directly with a caller context — the same functions the pages call. This is where authorization is actually proven, since MongoDB enforces none of it: who is refused, exactly which fields each answer contains, and races as concurrent calls |
| `tests/e2e` | production build + MongoDB + local SMTP sink | The flows in a real browser with several people signed in at once; real emails; that pages, Server Actions and the two data routes refuse the wrong caller, including replaying one person's captured request with other people's cookies |

### `tests/services`, file by file

| File | Covers |
|---|---|
| `00-lockdown` | The exact list of services callable from a request (a new one fails the test until it is classified); none takes the caller from its arguments; every one refuses a signed-out caller; every staff service refuses a student; every Super Admin service refuses a college admin; a session whose user is gone is nobody |
| `01-auth` | Registration stores a bcrypt hash and an unconfirmed student; a confirmation email is really sent with a link built from `APP_URL`; duplicate and simultaneous registrations; mail-server outage; valid / reused / simultaneous / malformed / wrong-purpose / expired links; resend invalidates earlier links and is rate limited; confirmation in another browser discards the registration password; re-registration cannot plant a password; the registration switch; login with valid and invalid credentials (and query objects instead of strings); unconfirmed accounts; lock-out after repeated failures; sessions (hash only, expiry, deletion, role read per request); password reset end to end; reset-email flooding; password re-check |
| `02-roles-colleges-profiles` | Granting and removing the admin role, colleges, assignments and permissions (each audited, effective on the next call); profile creation rules incl. "an unconfirmed email cannot create a profile"; own-profile-only reads and edits; private fields; photos |
| `03-events` | Who manages and sees events, validation, server-owned fields, status transitions, eligibility (age on the event day, course, year, window, invitations) |
| `04-partners` | Joining, gender asked once, discovery (compatibility, eligibility, blocks, exact fields), one-sided interest, mutual match under concurrency, refusals with one neutral answer, daily limits, closing per event, partner photos, blocking, reporting |
| `05-chat` | Only the two participants (not admins, not Super Admins); header and list fields; no edit or delete; sender is the caller; text stays text; idempotent and concurrent sends with gap-free numbering; paging; rate limit; blocks and suspensions; ended matches; reporting with and without attached messages |
| `06-moderation-analytics` | Report scope and filters; never one's own reports; detail without private data; evidence only on request and logged first; workflow with required reasons; two moderators at once; assignment and notes; student list and summaries; flag / suspend / restore and their effect on every partner service; timed suspension ending by itself; staff protection; audit-log scoping and append-only; exact analytics numbers for a known data set |
| `07-account-feedback` | Deletion erases everything personal and keeps reports and the log unlinked; no parameter to delete someone else; accounts without a profile; staff; held requests without revealing why; completion by a Super Admin; feedback validation, limits and the inbox |

### `tests/e2e`, file by file

`01-access` signed-out visitors, headers, bad links · `02-student` registration to profile, real confirmation email, cookies, photo · `03-admin` Super Admin bootstrap by script, colleges, admins, request replay · `04-events` event management and visibility · `05-partners` joining to matching, blocking, reporting, photos · `06-chat` conversations, live updates over the event stream, outage and recovery, blocks, phone layout, expired session · `07-moderation` reports, evidence, suspension, analytics, activity log, server-log check · `08-launch` legal pages, consent, password reset by real email, feedback, account deletion, server-log check · `09-seed` the seed script and logging in as each seeded account.

## The migration brief's checks, and where each is tested

| Check | Tests |
|---|---|
| MongoDB connects | every `tests/services` file and every e2e run connect, create indexes and read and write; `npm run db:indexes` was run by hand against a fresh database |
| Registration, duplicate handling, password hashing | services 01 "stores a bcrypt hash…", "registering an address that already has an account…", "two simultaneous registrations…"; unit `env.test.js` "password hashing"; e2e 02 "registering sends the user to 'confirm your email'…", "registering an address that already has an account reveals nothing and sends nothing" |
| Login with valid and invalid credentials | services 01 "valid credentials open a session…", "a wrong password, an unknown address and a query object all get the same answer", "repeated wrong passwords lock that address…"; e2e 02 "wrong password and unknown account give the same message" |
| Confirmation emails are sent | services 01 "a confirmation email is really sent, with a link built from APP_URL…"; e2e 02 (reads the delivered message); e2e 08 for the reset email |
| Valid, invalid, expired and reused tokens | services 01 "a valid link confirms the address and signs in; the same link never works twice", "the same link opened twice at the same moment is accepted once", "made-up, malformed and other-purpose tokens are refused", "an expired link is refused and says so", "asking for a new link makes the earlier one useless…"; e2e 01 "a bad or reused confirmation link…"; e2e 02 "the emailed link confirms the address…"; e2e 08 "the emailed link lets her choose a new password once…" |
| Unverified users cannot use restricted features | services 01 "an unconfirmed account is told so only when the password is right"; e2e 02 "logging in before confirming is refused…" |
| Resend with rate limiting and token invalidation | services 01 "asking for a new link makes the earlier one useless, and is rate limited", "'send again' answers the same for unknown and already-confirmed addresses…" |
| Brute-force protection | services 01 lock-out, flooding and rate-limit-record tests; limits listed in SECURITY.md §4 |
| Secure cookies and sessions | unit `env.test.js` "cookies are Secure on HTTPS deployments"; services 01 session tests; e2e 02 "session cookies cannot be read by page scripts"; e2e 06 and 08 expired-session tests |
| Authorization on protected routes and data operations | services 00 and every file after it; unit `guards.test.js`; e2e 01, 03, 05, 06, 07 |
| Secrets not exposed | unit `env.test.js` (errors never repeat a connection string or password); e2e 03 health check; e2e 07 and 08 server-log checks |
| All existing database-dependent functionality | services 02–07 and e2e 02–08, which are the earlier phases' journeys carried over |
| Seed data | e2e 09 |
| No broken imports, build succeeds | `npm run lint`, `npm run build`, and the build inside every e2e run |

## What these runs do not cover

- **A current MongoDB server or Atlas** — see above. TLS to the database, `mongodb+srv` addresses, replica-set failover and connection limits are untested.
- **A real email provider.** STARTTLS, SMTP authentication, the provider's limits, deliverability, SPF / DKIM and spam placement. `npm run mail:check` exists to test your settings; it was run here only against the local sink.
- **Vercel.** No deployment was made: the 60-second streaming route for chat, connection reuse across function instances, the forwarded-address header used for rate limits, cold starts and production headers are unverified there.
- **Real devices and browsers.** Chromium only, with phone emulation for layout. No Safari, no Firefox, no real phone, no screen reader beyond role and label checks.
- **Load.** No performance measurements were taken, and no claim about speed or capacity is made.
- **Moving data from Supabase.** DEPLOYMENT §9 documents a procedure; it was not executed and no conversion script exists.
- **Mutation testing.** For the earlier SQL versions each access rule was deliberately weakened to check that a test noticed. That has **not** been repeated for the service layer. It is worth doing: remove one `require…` or one scope filter at a time and run `npm run test:services:local`.
