# Campus Partner Finder

Students find a partner or a team-mate for college events: join an event, see who else is looking, match when the interest is mutual, and plan in a private chat. Colleges' admins run the events and moderate reports. The platform supports many colleges; the first launch targets one.

Next.js (App Router, JavaScript) · MongoDB with Mongoose · sign-in, sessions and email verification built into the app (bcrypt, Nodemailer over SMTP) · Tailwind CSS · Vercel.

## Status

**Feature-complete for a controlled beta. Not launch-ready until it has been verified on your own MongoDB, email provider and Vercel deployment.**

- The application was moved from Supabase (PostgreSQL, Supabase Auth, Storage, Realtime) to MongoDB. Supabase and PostgreSQL are gone from the code base: no package, client, migration, environment variable or call remains.
- Lint, the production build, unit tests, service tests and browser tests pass **locally**; the exact numbers and — importantly — what they ran against are in [docs/TESTING.md](./docs/TESTING.md).
- Nothing has been run against MongoDB Atlas, a real email provider or Vercel. Email delivery to real mailboxes, live chat updates on the hosting platform, backups and real phones are unverified.
- MongoDB has no row level security, so access control now lives entirely in the app's service layer. [SECURITY.md](./SECURITY.md) §1 explains what that changes.
- The privacy notice and terms describe the software accurately but contain **clearly marked placeholders** for the operator's identity and legal terms, and have not been legally reviewed.
- No professional penetration test or external audit has been done.

[docs/LAUNCH.md](./docs/LAUNCH.md) ends with the release gates and what remains to tick.

## Documentation

| Read this | For |
|---|---|
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Local development, every environment variable, MongoDB and SMTP set-up, seed accounts, the first Super Admin, Vercel, moving data from the Supabase version, troubleshooting |
| [docs/LAUNCH.md](./docs/LAUNCH.md) | Beta launch checklist, registration control, smoke test, operations, account-deletion procedure, backups, rollback, test-account cleanup, metrics, release gates |
| [docs/FEATURES.md](./docs/FEATURES.md) | How each feature behaves and why: accounts and deletion, events, partner finding, chat, moderation, analytics, design decisions |
| [docs/TESTING.md](./docs/TESTING.md) | The test suites, the last results, and what the tests cannot show |
| [SECURITY.md](./SECURITY.md) | Security model, sign-in and email-link design, rate limits, review findings, known limitations, manual checks |

## Quick start

```bash
npm install
cp -n .env.example .env.local   # set MONGODB_URI, SMTP_* , EMAIL_FROM, APP_URL
npm run seed                    # optional: dummy super admin, admin, two students, one user
npm run dev                     # http://localhost:3000
```

You need a MongoDB you can connect to (local `mongod`, Docker or Atlas) and, to receive the confirmation and reset emails, an SMTP server (a provider, or a local mail catcher). In development without SMTP settings the app prints the email it would have sent to the server console.

**Seed accounts** (`npm run seed`; password printed by the script, `CampusDemo2026` unless `SEED_PASSWORD` is set — development only, never on a database real students use):

| Email | Role |
|---|---|
| `superadmin@campus.test` | Super Admin |
| `admin@campus.test` | College admin (every permission at the demo college) |
| `student@campus.test`, `student2@campus.test` | Students with profiles and photos, both in the demo event |
| `user@campus.test` | Confirmed account without a profile yet |

For a real installation nobody gets the Super Admin role by registering; the operator grants it from the command line:

```bash
npm run admin:bootstrap -- you@your-college.edu
```

```bash
npm run lint && npm test && npm run build
npm run test:services:local && npm run test:e2e:local   # need a MongoDB (mongod on PATH, or TEST_MONGODB_URI); no Docker
```

## What is built

| Area | What works |
|---|---|
| Accounts | Register with required agreement to the terms, **email confirmation by emailed link**, log in, log out, **password reset by email**, **delete your own account** — all handled by this app (bcrypt password hashes, server-side sessions, single-use hashed tokens, Nodemailer) |
| Student | Profile (first name, college, course, year, 18+ date-of-birth check, bio), photo upload with metadata removed, dashboard |
| Events — student | Event list with search and filters; event page with eligibility and a plain explanation of whether the student can take part |
| Find your partner | Join an event with a partner preference, browse compatible students, send and receive interest, mutual matches, close / re-open a profile per event, block, report |
| Chat | A private conversation per match with history paging and live updates; block and report from the chat; read-only after a block |
| Events — admin | Create, edit, preview, publish / close / re-open / complete, with eligibility rules |
| Moderation | Report list and detail, notes, assignment, a status workflow with required reasons; shared chat messages only on request, each view logged; flag, suspend (optionally until a date) and restore accounts |
| Analytics | Server-computed numbers per platform, college and event, with definitions on the page |
| Activity log | Every administrative action, append-only; scoped per admin |
| Super Admin | Colleges, admins and their permissions, held account deletions, the beta feedback inbox |
| Privacy | Public privacy notice and terms; a documented deletion and retention policy; feedback form |
| Database | 22 MongoDB collections behind one service layer that checks the caller on every call; unique indexes for the rules that must hold under concurrency; photos stored privately and served only through checked routes |

Roles: **student** (every new account), **admin** (limited to assigned colleges and permissions), **super_admin** (all colleges; created only by the operator's command-line script).

Not built: notifications of any kind, unread counts, read receipts, attachments, message editing or deletion, student identity verification, data export, re-consent when the terms change, CAPTCHA, payments, subscriptions, sponsor billing, mobile apps.

## Stack and versions

| Package | Version | Why |
|---|---|---|
| Next.js (App Router, JavaScript) | 16.4.0 | Framework. Uses Cache Components + `proxy.js` (the Next 16 name for middleware). |
| React | 19.3.0 | |
| Tailwind CSS | 4.x | Styling; design tokens live in `src/app/globals.css`. |
| `mongoose` | 8.24.x | MongoDB models, validation and queries (`src/lib/db`). |
| `bcryptjs` | 3.x | Password hashing (pure JavaScript, no native build). |
| `nodemailer` | 10.x | Confirmation and password-reset emails over SMTP. |
| Zod | 4.6.x | Server-side validation. |
| sharp | 0.35.x | Re-encodes profile photos on the server. |
| Vitest 5, Playwright 1.56, `smtp-server`, `mailparser` | dev | Unit, service and end-to-end tests (the last two packages are the local mailbox the tests read emails from). |
| ESLint 10 + `eslint-config-next` | dev | Linting. |


## Project structure

```
src/
  proxy.js                      redirect visitors without a session cookie away from protected pages (runs before rendering)
  app/
    page.js                     public landing page
    (public)/                   privacy notice, terms of use, "account deleted" page
    (auth)/                     login, register, verify-email, forgot-password, reset-password + their Server Actions
    account/                    delete account, send feedback (any signed-in person) + their Server Actions
    auth/confirm/route.js       lands the emailed links: confirm address / reset password
    auth/error/                 fixed messages for failed links
    auth/signed-out/route.js    clears a dead session cookie and sends the visitor to log in
    auth/session/route.js       "am I still signed in?" for the long-lived chat screen (204 / 401)
    (student)/                  onboarding, dashboard, profile, events, matches + their Server Actions
      partner-actions.js        join, open/close, send interest, block, report, unblock
      chat-actions.js           send, load messages, block and report from a chat
      profile/photo/route.js    the signed-in student's own photo
      matches/[conversation]/   the chat screen; events/route.js is its live-update stream (Server-Sent Events)
      events/[slug]/partners    discovery, interests received, matches; photo/[handle] serves partner photos
    admin/                      overview, reports, students, analytics, activity, colleges, admins, events, deletions, feedback
    api/health/route.js         liveness check
  components/                   ui/, events/, admin/, chat/, partners/, forms/, legal/, layout/
  lib/
    db/connection.js            the one MongoDB connection (cached), index creation
    db/models.js                every Mongoose model — imported ONLY by lib/services and the scripts
    services/                   ← all data access and all access rules: auth, profiles, admins, events, partners,
                                  chat, moderation, analytics, account; index.js is the frozen list callable from requests
    auth/session.js             cookie → session → user; the guards every page and action starts with (server-only)
    auth/                       passwords.js (bcrypt), tokens.js, cookies.js, rate-limit.js, routes.js, errors.js
    mail/                       mailer.js (Nodemailer transporter), messages.js (the two emails)
    site-url.js                 APP_URL → the origin used in emailed links
    data/                       thin read helpers used by pages (each calls one service)
    chat/                       messages.js (merge / dedupe / paging), live.js (stream client)
    validation/                 Zod schemas and shared limits
    images.js                   photo re-encoding
scripts/
  seed.mjs                      dummy accounts and sample data (development)
  super-admin.mjs               make / remove a Super Admin
  create-indexes.mjs            create and list indexes
  check-mail.mjs                check the SMTP settings
  test-services-local.sh        service tests against a throw-away database
  test-e2e-local.sh             browser tests: build + MongoDB + local SMTP sink
tests/
  unit/                         validation, redirects, configuration readers, tokens, password hashing, photo processing, guards
  services/                     every service against a real MongoDB: authorization, rules, races, emailed links
  e2e/                          browser tests against the production build
  support/                      the local SMTP sink the tests read mail from
docs/                           FEATURES, DEPLOYMENT, LAUNCH, TESTING
```

## Working on the code

- Read `AGENTS.md` first: this Next.js version differs from older ones (`proxy.js` instead of middleware, Cache Components).
- Every page and every Server Action starts with a guard from `src/lib/auth/session.js`. A unit test fails if an action does not.
- **The service layer is the access control** — MongoDB enforces none. Data access goes in a service in `src/lib/services` that begins with a `require…` check and takes the caller from its context, never from a parameter. Register it in `index.js`, add it to `tests/services/00-lockdown.test.js`, and test who is refused. Never import a model into a page, an action or a component.
- A rule that must hold when two requests arrive together needs a unique index or a single atomic update — there are no transactions.
- Secrets (`MONGODB_URI`, `SMTP_PASS`) stay server-only: never a `NEXT_PUBLIC_` name, never logged, never passed to a Client Component.
- If you change what is collected, who can see it or what deletion removes, change `/privacy` in the same commit (LAUNCH.md §10).
