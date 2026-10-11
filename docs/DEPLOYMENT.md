# Deployment

Local development, MongoDB and email set-up, Vercel deployment and troubleshooting.

> **Nothing in this repository has been run against MongoDB Atlas, a real email provider or Vercel.** Every step below is the documented procedure; the test suites ran locally (see [TESTING.md](./TESTING.md) for exactly what against what). Treat the first real deployment as a test and work through [LAUNCH.md](./LAUNCH.md) before inviting anyone.

- [1. Local development](#1-local-development)
- [2. Environment variables](#2-environment-variables)
- [3. MongoDB](#3-mongodb)
- [4. Email (SMTP)](#4-email-smtp)
- [5. Seed accounts for development](#5-seed-accounts-for-development)
- [6. The first Super Admin](#6-the-first-super-admin)
- [7. Vercel](#7-vercel)
- [8. Updating a running installation](#8-updating-a-running-installation)
- [9. Moving data from the earlier Supabase version](#9-moving-data-from-the-earlier-supabase-version)
- [10. Troubleshooting](#10-troubleshooting)

## 1. Local development

**You need**

| Software | Version | For |
|---|---|---|
| Node.js | 20.9 or newer (developed on 22) | everything |
| npm | the one shipped with Node | install, scripts |
| MongoDB | 5.0 or newer recommended (the driver needs at least 4.2). A local `mongod`, a Docker container, or a free Atlas cluster | running the app and the service / browser tests |
| An SMTP server | any provider, or a local mail catcher such as Mailpit (`localhost:1025`) | confirmation and password-reset emails |
| Chromium for Playwright | `npx playwright install chromium`, once | browser tests |

A standalone MongoDB is enough: the app does not use multi-document transactions, so no replica set is required.

```bash
git clone <your-repo-url> campus-partner-finder
cd campus-partner-finder
npm install
cp -n .env.example .env.local   # -n: never overwrites an existing .env.local
# fill in .env.local (section 2), then:
npm run seed                    # optional: dummy accounts, section 5
npm run dev                     # http://localhost:3000
```

In development, if `SMTP_HOST` is not set at all, the app prints the email it would have sent (including the link) to the server console instead, so registration can be tried without a mail server. This never happens with `NODE_ENV=production`.

| Command | What it does |
|---|---|
| `npm run dev` | Development server with reload |
| `npm run build` / `npm run start` | Production build / serve it |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (no services needed) |
| `npm run test:services:local` | Service tests against a throw-away MongoDB database |
| `npm run test:e2e:local` | Browser tests: real build + MongoDB + a local SMTP sink |
| `npm run seed` | Dummy accounts and sample data (development only) |
| `npm run admin:bootstrap -- <email>` | Make a confirmed account a Super Admin |
| `npm run admin:demote -- <email>` | Take the Super Admin role away |
| `npm run db:indexes` | Create / list the database indexes |
| `npm run mail:check [-- <address>]` | Check the SMTP settings; optionally send a test message |

The four operator scripts read `.env.local` (or the environment) and need the same `MONGODB_URI` / SMTP settings as the app.

## 2. Environment variables

| Name | Local | Production | Sent to the browser | Used by |
|---|---|---|---|---|
| `MONGODB_URI` | required | required | **no** | `src/lib/db/connection.js` |
| `SMTP_HOST` | required to send mail | required | **no** | `src/lib/mail/mailer.js` |
| `SMTP_PORT` | default `587` | default `587` | **no** | same |
| `SMTP_USER`, `SMTP_PASS` | as your server needs | required by every real provider | **no** | same. Give both or neither. |
| `EMAIL_FROM` | required to send mail | required; an address your provider has verified | **no** | same |
| `APP_URL` | `http://localhost:3000` | required: `https://<your-domain>`, no trailing slash | **no** | `src/lib/site-url.js` → the links in the two emails; `next.config.mjs` and cookie options (HTTPS-only behaviour when it starts with `https://`). On Vercel it falls back to the deployment's production domain if unset. |
| `REGISTRATION_OPEN` | leave unset | optional `false` | **no** | `src/lib/services/auth.js` → `false` closes new registrations (LAUNCH.md §2). Anything else: open. |
| `SMTP_SECURE` | optional | optional | **no** | `true` = TLS from the start, `false` = STARTTLS. Default: `true` for port 465, otherwise `false`. |
| `MONGODB_MAX_POOL_SIZE` | optional | optional | **no** | connections per server instance, default 10 |
| `MONGODB_SKIP_INDEX_SYNC` | leave unset | optional `1` | **no** | skip index creation on connect (after `npm run db:indexes`) |
| `SEED_PASSWORD` | optional | **never** | **no** | `scripts/seed.mjs` |
| `SERVICE_DEBUG` | optional `1` | ignored | **no** | full error details in the server log, development only |
| `NEXT_PUBLIC_OPERATOR_NAME` | optional | required before launch | yes | `src/lib/site.js` → privacy notice, terms |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | optional | required before launch | yes | privacy notice, terms, feedback page, goodbye page |
| `NEXT_PUBLIC_LEGAL_REVIEWED` | leave unset | `true` only after the legal pages have been completed and reviewed | yes | removes the "Draft" banner |
| `NEXT_PUBLIC_APP_TIME_ZONE` | optional | optional | yes | displayed dates; where a "day" begins in admin date filters. Default `Asia/Kolkata`. |

Rules:

- **`MONGODB_URI` and `SMTP_PASS` are secrets.** They are read only by server code; no file that reads them is imported by a Client Component, and none of the secret variables has a `NEXT_PUBLIC_` name. Never rename them to one.
- `.env.example` contains placeholders only. `.env*` files are git-ignored (except `.env.example`).
- Nothing logs an environment variable's value. `/api/health` reports only `ok` or `misconfigured`.
- `NEXT_PUBLIC_*` values are compiled into the build: after changing one in Vercel, **redeploy**. The server-only values are read at run time, but a redeploy is still the simplest way to make every instance pick up a change.

## 3. MongoDB

### Local

Install MongoDB Community Edition (or run `docker run -d -p 27017:27017 mongo:7`) and use:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/campus_partner_finder
```

### MongoDB Atlas (production)

1. Create a project and a cluster at <https://cloud.mongodb.com>. Choose a region close to where the app runs.
2. **Database Access** → add a database user with a long random password and the built-in role **Read and write to any database** restricted to this one database (`readWrite@campus_partner_finder`). The app needs nothing more; do not use an Atlas admin user.
3. **Network Access** → allow the addresses the app connects from. Vercel's functions do not have fixed addresses on standard plans, so the usual choice is `0.0.0.0/0` — access is then protected by the database user's password and TLS alone, which makes that password the most important secret of the installation. If your plan offers static egress addresses or private networking, use those instead.
4. **Connect → Drivers** → copy the connection string, put the password in, and add the database name before the `?`:

   ```env
   MONGODB_URI=mongodb+srv://cpf_app:<password>@<cluster>.mongodb.net/campus_partner_finder?retryWrites=true&w=majority
   ```

   If the password contains characters such as `@ : / ? #`, percent-encode them.
5. Turn on **backups** for the cluster (LAUNCH.md → Backups). The free tier has none.

### Collections and indexes

There are no migrations to apply. The app creates its 22 collections as it uses them, and on the first connection of each server instance it makes sure the indexes exist. **The unique indexes are part of the rules** (one account per email address, one interest per sender and receiver, one match per pair and event, one message per client id, one undecided report per pair), so the app builds them before it writes anything.

- To create them ahead of time, or to see them: `npm run db:indexes`.
- On a large database you may set `MONGODB_SKIP_INDEX_SYNC=1` so server instances do not check on start; then run `npm run db:indexes` yourself after every update that adds an index.
- Two collections use a TTL index so MongoDB removes old documents by itself: `sessions` (expired sign-ins) and `rate_limits` (old counters). Emailed-link tokens are removed a week after they expire.

Verify the connection without starting the app: `npm run db:indexes` prints each collection with its index count, or a plain error.

## 4. Email (SMTP)

The app sends exactly two kinds of email, through Nodemailer: **confirm your email** (after registering, and on "send the link again") and **choose a new password**. Both contain one link to `APP_URL/auth/confirm?token=…`.

1. Pick a provider that offers SMTP (Amazon SES, Postmark, Mailgun, Brevo, Resend, SendGrid, Google Workspace SMTP relay, your college's mail server …).
2. **Verify the sender** with the provider — the address or, better, the whole domain in `EMAIL_FROM` — and publish the SPF and DKIM records it gives you. Without them the emails go to spam or are refused.
3. Copy the SMTP host, port, username and password into the environment:

   ```env
   SMTP_HOST=smtp.your-provider.example
   SMTP_PORT=587
   SMTP_USER=…
   SMTP_PASS=…
   EMAIL_FROM="Campus Partner Finder <no-reply@your-domain.example>"
   ```

4. Check: `npm run mail:check -- you@example.org` connects, logs in and sends one test message. It prints what failed in plain words and never prints the password.

Security settings the app applies by itself:

| Port | Behaviour |
|---|---|
| 587 (or 25, 2525) | Connects in plain text and **must** upgrade with STARTTLS before logging in; if the server does not offer it, nothing is sent. |
| 465 | TLS from the first byte. |
| any, host `localhost` / `127.0.0.1` | No TLS required — for a mail catcher on your own machine only. |

The server's certificate is verified. Set `SMTP_SECURE` only if your provider uses TLS-from-the-start on a port other than 465.

For local development, a mail catcher is convenient: run Mailpit or MailHog and set `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`, `EMAIL_FROM=dev@localhost`, no user or password.

If the mail server is down or refuses a message, registration and "forgot password" still answer the person the same way (so the forms cannot be used to find out who has an account); the failure is written to the server log with the SMTP error code only, and the person can ask for the link again.

## 5. Seed accounts for development

```bash
npm run seed
```

creates — only where they do not exist yet — two colleges, one published event, and five confirmed accounts that share one password:

| Email | What it is |
|---|---|
| `superadmin@campus.test` | Super Admin |
| `admin@campus.test` | College admin of "Demo Institute of Technology", every permission |
| `student@campus.test` | Student with a complete profile and photo, joined the demo event |
| `student2@campus.test` | A second student in the same event, so discovery, interest, matching and chat can be tried |
| `user@campus.test` | A confirmed account that has not created a profile yet |

The password is printed at the end (`CampusDemo2026`, or `SEED_PASSWORD` if you set it). `npm run seed -- --reset-passwords` sets it again on existing seed accounts.

These are **dummy accounts with a publicly known password.** The script refuses to run with `NODE_ENV=production` unless you add `--force`, nothing in the application runs it, and it must never be run against a database real students use. To remove them later, delete the five users under `@campus.test` and their data, or simply use a different database for production.

## 6. The first Super Admin

Nobody becomes a Super Admin by registering — not even the first user — and nothing reachable from the website can grant that role. It is done from a machine that holds the database connection string:

1. Register in the app with the address that should be Super Admin, and confirm the email.
2. With `MONGODB_URI` pointing at that database (in `.env.local` or the environment):

   ```bash
   npm run admin:bootstrap -- you@your-college.edu
   ```

3. Log out and log in again. You land on `/admin`.

The script only works for an existing, email-confirmed account and writes an audit entry (actor: none, "command line"). To remove the role: `npm run admin:demote -- you@your-college.edu`.

From `/admin` you can then add colleges, make other registered users admins, and assign them to colleges with permissions.

## 7. Vercel

1. Push the repository to GitHub (check `git status` first: no `.env.local`).
2. Vercel → **Add New → Project** → import the repository. Framework preset: Next.js. Build command, output directory and Node version: defaults (Node 20 or 22).
3. **Environment variables** (Production): `MONGODB_URI`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `APP_URL`, and the `NEXT_PUBLIC_*` rows of section 2. Mark the first five as *Sensitive*. Give Preview deployments their **own** database and their own `APP_URL`, or do not give them `MONGODB_URI` at all — a preview must never share the production database.
4. Deploy. The build must finish without errors (it does not need the database).
5. Open `https://<your-domain>/api/health` → `{"status":"ok"}` (it checks that the settings are present and well-formed; it does not contact MongoDB or the mail server).
6. `npm run db:indexes` and `npm run mail:check -- you@example.org` from your machine with the production values.
7. Create the Super Admin (section 6), then work through [LAUNCH.md](./LAUNCH.md): the smoke test there is the verification of core functionality after deployment.

Notes:

- There is no `vercel.json`; nothing needs one. Security headers come from `next.config.mjs`.
- **Connections.** Each running function instance keeps a small pool (`MONGODB_MAX_POOL_SIZE`, default 10) and reuses it between requests. Atlas tiers limit the total number of connections (500 on the free tier); with many instances, lower the pool size.
- **Chat's live updates** are a streamed response (`/matches/<id>/events`) that stays open for up to 50 seconds per connection and looks at the database every 1.5 seconds; the browser reconnects by itself. Every open chat screen therefore holds one function instance busy. That is fine for a beta, but it costs function time: watch usage, and see FEATURES.md → Chat for what can be tuned. The route sets `maxDuration = 60`; your plan must allow 60-second functions.
- Profile photos are posted to a Server Action and stored in MongoDB (512 px WebP, about 20–60 KB each). Vercel caps request bodies at 4.5 MB; the app accepts photos up to 4 MB.
- Choose a Vercel function region close to the Atlas cluster's region: every page makes several database calls.
- Rate limits use the first address in `x-forwarded-for`, which Vercel sets. If you host elsewhere, make sure your proxy sets (and overwrites) that header.

## 8. Updating a running installation

1. Take a backup, or confirm the time of the latest automatic one (LAUNCH.md → Backups).
2. Read what changed in `src/lib/db/models.js`. Adding a field or an index needs nothing from you: documents without the field read as the default, and indexes are created on connect (or by `npm run db:indexes`). A change that renames or re-shapes stored data needs a one-off script — write it, test it on a copy, and run it before deploying the code that depends on it.
3. `npm run lint && npm test && npm run test:services:local && npm run build` on your machine.
4. Deploy. To undo a release, see LAUNCH.md → Rollback.

## 9. Moving data from the earlier Supabase version

Earlier versions of this project stored everything in Supabase (PostgreSQL + Supabase Auth + Storage). **That code is gone; no data is converted automatically, and nothing is deleted from your Supabase project by this version.** No production deployment of the Supabase version was ever made from this repository, so there may be nothing to move. If you did run it with real data, use this procedure — on copies first.

**Before anything else:** take a full backup of the Supabase database (`pg_dump`) and download the `avatars` bucket. Keep the Supabase project untouched (paused, not deleted) until the new installation has been verified. Put the old site in maintenance, so nothing changes during the move.

**How the data maps**

| Supabase (PostgreSQL) | MongoDB collection | Notes |
|---|---|---|
| `auth.users` (`id`, `email`, `encrypted_password`, `email_confirmed_at`, `raw_user_meta_data`) + `public.user_roles` | `users` | `_id` = the same UUID as a string. `email` lower-cased. `password_hash` = `encrypted_password` **unchanged** — Supabase Auth stores bcrypt hashes, which this app verifies as they are, so nobody needs a new password. `role` from `user_roles`. `terms_version` / `terms_accepted_at` from the metadata. |
| `public.colleges` | `colleges` | add `name_lower` = lower-cased `name` |
| `public.profiles` | `profiles` | `_id` = `id`; add `first_name_lower` |
| `public.profile_private` | `profile_private` | `_id` = `user_id`; `date_of_birth` as `"YYYY-MM-DD"` text |
| `public.account_moderation` | `account_moderation` | `_id` = `user_id` |
| `public.admin_college_access` | `admin_college_access` | `permissions` as an array of strings |
| `storage.objects` in bucket `avatars` (the files) | `photos` | `_id` = the object name (`<user id>/<uuid>.webp`, the same value as `profiles.avatar_path`), `user_id`, `data` = the file's bytes, `size`, `content_type: "image/webp"` |
| `public.events` | `events` | `eligibility_rules` JSON as an object |
| `public.event_participants`, `interests`, `matches`, `blocks` | same names | keep `public_id` values: they are in people's bookmarks |
| `public.messages` | `messages` | keep `seq` and `client_id`; then set each match's `last_seq` to its highest `seq` |
| `public.reports`, `report_notes` | same names | set `open_key`: for an undecided report `"<reporter>|<reported>|<event>"` (profile) or `"<reporter>|chat|<match>"` (chat); for a decided one, the report's own id |
| `public.audit_logs` | `audit_logs` | `seq` = the old numeric `id`; then set the counter document `{ _id: "audit_logs", value: <highest seq> }` in `counters` |
| `public.account_deletion_requests`, `feedback` | same names | `_id` = `user_id` for deletion requests |
| Supabase sessions, refresh tokens, pending confirmation / recovery tokens | — | **not moved.** Everyone logs in again; anyone mid-confirmation asks for a new link. |

Every id stays the same UUID, written as a lower-case string; every timestamp becomes a BSON date; column names are unchanged.

**Steps**

1. Export each table to JSON or CSV with `psql \copy` (or `pg_dump --data-only`), and download the photos.
2. Write a one-off script that reads those files and inserts documents **through the models in `src/lib/db/models.js`** (`import` them as `scripts/seed.mjs` does), so every document is validated against the same schemas the app uses. Insert in this order: colleges, users, profiles and private data, photos, admin access, events, participants, interests, matches, messages, blocks, reports and notes, audit log (with the driver's `insertMany`, since the model only allows appending one entry at a time with the next number), deletion requests, feedback.
3. Run it against an **empty** MongoDB database, then `npm run db:indexes`. A unique-index error at this point means duplicate data in the source: stop and look, do not delete rows to make it pass.
4. Compare counts per table and collection, and spot-check: log in as a migrated user with their existing password, open a conversation, open a report as a moderator.
5. Point the new deployment at that database and run the smoke test in LAUNCH.md.
6. Only after a period you are comfortable with, delete the Supabase project. Tell users in advance if the privacy notice changes (it now names MongoDB and your email provider instead of Supabase).

This repository does not ship that script: it cannot be tested without your data, and an untested data-conversion script is worse than none.

## 10. Troubleshooting

| Symptom | Likely cause | Remedy |
|---|---|---|
| `/api/health` returns 503 `misconfigured` | `MONGODB_URI`, `SMTP_HOST` or `EMAIL_FROM` missing or malformed; only one of `SMTP_USER` / `SMTP_PASS` given; in production, `APP_URL` missing | Fix the variables and redeploy |
| Pages show "This page did not load" / log shows `MongooseServerSelectionError` | The database cannot be reached: wrong host, Atlas network access does not include the app's addresses, cluster paused | Check section 3; `npm run db:indexes` from your machine shows the same error in plain words |
| Log shows `MongoServerError: bad auth` | Wrong database user or password, or special characters not percent-encoded | Fix `MONGODB_URI` |
| First request after a deploy is slow | Indexes are being checked on the first connection | Normal; or set `MONGODB_SKIP_INDEX_SYNC=1` after `npm run db:indexes` |
| `E11000 duplicate key` when running `npm run db:indexes` on existing data | Data that breaks a unique rule was written before the index existed | Find the duplicates and resolve them by hand; do not drop the index |
| Confirmation or reset email never arrives | SMTP settings wrong; sender not verified; provider's limit; spam folder | `npm run mail:check -- you@example.org`; the server log has a line `[auth.register.mail]` or `[auth.recover.mail]` with the SMTP error code |
| `mail:check` says `ESOCKET` / `ETIMEDOUT` | Wrong host or port, or the host blocks outgoing SMTP | Try port 587 and 465; some hosting providers block port 25 |
| `mail:check` says `EAUTH` | Wrong username or password; the provider wants an API key as the password | Check the provider's SMTP page |
| `mail:check` fails with a STARTTLS error | The server does not offer STARTTLS on that port | Use the provider's TLS port (usually 465) |
| Email link opens `localhost` or the wrong site | `APP_URL` is wrong | Set it to the public origin; redeploy |
| Link shows "That link did not work" | It was used already, a newer link was requested since, or it was copied incompletely | Send a new one from `/verify-email` or `/forgot-password` |
| Link shows "That link has expired" | Older than 24 hours (confirmation) or 60 minutes (reset) | Send a new one |
| After opening a confirmation link the person is asked to choose a password | The link was opened in a different browser from the one that registered; the password typed at registration is deliberately not trusted then | Choose a password; this is expected (SECURITY.md) |
| "Too many attempts" on login / registration | A rate limit was reached | Wait; limits are listed in SECURITY.md. Counters live in the `rate_limits` collection |
| Logged in, then immediately back at the login page | Cookies blocked; or the site is served on `https` but `APP_URL` says `http` (or the other way round); or opened on a different host than `APP_URL` | Use one canonical host and the right scheme in `APP_URL` |
| Photo upload fails | File over 4 MB; not JPEG/PNG/WebP | Try a smaller photo |
| Chat says "Live updates are paused", messages arrive after about 15 seconds | The streaming route is blocked or cut by a proxy, or function time is exhausted | Open `/matches/<id>/events` in the browser's network tab: it should stay open and receive lines every 1.5 s; check the platform's function logs |
| A student says the app shows "Your account is suspended" | An admin suspended them | Students screen → the student → history shows who and why |
| Admin sees "No colleges assigned yet" | Role granted but no college assigned | Super Admin → Admins → assign a college with permissions |
| `npm run test:services:local` / `test:e2e:local` says there is no MongoDB to test against | No `mongod` on `PATH` and `TEST_MONGODB_URI` not set | Install MongoDB, or `TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm run test:services:local` |
