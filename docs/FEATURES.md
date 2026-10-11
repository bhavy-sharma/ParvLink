# Features, rules and design decisions

How each part of Campus Partner Finder behaves and where its code lives. Set-up is in [DEPLOYMENT.md](./DEPLOYMENT.md), going live in [LAUNCH.md](./LAUNCH.md), the test suites in [TESTING.md](./TESTING.md) and the security model in [SECURITY.md](../SECURITY.md).

- [Accounts, privacy and feedback (Phase 6)](#accounts-privacy-and-feedback-phase-6)
- [Events (Phase 2)](#events-phase-2)
- [Find your partner (Phase 3)](#find-your-partner-phase-3)
- [Chat (Phase 4)](#chat-phase-4)
- [Moderation and analytics (Phase 5)](#moderation-and-analytics-phase-5)
- [How authorization works](#how-authorization-works)
- [Decisions worth knowing about](#decisions-worth-knowing-about)

## Accounts, privacy and feedback (Phase 6)

### Where things are

| Path | Who | What |
|---|---|---|
| `/` | anyone | Landing page. Describes only what exists; no sample content. |
| `/privacy`, `/terms` | anyone | Privacy notice and terms of use (`src/app/(public)/`). |
| `/register` | visitors | Requires ticking "I have read and agree…". The version and time are stored in the account's metadata. |
| `/forgot-password` | visitors | Emails a reset link. Same answer for every address. |
| `/reset-password` | signed in, right after opening a reset link (or a confirmation link in a different browser) | Choose a new password. |
| `/account/delete` | any signed-in person | Delete your own account, or see and cancel a held request. |
| `/account/feedback` | any signed-in person | Beta feedback form. |
| `/admin/deletions` | Super Admin | Held deletion requests; erased accounts whose sign-in record still has to be removed. |
| `/admin/feedback` | Super Admin | Feedback inbox with filters, paging and "mark as reviewed". |
| `/goodbye` | anyone | Shown after a deletion has actually been carried out. |

### Password reset

1. `/forgot-password` asks the server for a reset email (sent through SMTP with Nodemailer). The page says the same thing whether or not the address has an account; at most three are sent per address per hour.
2. The link in the email lands on `/auth/confirm?token=…&type=recovery`. The token is random, works once, expires after 60 minutes and is stored only as a hash. Opening it signs the person in on that device with a session that, for 15 minutes, carries the permission to choose a new password.
3. `/reset-password` shows the form only while that permission exists, and the service checks it again. **A signed-in session alone cannot change the password** — there is deliberately no "change password" form for an unattended laptop to be abused through.
4. The change spends the permission and signs out every *other* session of that account. The new password is stored as a bcrypt hash.

There is no separate "change password while logged in" screen: log out and use "Forgot your password?".

### Account deletion — the policy

A student deletes their own account at `/account/delete` by entering their current password and typing `DELETE`. Nothing in the request says *whose* account: it is always the caller's (`delete_my_account()` takes no argument).

**Erased immediately**

- profile, date of birth, gender, photo file;
- event participations, interests sent and received, matches, blocks, moderation state;
- every conversation the student was part of — **for both people** (messages belong to the match, and the match goes);
- role row and college assignments (students have none);
- the sign-in record itself (the `users` document), every session and every unused emailed link.

**Kept**

| What | Why | In what form |
|---|---|---|
| Reports the student filed, or that were filed about them, including messages a reporter attached | Safety evidence must not disappear because one side deleted their account | The report row stays; its link to the deleted account becomes empty ("Account deleted" on the admin screens) |
| Audit log entries | The log is append-only for every role | They mention the student only as a short reference (`U-XXXXXXXX`) |
| Feedback they sent | Product feedback | No longer linked to an account |
| One document in `account_deletion_requests` | A record that the deletion was asked for and carried out | User id, short reference, college, timestamps — no name, no email |
| Database backups | Outside the application | Until the hosting provider's backups expire |

**Held instead of carried out** when, at the moment of asking, the account is suspended or has reports about it that are not yet decided. The request then waits at `/admin/deletions` for a Super Admin. The student sees "waiting for an administrator" — **not the reason**, because a reported person is never told that they were reported — and can cancel. The account keeps working as before while held. A Super Admin can complete a held request (with a second, explicit confirmation); they cannot delete an account nobody asked to have deleted, and there is no "reject" action: an unwanted request is cancelled by the student.

**Staff** (admin or Super Admin role) cannot self-delete. A Super Admin removes the role first, on the record.

**The sign-in record** is deleted last, after everything else, so an interrupted deletion leaves an account that can simply be deleted again. The email address can afterwards be registered again; it starts as a new, empty account.

**Sessions.** Sessions are documents in the database, looked up on every request. Deleting the account deletes them, so a cookie left on another device stops working at once.

### Feedback

Category, a description (10–1000 characters) and optional steps (≤1000). At most five per person per day. Stored in `feedback`, a table no API role can read or write; `submit_feedback()` writes it and three Super-Admin-only functions read it. The inbox shows the sender as a reference code and the college, never a name or email. There is no reply, assignment or threading — it is an inbox, not a ticketing system.

### Consent

The sign-up form requires the box; the Server Action re-checks it. `terms_version` and `terms_accepted_at` are stored on the account. They are the person's own statement and are never read for any permission. Changing `LEGAL_VERSION` in `src/lib/validation/limits.js` changes the version shown on the pages and recorded for new accounts; nobody is asked to agree again (re-consent is not built).

### Operator details

`NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_SUPPORT_EMAIL` and `NEXT_PUBLIC_LEGAL_REVIEWED=true` fill in the legal pages. Until all three are set the pages show a "Draft" banner and marked placeholders. Three passages in the text are placeholders that only an edit to the page can replace (postal address and applicable law; hosting region and backup retention; liability and governing law).

## Events (Phase 2)

### Where things are

| Who | Path | What |
|---|---|---|
| Admin | `/admin/events` | Events the admin may manage: search by title; filter by status, host college, type |
| Admin | `/admin/events/new` | Create (always saved as a draft) |
| Admin | `/admin/events/[id]` | Manage: summary, status changes with confirmation, student link |
| Admin | `/admin/events/[id]/edit` | Edit (locked once completed) |
| Admin | `/admin/events/[id]/preview` | The event exactly as students see it |
| Student | `/events` | Events their college is invited to: search; filter by open/upcoming/past, type, host |
| Student | `/events/[slug]` | Details, eligibility, and "Can you take part?" |

### Rules (all enforced on the server, in `src/lib/services`)

- **Who manages:** Super Admins, for any open college; admins, only for colleges where their assignment includes **Manage events**. Students never.
- **Status:** `draft → published → closed ⇄ published → completed`. Completed events are frozen. An event cannot be published if it has already ended or lacks a description or venue.
- **Fixed after creation:** host college and URL slug. Status, creator, slug and publish time are set by the database and cannot be sent by a client.
- **Who sees an event:** students whose college is invited — the host college always, plus either selected colleges or all open colleges. Drafts are visible to managers only. A student from an uninvited college gets "not found", the same as for an event that does not exist.
- **Who can take part:** an invited college, old enough on the day the event starts, course and year within any limits set, an active profile **with a photo**, and the event open (published, inside any participation window, not ended). Course, year and age never hide an event; the student is told which requirement they miss.
- **Eligibility format** (`events.eligibility_rules`, JSONB, validated and normalised on every write):

  ```json
  {
    "colleges": { "mode": "selected", "ids": ["<college uuid>", "…"] },
    "courses": ["B.Tech", "MBA"],
    "study_years": [1, 2]
  }
  ```

  `colleges.mode` is `"all"` or `"selected"`; empty `courses` / `study_years` mean no limit.
- **Times** are typed and shown in `NEXT_PUBLIC_APP_TIME_ZONE` (default `Asia/Kolkata`) and stored in UTC.

### What Phase 2 deliberately does not do

Phase 2 itself did not let a student join an event or find a partner; it answered "may this student take part?" (`event_participation_check`). Joining arrived in Phase 3 and uses the same rule.

### Try it locally

```bash
npm run seed     # five dummy accounts, two colleges, one event (DEPLOYMENT.md §5)
npm run dev      # http://localhost:3000
```

Log in as `superadmin@campus.test` → `/admin/colleges`, `/admin/events` (create an event, preview it, publish it). Log in as `student@campus.test` in another browser and open `/events`.

To start from nothing instead: register, open the link from the confirmation email (in development without SMTP it is printed to the server console), then `npm run admin:bootstrap -- you@example.com` and log in again.

## Find your partner (Phase 3)

### Where things are

| Path | What |
|---|---|
| `/events/[slug]` | "Find Your Partner" when the student may take part; otherwise the reasons |
| `/events/[slug]/join` | Choose "looking for a male / female partner" (and gender, the first time only), review, confirm |
| `/events/[slug]/partners` | Profile open/closed for this event, matches for this event, interests received, students to discover (12 per page) |
| `/matches` | All matches with their event (since Phase 4: with their chat), and the people the student has blocked |

### Rules (all enforced on the server, in `src/lib/services`)

- **Joining** needs everything Phase 2 already checks (invited college, age on the day, course and year limits, active profile with a photo, event open) plus a partner preference. One record per student per event; joining again updates it.
- **Discovery** shows a student only people who: joined the same event with an open profile, are still eligible, want the viewer's gender while being the gender the viewer wants, are not blocked in either direction, and are not the viewer. It stops when the event closes or ends.
- **Interest** can be sent only to someone currently discoverable. Repeats are ignored. A closed profile cannot send or receive.
- **A match** is created the moment interest exists in both directions, in the same transaction as the second interest, once per pair per event. Simultaneous requests are serialised per pair.
- **Closing a profile** affects that event only and keeps interests and matches. Re-opening needs the event to be open and the student still eligible.
- **Participation states:** not joined (no record) · active · closed · ended (derived: the event closed/ended or the student lost eligibility).
- **Blocking** hides two students from each other in every event and stops new interest and matches between them; history is kept; the blocked person is not told; only the blocker can undo it.
- **Reports** record reporter, reported student, their college, the event, a reason and an optional description. Students cannot read reports. Admins holding **Moderate reports** for the reported student's college (and Super Admins) handle them on the moderation screens (Phase 5).

### How it is built

There is no data API: the browser can reach partner data only through pages and Server Actions, and those only through twelve services in `src/lib/services/partners.js` (`join_event`, `set_event_profile_open`, `my_event_participation`, `discover_event_partners`, `send_interest`, `list_received_interests`, `my_partner_summary`, `partner_photo`, `block_partner`, `list_my_blocks`, `unblock_partner`, `report_partner`). None takes a user id: the caller comes from the session, other people from an event-specific handle. Each returns only first name, course, year and whether a photo exists. The Server Actions in `src/app/(student)/partner-actions.js` validate input and call one service each. "Exactly one match" does not rely on a transaction: unique indexes on interests and matches make every step repeatable, and each sender stores their own interest before looking for the other's.

### Try it locally

After `npm run seed`, log in as `student@campus.test` and `student2@campus.test` in two browsers and open the demo event in both. Send interest one way (no match), then back (match on both sides). Close one profile and watch it leave the other's list.


## Chat (Phase 4)

Two students who matched for an event get one private conversation for that match.

### Where things are

| Path | What |
|---|---|
| `/matches` | Every match with its event, the latest message and its time, and a link to the chat. Most recent conversation first. |
| `/matches/[conversation]` | The chat: the other student's photo and first name, the event, message history (30 at a time, "Load earlier messages"), the message box, **Block** and **Report user** |
| `/events/[slug]/partners` | "Your matches for this event" now links to each chat |

`[conversation]` is a random id that belongs to the match. It is not the match's primary key and contains no user id.

### Rules (all enforced on the server, in `src/lib/services`)

- **A conversation is a match.** There is no separate conversations table, so a conversation cannot exist without a mutual match, and its two participants are always the two students of that match. Nothing lets a client name the participants.
- **Only the two participants can read or write.** Everyone else — another student, an admin, a Super Admin, a signed-out visitor, someone who edits the URL — gets the same "not found".
- **The sender is always the signed-in caller.** `chat_send` has no sender parameter.
- **A message** is 1 to 2000 characters after trimming. Whitespace-only and invisible-only text is refused. Line breaks are kept; control characters are removed. Text is stored and shown as plain text — never interpreted as HTML, never turned into links.
- **Rate limit:** 20 messages per student per minute, across all their conversations (`message_rate_limited`).
- **No duplicates:** the browser gives each message it composes a random id; sending it again (double tap, retry after a lost reply) returns the stored message instead of adding one.
- **Order:** every message gets a sequence number within its conversation, taken atomically from a counter on the match. Display order and paging use that number, not clock time.
- **No editing and no deleting**, for anyone, by any route. Messages go only when the match itself is removed (see "Retention").
- **Still works after the event:** closing a discovery profile, or the event closing or completing, changes nothing about an existing conversation.

### Blocking — the policy

When either student blocks the other (from the chat or, as in Phase 3, from a partner card):

| | |
|---|---|
| Sending | Refused **for both** students, in every conversation the two share. One neutral answer: "Messaging is unavailable in this conversation." |
| Earlier messages | **Still readable by both.** Nothing is deleted: not the match, not the messages, not the block. |
| What the blocked student is told | Nothing about a block. The message box is replaced by the neutral notice the next time they send or load the page. The blocker's own screen also says "You blocked ⟨name⟩". |
| Photo | Hidden from each other (the Phase 3 rule for blocked pairs) |
| Discovery, interest, new matches | Stopped, as in Phase 3 |
| Undo | Only the blocker, from **Matches → People you have blocked**. Messaging then works again. |
| Reporting | Still possible from the conversation after a block |

The same rule is applied in one place — `private.chat_sendable()` — which `chat_send`, `chat_open` and `list_my_conversations` all use, so the screen and the database cannot disagree. A send and a block arriving at the same instant are serialised per pair: either the message was stored before the block, or it is refused.

Suspension follows the same pattern: a suspended student cannot open their conversations at all; the other student keeps the history, read-only.

### Reporting from a chat

**Report user** offers: Harassment or abusive messages · Threats or intimidation · Spam or scam · Fake or misleading profile · Inappropriate content · Other, plus an optional description (1000 characters).

- The report records the reporter (always the caller), the other student, their college, the event and the match.
- **Moderators cannot open conversations.** A report carries message text only if the reporter ticks "Share the last 20 messages": those are copied into the report at that moment. Without the tick, moderators see the reason and description only.
- Students — reporter, reported or anyone else — cannot read reports. Admins holding **Moderate reports** for the reported student's college, and Super Admins, read them on the moderation screens (Phase 5).
- One open report per conversation per reporter. A profile report from Phase 3 does not prevent a chat report about the same person.

### Live updates

Live updates are a **Server-Sent Events stream served by this app** — `GET /matches/<conversation id>/events` — with no third-party service:

1. The chat screen opens the stream with the browser's `EventSource`. It is an ordinary same-site request, so it carries the httpOnly session cookie; no token is handed to page scripts.
2. The route checks that the caller is one of the two students of the conversation when the stream opens **and again on every tick**, so a suspension, a deleted account or losing access ends it. Anyone else gets `404`.
3. Every 1.5 seconds the route reads the number of the conversation's latest message and, when it has grown, sends `{"seq": n}`. **No message text is ever sent over the stream.** On a ping the screen fetches the new messages through the same authorised Server Action it uses for history, so a message can never appear twice or out of order.
4. Each stream ends after 50 seconds and the browser reconnects by itself (serverless functions cannot stay open for ever).

Because the ping carries nothing but a number, the worst a fault in the stream could reveal is *that* a message was sent, not what it said.

**If the stream is unavailable** the chat keeps working: sending does not depend on it; after five seconds without a connection the screen shows "Live updates are paused", offers **Reload messages**, checks for new messages every 15 seconds, and catches up by itself on reconnect.

**While it is connected** the screen relies on pings. As a safety net it also asks "anything new?" once a minute while the tab is visible (`LIVE_SAFETY_CHECK_MS` in `chat-screen.js`; `0` switches it off).

**Cost.** A new message reaches the other person within about two seconds. Each open chat screen holds one request open and causes one small database read every 1.5 seconds. For a beta that is fine; at larger scale raise `TICK_MS` in the route, or replace the polling with MongoDB change streams (which need a replica set — Atlas has one — and a long-lived server rather than serverless functions).

### Privacy — what is and is not true

- Messages are stored as ordinary text in the MongoDB database so both students can read them later. They are **not end-to-end encrypted**. Anyone with direct access to the database (the connection string, the Atlas console, backups) can read them.
- The application gives admins and Super Admins **no** way to read conversations. Moderators see only what a reporter chose to attach to a report.
- Message text is not written to server logs (errors log a code only), is not put in URLs, and is not kept in browser storage.
- The chat screen says this to students in plain words, next to a safety reminder not to share passwords, OTPs, payment details or a home address.

### Retention

- Messages are kept for as long as the match exists. There is no automatic expiry.
- Deleting an account (by the student since Phase 6, see above) deletes that student's matches and, with them, **both sides** of those conversations — the deletion service removes them explicitly; a conversation belongs to a match.
- Message copies attached to a report stay with the report, which outlives the accounts involved (the links to them become empty).

### How it is built

Seven services are the whole interface (`src/lib/services/chat.js`): `list_my_conversations`, `chat_open`, `chat_messages`, `chat_latest_seq`, `chat_send`, `block_chat_partner`, `report_chat_partner`. No service edits or deletes a message. The Server Actions in `src/app/(student)/chat-actions.js` validate input and call one service each. The chat screen is `src/components/chat/chat-screen.js`; the merge logic it relies on is in `src/lib/chat/messages.js` and unit-tested; the stream client is `src/lib/chat/live.js`.

Not part of this phase, and not faked in the interface: read receipts, typing indicators, online status, unread counts, attachments, message editing or deletion, notifications, calls, phone-number exchange.

### Try it locally

After `npm run seed`, log in as the two seed students in two browsers, match them on the demo event, then open **Matches → Say hello** in both. Messages typed in one window appear in the other without reloading.

## Moderation and analytics (Phase 5)

### Where things are

| Path | Who | What |
|---|---|---|
| `/admin` | every admin | Overview: what needs attention, students, events, partner finding, reports, recent activity. Optional college and date filters. |
| `/admin/reports` | Moderate reports | Report list: filter by status, category, assignment, college, event, date; search by reference or reported student; 20 per page |
| `/admin/reports/[id]` | Moderate reports | One report: what was submitted, context, shared messages (on request), internal notes, history, status actions, and — with Manage students — account actions |
| `/admin/students` | View or Manage students | Student list: search by first name or reference; filter by standing and college |
| `/admin/students/[id]` | View or Manage students | Summary: participation counts, events joined, moderation history; flag / suspend / restore with Manage students |
| `/admin/analytics` | any assignment | Numbers by college and by event |
| `/admin/activity` | Manage events, Moderate reports or Manage students | The audit log, filtered by kind, college and date |
| `/api/health` | public | `{"status":"ok"}` — liveness only |

A link that does not apply to an admin is hidden, the page redirects, and — the part that matters — the service behind it refuses.

### Who can do what

The permission model is the one from Phase 1 (one assignment per admin per college, any of four permissions; an admin can hold several colleges). Phase 5 is the first time three of the four are used.

| | Super Admin | **Moderate reports** @ college | **Manage students** @ college | **View students** @ college | **Manage events** @ college |
|---|---|---|---|---|---|
| Reports about that college's students: list, open, notes, assign to self, change status | all colleges | yes | — | — | — |
| See chat messages a reporter attached (logged) | yes | yes | — | — | — |
| Student list and summary | all | — | yes | yes | — |
| Flag for review, suspend, restore a **student** | all | — | yes | — | — |
| Act on an account that also holds an admin role | yes | — | — | — | — |
| Suspend a Super Admin, or yourself | no | no | no | no | no |
| Event, participation, interest and match numbers for the college | all | yes | yes | yes | yes |
| Student numbers | all | — | yes | yes | — |
| Report numbers | all | yes | — | — | — |
| Activity log entries of the college | everything | reports, account moderation | account moderation | — | events |
| Colleges, admin roles, college assignments | yes | — | — | — | — |
| Read any conversation | **no** | no | no | no | no |

Nobody — Super Admin included — can open, list or act on a report they filed themselves or one that is about them; someone else has to handle it.

### Reports

- **Statuses** are the ones stored since Phase 1; only the names on screen are new: `open` → **Pending**, `in_review` → **Under review**, `resolved` → **Resolved**, `dismissed` → **Dismissed**.
- **Workflow:** pending → under review / resolved / dismissed; under review → resolved / dismissed / back to pending; resolved or dismissed → re-opened to under review. Resolving, dismissing and re-opening need a written reason (10–1000 characters). Taking a report into review assigns it to you if nobody has it.
- **Assignment** is "assign to me" / "unassign me" (a Super Admin can unassign anyone). Assigning to *another* moderator is not built.
- **Internal notes** are for moderators only and can be added but not edited or removed.
- **What the student submitted is never changed by the app**: no service writes to a report's reporter, reported student, reason, description or attached messages — only status, assignment and decision fields. (Someone with direct database access can; see SECURITY.md.) Reports are never deleted by the app.
- **A report belongs to the college of the reported student**, as recorded when it was filed. A report about a student of college B filed by a student of college A is handled by college B's moderators.
- **References:** reports show as `R-1A2B3C4D`, students as `U-1A2B3C4D` — the first eight characters of their ids. Admins never see a student's email, date of birth, gender, partner preference or messages.

### Chat privacy

- No admin screen or service reads the `messages` collection. There is no "view conversation" anywhere.
- When a student reports from a chat they may tick "Share the last 20 messages". Those messages are copied into the report. A moderator sees that messages exist, and must press **Show shared messages** to read them; **each viewing is written to the activity log** (who, which report, how many messages — not the text).
- If the reporter shared nothing, moderators decide on the description alone.
- Analytics contain no message counts and no message text.

### Suspension

Suspending needs a reason (10–500 characters, kept in the activity log) and an explicit confirmation step that shows the account, the action and the reason. It can be open-ended or for 1, 3, 7, 14 or 30 days.

While suspended, a student **cannot**:

- join an event or re-open an event profile;
- appear in discovery, send or receive interest, or be matched;
- **read or send messages** — the policy chosen in Phase 4 is kept: a suspended student has no access to their conversations; the students they matched with keep the history, read-only;
- list matches, load other students' photos, block, report, edit their profile or upload a photo.

All of that is refused **in the service layer** (`requireUser()` is the first line of every partner and chat service, and it refuses suspended accounts), so it holds for any page or Server Action, however the request was produced. In the app, a suspended student sees one notice — that the account is suspended, until when if a date was set, and how to ask for the account to be deleted — instead of the app. The reason and who decided are not shown.

**Restoring** changes the account's status and nothing else. Matches, conversations and event profiles come back exactly as they were, so an event profile the student had closed themselves stays closed.

A suspension with an end date is lifted the next time the student opens the app after that date (and that is logged as automatic). Until then the account stays suspended — the system never lifts it behind the student's back, and no scheduled job is needed.

**Under review** is a flag for moderators. It restricts nothing and the student is not told.

Not built: restricting only discovery or only participation, permanent bans as a separate state, verifying students. (Account deletion by the student arrived in Phase 6; it is not a moderation action.)

### Analytics — definitions

| Number | Exactly what is counted |
|---|---|
| Registered accounts | Documents in `users`, including people who never made a profile and admins. Super Admin, platform-wide only. |
| Student profiles / Active / Suspended / Under review | Profiles of the colleges in scope, by current standing. One profile per student; one college per profile. |
| Published | Events hosted by the colleges in scope whose status is `published`. Drafts are never counted. |
| Upcoming / Ongoing | Published or closed events that have not started / have started and not ended. |
| Completed | Events an admin marked completed. |
| Events to mark completed | Published or closed events whose end time has passed. |
| Participations | Rows of `event_participants`: one per student per event. "Different students" is the distinct count. Participants from invited colleges count towards the host college's events. |
| Active discovery profiles | Participations that are open right now: event profile open, account active, event currently accepting participants. |
| Interests sent | One per sender, receiver and event. |
| **Matches** | Rows of `matches`: **one per pair per event**. A match between two students is 1, not 2. |
| Students matched (per event) | Different students with at least one match in that event. |
| Reports submitted / pending / under review / resolved / dismissed | Reports about students of the colleges in scope, by current status. |
| "In the selected period" / columns marked * | The same things counted by creation day, for the chosen calendar days in `NEXT_PUBLIC_APP_TIME_ZONE`. |

Not shown, on purpose: verified-student counts (verification is not built), a participation rate (the number of students who *could* have joined depends on free-text course matching and cannot be counted reliably), anything by gender or other personal characteristics, message counts.

All of it is computed on the server by three services (`admin_overview_stats`, `admin_college_stats`, `admin_event_stats`) with counts over indexed fields; the browser receives finished numbers, never rows to count. There are no charts: at launch scale the tables answer the questions an admin has.

### Activity log

`audit_logs` is append-only **through the application**: the model refuses every update and delete, and no service offers one. MongoDB itself does not enforce this — someone with the connection string can change or remove entries — so this is strong against the app and its admins, not against whoever controls the database. Phase 5 adds entries for:

| Action | Recorded |
|---|---|
| `reports.status_changed` | reference, from, to, the reason given |
| `reports.assigned` / `reports.unassigned` | reference |
| `reports.note_added` | reference and length — **not** the note |
| `reports.evidence_viewed` | reference and number of messages — **not** the messages |
| `profiles.suspend` / `restore` / `flag_review` / `clear_review` | student reference, reason, duration / end date, the report it followed from |
| `user_roles.update` with `by: "command line"` | a Super Admin made or removed by the operator's script |

The actor is always the signed-in user of the request (taken from the session by `call()`); no service takes an actor id. Entries are kept indefinitely; there is no retention job. Earlier phases already record college, role, college-access and event status changes.

### How it is built

Fifteen services (`admin_*`, `list_audit` and `my_account_status`, in `src/lib/services/moderation.js`, `analytics.js` and `profiles.js`) are the interface. The Server Actions in `src/app/admin/moderation-actions.js` validate input and call one service each.

Node.js **20.9 or newer** (tested on 22). Fonts (Bricolage Grotesque, Figtree) are bundled from npm, so builds make no request to Google Fonts.

> Next.js 16 differs from older versions in ways that matter here (`proxy.js`, Cache Components, async `params`/`cookies`). `AGENTS.md` and the docs bundled in `node_modules/next/dist/docs/` describe the installed version.


## How authorization works

Three layers, each of which would stop a request on its own:

1. **`src/proxy.js`** — before anything renders, signed-out visitors to a protected path (`/dashboard`, `/profile`, `/onboarding`, `/events/*`, `/matches/*`, `/account/*`, `/reset-password`, `/admin/*`) get an HTTP redirect to `/login`. It checks only "is there a valid session"; it does not decide roles. A form submitted after the session ended is passed through to its action, whose own guard then redirects — the user lands on the login page instead of an error screen. The chat's three script-called actions (send, load, live-update token) use `requireProfileOrSignedOut()` instead and answer "signed out" without redirecting; the chat screen then leaves by a full page load, which drops the messages it holds in memory and returns the student to the conversation after login.
2. **`src/lib/auth/session.js`** — every page and every Server Action calls a guard (`requireUser`, `requireProfile`, `requireAdmin`, `requireSuperAdmin`, `requireAdminWith`, `requireEventManager`, `requireManagedEvent`). Identity comes from the session cookie: a random token whose hash is looked up in the `sessions` collection on every request; the role is read from the `users` document of that session, every time. Nothing the browser sends is used to decide a role or a college. `tests/unit/guards.test.js` reads the source of every action file and fails if an action does not begin with a guard.
3. **`src/lib/services`** — the only code that touches the database. Every service takes the caller's context (built from the session by `call()`; there is no parameter for a user id, role or college) and starts by checking who is asking, then narrows every query to what that caller may see. MongoDB has no row level security, so **this layer is the access control**: a query written outside it would bypass everything. `tests/services/00-lockdown.test.js` pins the list of services and what each one refuses.

When you add a page or an action: call a guard first, validate input with a Zod schema, put the data access in a service that starts with a `require…` check, register it in `src/lib/services/index.js`, and add it to `tests/services/00-lockdown.test.js` with a test of who is refused. Never import a model into a page, an action or a component.

## Decisions worth knowing about

- **Minimum age is 18**, enforced by the profile service and mirrored by `MIN_AGE` in `src/lib/validation/limits.js`.
- **College and date of birth are fixed after profile creation.** Letting students switch college would let them browse another campus. Changing either is an owner/admin operation for now.
- **Date of birth and gender live in `profile_private`**, a separate collection that only the owner's own services read, so private fields never share a document with fields other people are shown. The email address lives only on the `users` document.
- **Nothing is reachable except through a registered service.** `SERVICES` in `src/lib/services/index.js` is a frozen list; helpers that are not on it cannot be called from a request.
- **Colleges are closed, never deleted**, and the audit log is append-only for every role.
- **Timestamps are shown in one zone** (`NEXT_PUBLIC_APP_TIME_ZONE`, default IST).
- **Course limits on events match free text.** Profiles store the course as typed ("B.Tech Computer Science"). A limit such as "B.Tech" matches when its words appear as whole words in the profile's course, ignoring case and punctuation ("MBA" does not match "BA"). A course written unusually ("B. Tech") can miss. A fixed course list per college would remove this; it means changing the Phase 1 profile form.
- **College verification is shown but not required** to take part, because no admin tool for verifying students exists yet. A profile photo is required.
- **Event status `cancelled` from the Phase 1 schema became `closed`.** The four statuses are draft, published, closed, completed.
- **Events are never deleted.** A draft that is not wanted simply stays a draft.
- **Gender is male or female, asked once, then fixed** (Phase 3). The brief defines preferences as "male partner / female partner"; letting gender change would let someone browse the other pool. It is stored with private profile data and never shown. Students who fit neither option cannot use partner finding — a product decision to revisit.
- **Other students are never identified by user id** in partner pages. Each participation has a random handle valid for that event only, and partner photos are served through an app route keyed by that handle (the stored photo key contains the user id, so it never reaches a browser).
- **A student may hold several matches in one event** and stays discoverable until they close their profile.
- **Blocks apply between two people in every event**; everything else in Phase 3 is per event.
- **Limits:** 50 new interests per event per day, 10 reports per day, one open profile report per person and event, one open chat report per conversation, 20 chat messages per minute.
- **A conversation is the match itself** (Phase 4), addressed by a random id on the match. No conversations table, so no way to create a conversation between arbitrary users.
- **After a block both students can still read their earlier messages; neither can send.** Keeping history readable means a student who blocks someone does not lose the record of what was said (useful for a report), and the blocked student sees nothing change except that sending stops.
- **The live stream carries a ping, not the message.** The text is always fetched through the authorised read path. Slightly more round trips; no private text on the stream and no duplicates by construction.
- **Messages cannot be edited or deleted** in this phase. If deletion is added later, keep the copies attached to reports.
- **Chat continues after an event ends** and after a discovery profile is closed.
- **On phones the bottom tab bar is hidden on a chat screen**, so the message box sits at the bottom edge; the chat has its own back button. Where the browser supports it (Chrome and Firefox on Android), the page shrinks with the on-screen keyboard; on iOS Safari the browser scrolls the message box into view instead.
- **Reports are reached only through functions since Phase 5.** Phase 3 let moderators read the table; that would have let shared chat messages be read without a trace.
- **A suspended student cannot read their old messages.** The alternative (read-only access) was rejected: a suspension for abusive behaviour should also end access to the people involved. Nothing is deleted, so restoring gives everything back.
- **Suspending and restoring touch one field** (`profiles.status`). Event profiles are not closed on suspension, which is why restoring cannot re-open something the student closed.
- **Moderation state is not on the profile row**, because classmates can read profile rows. "Under review" and suspension dates live in `account_moderation`, which no API role can read.
- **Moderation history is the audit log.** There is no second history table that could disagree with it.
- **Admins identify students by first name plus a short reference**, never by email.
- **Light theme only** for now.
- **Account deletion is real deletion, with a documented list of what stays** (Phase 6). Hiding a profile and calling it deleted was rejected.
- **A held deletion request does not say why it is held.** Telling a student "there are reports about you" would break the rule that the reported person learns nothing about a report.
- **Deleting an account removes the other person's copy of the conversation too.** Keeping one side's messages would keep the deleted person's words alive under someone else's account. A report filed before the deletion keeps whatever messages were attached to it.
- **Feedback is Super Admin only**, not per college: it is about the product, and may be about a college's own admins.
