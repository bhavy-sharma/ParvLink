# Controlled beta launch

How to take Campus Partner Finder from "deployed" to "a limited pilot at one college", and how to operate and roll it back. The application supports many colleges; the pilot simply lists one.

> **Status of this repository: not launch-ready until the gates at the end of this file are checked on the real installation.** Local builds and tests pass. No MongoDB Atlas cluster, no real email provider and no Vercel deployment have been used; nobody has verified email delivery to real mailboxes, live chat updates on the hosting platform, backups or the behaviour on real phones. Opening registration is the owner's decision, not something the code does.

- [1. Launch checklist](#1-launch-checklist)
- [2. Controlling who can register](#2-controlling-who-can-register)
- [3. Smoke test on the production deployment](#3-smoke-test-on-the-production-deployment)
- [4. Operating the beta](#4-operating-the-beta)
- [5. Account deletion — operator procedure](#5-account-deletion--operator-procedure)
- [6. Backups and recovery](#6-backups-and-recovery)
- [7. Rollback plan](#7-rollback-plan)
- [8. Cleaning up test accounts](#8-cleaning-up-test-accounts)
- [9. Launch metrics](#9-launch-metrics)
- [10. Keeping the legal pages true](#10-keeping-the-legal-pages-true)
- [11. Release gates](#11-release-gates)

## 1. Launch checklist

Tick each line on the **production** project. "DEPLOYMENT §n" refers to [DEPLOYMENT.md](./DEPLOYMENT.md).

**Production environment verification**

- [ ] A MongoDB database dedicated to production (DEPLOYMENT §3): its own database user limited to `readWrite` on that one database; `npm run db:indexes` with the production `MONGODB_URI` lists 22 collections and reports no error.
- [ ] Vercel production build succeeded; `/api/health` returns `{"status":"ok"}`.
- [ ] Vercel has the variables of DEPLOYMENT §2, with `MONGODB_URI` and `SMTP_PASS` marked sensitive. Neither appears in the repository (`git log -p -- .env*` shows nothing but `.env.example`), in a `NEXT_PUBLIC_` variable, or in a chat message or ticket.
- [ ] `APP_URL` is exactly the production origin (`https://…`, no trailing slash, the host people really use).
- [ ] Response headers on any page include `Content-Security-Policy`, `Strict-Transport-Security` and `X-Frame-Options: DENY`.
- [ ] After logging in, the browser's cookie list shows `cpf_session` as **HttpOnly**, **Secure**, **SameSite=Lax**.
- [ ] Email (DEPLOYMENT §4): the sender domain is verified with the provider (SPF and DKIM), `npm run mail:check -- <your address>` succeeds, and a real confirmation email **and** a real password-reset email were received in an ordinary mailbox (not in spam), opened and used.
- [ ] Live chat updates work on the deployment: two students in a matched conversation see each other's messages within a few seconds without reloading, and the screen does not show "Live updates are paused".
- [ ] No seed accounts exist in production: nobody can log in as `student@campus.test` (DEPLOYMENT §5).

**Super Admin account verification**

- [ ] Exactly the intended people are Super Admins: in the database, `db.users.find({ role: "super_admin" }, { email: 1 })` (Atlas → Browse Collections → `users`, filter `{ "role": "super_admin" }`).
- [ ] Each uses a strong, unique password and an email account protected by two-factor authentication (a password reset goes through that mailbox).
- [ ] The MongoDB Atlas, email-provider and Vercel accounts themselves have two-factor authentication, and only the people who need it have access. Anyone who can read `MONGODB_URI` can read and change everything, including private messages.

**Initial college configuration**

- [ ] The pilot college exists under Admin → Colleges with the right name, city and state, and is **open**. No other college is open unless it is meant to take part.

**College Admin access assignment**

- [ ] Each college admin registered themselves, was given the admin role by a Super Admin and assigned to the pilot college.
- [ ] At least one holds **Moderate reports** and at least one holds **Manage students**; whoever creates events holds **Manage events**. Nobody has more than they need.
- [ ] Logged in as a college admin: only the pilot college appears; Colleges, Admins, Deletions and Feedback do not.

**Event creation and eligibility configuration**

- [ ] A real event is created, previewed and published. Eligibility (colleges, courses, years, minimum age, registration window) is what the organisers want; remember that course limits match free text (FEATURES → Decisions).
- [ ] A student of the pilot college sees it and can join; a test student of another college cannot open its link.

**Registration and verification flow**

- [ ] Registration control decided (section 2).
- [ ] A new person can register, receives the email within a minute, confirms on a phone, creates a profile and uploads a photo. A date of birth under 18 is refused.
- [ ] "Forgot your password?" works end to end on the production domain.

**Privacy notice and terms of use**

- [ ] `NEXT_PUBLIC_OPERATOR_NAME` and `NEXT_PUBLIC_SUPPORT_EMAIL` are set; the mailbox is read by someone.
- [ ] The three `[TO BE COMPLETED BY THE OPERATOR …]` passages in `src/app/(public)/privacy/page.js` and `terms/page.js` have been replaced with real text, and the whole of both pages has been read by someone qualified to judge them for the place you operate in (for India, the DPDP Act applies). **This repository's text is a description of the software, not legal advice.**
- [ ] Only then: `NEXT_PUBLIC_LEGAL_REVIEWED=true`, redeploy, and the "Draft" banner is gone from `/privacy` and `/terms`.

**Support contact configuration**

- [ ] The support address appears on `/privacy`, `/terms` and `/account/feedback`.
- [ ] Students have been told how to reach their college's administrators (a suspended student is told to contact them).

**Account reporting and blocking**

- [ ] With two test students: block from a partner card and from a chat; both disappear from each other; unblock from Matches.
- [ ] Report a profile and report a conversation (with "share messages"); both arrive under Admin → Reports.

**Report moderation workflow**

- [ ] A named person looks at pending reports at least daily during the pilot (nothing notifies anyone).
- [ ] That person has done one full pass on a test report: start review → note → view shared messages → resolve with a reason.

**Account suspension and restoration**

- [ ] Suspend a test student with a reason: every page shows the suspension notice (without the reason); their chat partner cannot send. Restore: everything is back.

**Chat privacy checks**

- [ ] A third student pasting a conversation URL gets "We could not find that conversation".
- [ ] A Super Admin pasting it gets the same.
- [ ] Browser developer tools → Network → WS on a chat: frames contain `{"seq": …}` and no message text.
- [ ] Vercel function logs after the smoke test contain error codes only — no message text, emails or tokens.

**Cross-college access testing**

- [ ] With a second (test) college and an admin assigned only to it: that admin sees none of the pilot college's students, reports, events or activity, by menu or by URL. Close or remove the test college afterwards (section 8).

**Mobile testing**

- [ ] On a real Android phone (Chrome) and a real iPhone (Safari): register, confirm from the mail app, onboarding, photo upload from the camera roll, join an event, discovery, chat with the on-screen keyboard open, report dialog, delete-account page. No sideways scrolling; the message box stays visible.

**Desktop testing**

- [ ] Current Chrome, Firefox and Safari: the same journey, plus the whole admin area.

**Error monitoring**

- [ ] An uptime monitor requests `/api/health` every few minutes and alerts a person.
- [ ] Someone knows where the logs are: Vercel → project → Logs (application), Atlas → cluster → Metrics / Alerts (database), your email provider's activity log (deliveries and bounces). The app writes a scope and an error code per failure, e.g. `[service.chat_send] MongoNetworkError` or `[auth.register.mail] EAUTH` — never a password, a link or a message.
- [ ] Decide whether to add an error-tracking service. None is integrated: adding one sends error data to a third party and must then be named in the privacy notice.

**Database backup and recovery planning** — section 6. **Rollback plan** — section 7. **Test-account cleanup** — section 8.

- [ ] Sections 6, 7 and 8 have been read and their checkboxes ticked.

## 2. Controlling who can register

The code never opens or closes registration by itself. You have three controls:

| Control | Where | Effect |
|---|---|---|
| **`REGISTRATION_OPEN`** | Environment variable (Vercel → Settings → Environment Variables), then redeploy | `false`: the register form answers "Registration is closed at the moment." and nothing is stored or emailed. Existing users are unaffected. Unset or anything else: open. |
| **Open colleges** | Admin → Colleges | A new account can only create a profile at an open college. With only the pilot college open, anyone else can register but gets no further than the college list. |
| **Event eligibility** | Admin → Events | Decides who can join each event. |

A sensible pilot: keep sign-ups **off**; turn them on for announced onboarding windows (an orientation session, a week before an event); turn them off again. There are no invitation codes and no college-email-domain check — college membership is self-declared (see Known limitations in SECURITY.md).

Do not create accounts for people, and do not create made-up students to make the event look busy. Empty discovery pages already explain themselves.

## 3. Smoke test on the production deployment

About 40 minutes, with three browsers (or profiles): a Super Admin, and two students of one college. Use real mailboxes you control. Remove the accounts afterwards (section 8).

**Phase 1 — accounts and admin**
1. Register a new address → confirmation email arrives → the link signs you in → onboarding. A date of birth under 18 is refused. Create the profile; upload a photo.
2. Log out, log in. Open `/admin` as the student → sent back to the dashboard.
3. As Super Admin: add a college, make a registered user an admin, assign them the college with all four permissions, revoke one, check the change appears under Activity.

**Phase 2 — events**
4. As the college admin: create an event, preview it, publish it. As a student of that college: it appears under Events and says you can take part. As a student of another college: its link says not found.
5. Close the event, re-open it.

**Phase 3 — partner finding**
6. Both students: Find Your Partner with opposite preferences. Each sees the other. One sends interest → no match. The other sends back → both see the match.
7. One student closes their profile for the event → gone from the other's discovery; the match is still listed. Re-open it.
8. Block from a card → both disappear from each other's lists. Unblock from Matches.

**Phase 4 — chat**
9. Both open the chat. A message typed in one browser appears in the other without reloading, once. Reload: still there.
10. Paste the chat URL into the Super Admin's browser → "We could not find that conversation".
11. Block from the chat → neither can send; both still read. Unblock.

**Phase 5 — moderation**
12. One student reports the other from the chat with "Share the last 20 messages" ticked.
13. As the college admin: Overview shows 1 pending report. Reports → open it. The description is there; the messages are not, until **Show shared messages** is pressed. Activity then shows "Shared messages viewed … by you".
14. Start review → add a note → Suspend the reported student for 1 day (reason required, confirmation shown).
15. In the suspended student's browser every page shows "Your account is suspended" with the end time and no reason. The other student's chat says messaging is unavailable.
16. Resolve the report with a reason. Restore the student from Students → their page works again; an event profile they had closed is still closed.
17. Analytics: the college row and the event row show the numbers you expect — 1 match for the pair, not 2.
18. As the Super Admin: Activity lists every step above with the admin's email. As the college admin: the same steps without role or college-access entries.
19. `/api/health` → `{"status":"ok"}`.

**Phase 6 — accounts, privacy, feedback**
20. `/privacy` and `/terms` open while logged out, show the operator's name and support address, and no "Draft" banner.
21. Register without ticking the box → refused. Log out; "Forgot your password?" → email arrives → the link opens "Choose a new password" → the old password no longer works, the new one does; a second browser that was logged in is logged out.
22. As a student: footer → Send feedback → submit. As Super Admin: Overview shows 1 new feedback; Feedback shows the text with a reference code, not a name → Mark as reviewed. As the college admin: `/admin/feedback` leads back to the overview.
23. As the student who was reported in step 12 (report still open, or re-open it): Delete account → "waiting for an administrator", no reason given. As Super Admin: Deletions lists it with "1 undecided report" → Delete account → confirm. The report still exists and shows "Account deleted".
24. As the other student: Delete account with password and `DELETE` → "Your account has been deleted". Logging in with that address fails. In the database the `users` document, the profile and the photo of that account are gone (Atlas → Browse Collections).
25. Submit any form after deleting the site's cookies in the browser → you land on the login page, not on an error screen.

## 4. Operating the beta

| How often | Who | What |
|---|---|---|
| Daily | Moderator | Admin → Reports → Pending. Decide or start review. |
| Daily | Super Admin | Admin → Overview → "Needs attention": deletion requests, new feedback. |
| Daily in week one, then weekly | Operator | Vercel logs for errors; Atlas alerts; the email provider's bounce list; uptime alerts. |
| Weekly | Operator | Section 9 numbers, written down with the date. |
| After each event | Event admin | Mark the event completed. |
| Before each deploy | Developer | `npm run lint && npm test && npm run test:services:local && npm run build`, and section 7's rollback note. |

Requests that arrive by email:

- **"I cannot log in / forgot my password"** → point to "Forgot your password?".
- **"Correct my college / date of birth / gender"** → these are fixed in the app. Changing them means editing the `profiles` / `profile_private` document directly in the database; record what you changed and why. Usually simpler: the student deletes the account and registers again.
- **"Delete my account" from someone who cannot log in** → verify they control the mailbox (reply to the registered address), have them reset the password and delete it themselves. There is no admin action that deletes an account nobody asked to delete from inside the app, on purpose.
- **"Send me my data"** → no export exists. Assemble it by hand from the database (their documents in `users` without the password hash, `profiles`, `profile_private`, `event_participants`, and the `messages` they sent) and say so honestly if it will take time.

## 5. Account deletion — operator procedure

What the application does by itself is described in FEATURES → Account deletion. What is left for people:

**Held requests** (`/admin/deletions` → "Waiting for your decision")

1. Open Reports and decide the reports about that student first. Suspending and then deleting is pointless; decide what the report needs.
2. If nothing more is needed from the account, press **Delete account** and confirm. If you are not going to delete it yet, leave it and tell the student why through the support address.
3. Aim to decide within a fixed time you are comfortable promising in the privacy notice (the notice currently promises no deadline).

**Nothing is left to remove by hand.** Deleting an account removes the sign-in record, the sessions, the profile and the photo together (the photo is stored in the database, not in a separate file store). If a deletion is interrupted half-way — the server log then shows `[account.delete]` or `[admin.deletion]` with an error — the account still exists and the student (or you, for a held request) can simply delete it again.

**Backups** keep deleted accounts until they expire. Say how long in the privacy notice.

## 6. Backups and recovery

Nothing in this repository makes backups. MongoDB Atlas does, depending on the tier — **check what yours includes; this has not been verified here.**

- [ ] Backups are on for the production cluster, and you know how many days are kept. (The free tier has none; do not launch a pilot with real students' data on a tier without backups.)
- [ ] Decide whether continuous (point-in-time) backup is worth its cost for the pilot.
- [ ] Before the first student registers, take a manual backup and store it somewhere access-controlled:

  ```bash
  mongodump --uri "$MONGODB_URI" --gzip --archive=cpf-$(date +%F).archive.gz
  ```

  That file contains personal data, private messages, photos and password hashes. Encrypt it; never commit it; delete old ones.
- [ ] Restore it once into a **scratch** database (`mongorestore --uri "<scratch uri>" --gzip --archive=… --nsFrom 'campus_partner_finder.*' --nsTo 'cpf_restore_test.*'`) and open the app against it, so that the first restore is not during an incident.
- [ ] Photos are in the same database (collection `photos`), so one backup covers everything.
- [ ] Write down who may restore, and that a restore brings back accounts deleted since the backup — those deletions must be repeated (`account_deletion_requests` and the audit log list them up to the backup time; keep your own note of later ones). Sessions come back too: to sign everyone out after a restore, empty the `sessions` collection.

## 7. Rollback plan

**The application (minutes).** Vercel → Deployments → the previous good deployment → *Promote to Production* (instant rollback). Environment variables are per environment, not per deployment: if you changed one, change it back and redeploy.

**The database.** There are no migrations: the app reads and writes documents in the shape described by `src/lib/db/models.js`, and a newer version normally only adds fields and indexes. So:

- Rolling the **application** back is safe as long as the newer version did not start writing documents the older code cannot read. Unknown *fields* are harmless to older code; a new *value* in a field the old code validates (a new status, say) is not. Read the model changes before deploying (DEPLOYMENT §8).
- An index the older version does not know about can stay.
- Do **not** edit collections by hand under pressure. If stored data is the problem, the quickest safe stop is to pause the pilot (below).
- A restore from backup (section 6) is the last resort: it loses everything since the backup.

**Pausing the pilot without a deployment**

1. Set `REGISTRATION_OPEN=false` in Vercel and redeploy (section 2).
2. Admin → Events → close the events (students see them as closed; discovery stops; matches and chats remain).
3. To stop the app entirely, roll Vercel back to a maintenance deployment or remove the production domain. To sign everyone out at once, empty the `sessions` collection.

**When to roll back:** students see each other's private data; anyone reaches an admin screen they should not; messages are delivered to the wrong person; sign-in is broken for everyone. Roll back first, investigate second, and tell the affected people what happened.

- [ ] The person on call knows how to do the Vercel rollback and has the access to do it.

## 8. Cleaning up test accounts

Before real students arrive, remove everything created while testing on production.

1. **Test students:** log in as each and use Delete account. (This also proves the feature on production.) If the account is held, complete it at `/admin/deletions`.
2. **Test admins:** Admin → Admins → remove the admin role, then delete the account as in 1.
3. **Anything left** (unconfirmed sign-ups, accounts without a profile): log in as each and use Delete account — it works without a profile. For addresses you cannot log in to, delete the `users` document in the database.
4. **Seed accounts** (`…@campus.test`), if `npm run seed` was ever run against this database: delete those five users the same way. Their password is public.
5. **Test events:** events cannot be deleted in the app. Mark them completed, or — only while no real data exists — delete them directly in the database (`db.events.deleteMany({ title: /^TEST / })`). Name test events so that this is unambiguous.
6. **Test colleges:** close them (Admin → Colleges). Colleges are never deleted.
7. **Test reports and feedback** remain (reports survive account deletion by design). While no real data exists you may clear them in the database (`db.reports.deleteMany({})`, `db.feedback.deleteMany({})`) — never once real students are using the system.
8. **The audit log keeps everything**, including test actions. That is intended.
9. **Photos:** deleted with their accounts; nothing to clean.

- [ ] `db.profiles.countDocuments({})` equals the number of real people you expect (usually only the staff who also have student profiles).

Never drop the database or a collection to "start clean" once anything real is in it.

## 9. Launch metrics

All of these come from numbers the Admin → Overview and Admin → Analytics pages already show (definitions on those pages and in FEATURES → Analytics). No tracking script, no cookies, no per-user activity log was added for them.

| Metric | Where to read it | Exact definition | Caveat |
|---|---|---|---|
| Registered students | Overview → Students → **Student profiles** | People who confirmed their email *and* created a profile at a college in scope | "Registered accounts" (Super Admin only) is larger: it includes people who never made a profile, and admins |
| Verified students | — | **Not applicable.** Student verification is not built; `is_verified` is never set. "Confirmed their email" (in the note under Registered accounts) is the only verification that exists | Do not report email confirmation as identity verification |
| Event participation | Analytics → by event → **Participants**; Overview → **Participations** | One per student per event (joined, whether or not their profile is still open). "Different students" is the distinct count | Participants from invited colleges count for the host college's event |
| Active discovery profiles | Overview → **Active discovery profiles**; per event in Analytics | Participations open right now: profile open, account active, event accepting participants | A snapshot; it falls to zero when the event closes |
| Interests sent | Overview / Analytics → **Interests sent** | One per sender, receiver and event | Capped at 50 per student per event per day |
| Mutual matches | Overview / Analytics → **Matches** | One per pair per event. Two matched students are **1** match | |
| Match conversion rate | Calculate from Analytics → by event: **Students matched ÷ Participants** | Share of an event's participants who ended up with at least one match | Not shown as a percentage in the app. With fewer than about 30 participants it is an anecdote, not a rate. A second useful ratio: **2 × Matches ÷ Interests sent** = share of interests that were returned |
| Reports submitted and resolved | Overview → **Reports**: Submitted, Pending, Under review, Resolved, Dismissed | Reports about students of the colleges in scope, by current status | Time-to-decision is not computed; read it off individual reports |
| Returning users | — | **Not reliably measurable, so not reported.** The app records no visits. Each sign-in session keeps a "last used" time for housekeeping, but sessions last for weeks and are deleted on logout, so counting them would mislead | Honest proxies: **Participations ÷ Different students** above 1 means students joined more than one event; a second event's participants who were also in the first can be counted by the owner in SQL |

Use the date range on the Overview ("Last 7 days", "Last 30 days") for week-over-week numbers; it counts by creation day in `NEXT_PUBLIC_APP_TIME_ZONE`.

**What the numbers do not show.** Registration alone proves that an announcement reached people — not that the product is useful. The signal that matters for this product is whether participants of an event end up matched, whether matched pairs actually talk (not measured: message counts are deliberately not collected), and whether the same students come back for the next event. Ask a handful of matched pairs whether they entered the event together; that is the outcome, and no dashboard here measures it.

## 10. Keeping the legal pages true

`/privacy` and `/terms` describe behaviour. When any of the following changes, change the page in the same commit and bump `LEGAL_VERSION`:

| Statement on the page | What makes it true |
|---|---|
| What is collected | Columns of `profiles`, `profile_private`, `event_participants`, `interests`, `matches`, `messages`, `blocks`, `reports`, `feedback`; sign-up metadata |
| Photos are stripped of location data | `src/lib/images.js` re-encodes every upload made through the app |
| Who can see what | The services in `src/lib/services` (the only code that reads the database); tested in `tests/services` |
| Moderators read chat messages only when attached to a report, and each view is recorded | `admin_view_report_evidence` in `src/lib/services/moderation.js` |
| Not end-to-end encrypted | Messages are stored as text in MongoDB |
| No advertising or analytics trackers | No third-party script is loaded; the Content-Security-Policy would block one |
| Only essential cookies, unreadable by scripts | `src/lib/auth/cookies.js` (`cpf_session`, `cpf_reg`), `src/lib/auth/pending-email.js` |
| Nothing is deleted automatically | No scheduled job touches anyone's content. The only automatic removals are technical: expired sign-in sessions, rate-limit counters and expired emailed-link tokens (TTL indexes in `src/lib/db/models.js`) |
| What deletion removes and keeps | `eraseAccount()` in `src/lib/services/account.js`; tested in `tests/services/07-account-feedback.test.js` and `tests/e2e/08-launch.spec.js` |
| MongoDB (the database host), an email provider and Vercel are the processors | Name the actual database host and email provider in the marked placeholder; add any service you introduce (error tracking, analytics) |
| Passwords are stored only as hashes | bcrypt in `src/lib/auth/passwords.js` |

## 11. Release gates

From the Phase 6 brief, re-checked after the move to MongoDB. "Local" means verified in this repository on a development machine (TESTING.md says against what); "Production" must be ticked by the owner on the real installation.

| Gate | Local | Production |
|---|---|---|
| No known critical security issue unresolved | ✅ none known | — |
| High-severity issues fixed or blocking | ✅ the four found in the Phase 6 audit are fixed (SECURITY.md) | — |
| Authentication and authorization tested | ✅ | ☐ smoke test |
| Access rules reviewed for all sensitive data | ✅ every service starts with a caller check; `tests/services/00-lockdown` pins the list | ☐ nobody but the app and the operator holds `MONGODB_URI` |
| Cross-college isolation tested | ✅ | ☐ checklist item |
| Private chat access tested | ✅ | ☐ checklist items, incl. live updates on the hosting platform |
| Account suspension restrictions tested | ✅ | ☐ checklist item |
| Core student journeys work end to end | ✅ in Chromium, real build, real SMTP to a local mailbox | ☐ on real phones and browsers, with real email |
| Database set-up documented | ✅ DEPLOYMENT §3, §8, §9 | ☐ indexes created without error |
| Production environment variables documented | ✅ DEPLOYMENT §2 | ☐ set in Vercel |
| No secrets committed | ✅ `.env.example` holds placeholders only; `.env*` ignored | ☐ check the Git history of your own remote |
| Privacy notice and terms pages available | ⚠️ pages exist and are accurate about the software, **with operator placeholders and unreviewed** | ☐ **blocks launch** until completed and reviewed |
| Build and automated tests executed | ✅ results in TESTING.md | ☐ Vercel build |
| Known limitations and unresolved risks documented | ✅ SECURITY.md | — |
| A rollback procedure exists | ✅ section 7 | ☐ rehearsed once |

**The platform is not launch-ready while any box in the Production column is empty.**
