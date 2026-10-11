// Mongoose models: every collection the application stores.
//
// Conventions
//   * `_id` is a random UUID string (the same ids the app has always used in
//     URLs and forms), exposed to callers as `id`.
//   * Field names match the ones the pages already read (snake_case).
//   * Validation here is the last line, like the CHECK constraints it replaces.
//     Who may read or write what is decided in src/lib/services — MongoDB has
//     no row level security, so NOTHING outside the service layer may query
//     these models on behalf of a user.

import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const { Schema } = mongoose;
const newId = () => randomUUID();
const uuid = { type: String, default: newId };
const ref = { type: String, default: null };
const NO_MARKUP = /^[^<>\u0000-\u001f\u007f]*$/;

function define(name, collection, fields, { timestamps = true, indexes = [], setup = null } = {}) {
  const schema = new Schema(
    { _id: uuid, ...fields },
    {
      collection,
      versionKey: false,
      minimize: false,
      strict: "throw", // an unknown field is a bug, not something to drop silently
      timestamps: timestamps === true ? { createdAt: "created_at", updatedAt: "updated_at" } : timestamps,
    },
  );
  for (const [keys, options] of indexes) schema.index(keys, options ?? {});
  setup?.(schema); // hooks have to be attached before the model is compiled, or Mongoose ignores them
  return mongoose.models[name] ?? mongoose.model(name, schema);
}

const createdOnly = { createdAt: "created_at", updatedAt: false };

// ----------------------------------------------------------------------------- accounts
/** Sign-in record and role. The role is changed only by the admin services and the CLI scripts. */
export const User = define(
  "User",
  "users",
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    // bcrypt hash; null while a password has to be (re)chosen through an emailed link.
    password_hash: { type: String, default: null },
    email_confirmed_at: { type: Date, default: null },
    role: { type: String, enum: ["student", "admin", "super_admin"], default: "student" },
    role_granted_by: ref,
    role_updated_at: { type: Date, default: null },
    terms_version: { type: String, default: null, maxlength: 20 },
    terms_accepted_at: { type: Date, default: null },
  },
  { indexes: [[{ email: 1 }, { unique: true }], [{ role: 1 }]] },
);

/** Email-verification and password-reset tokens. Only a SHA-256 hash is stored; each works once and expires. */
export const AuthToken = define(
  "AuthToken",
  "auth_tokens",
  {
    user_id: { type: String, required: true },
    kind: { type: String, enum: ["verify_email", "reset_password"], required: true },
    token_hash: { type: String, required: true },
    // verify_email only: the browser that registered (hash of a cookie value), see services/auth.
    browser_hash: { type: String, default: null },
    expires_at: { type: Date, required: true },
    used_at: { type: Date, default: null },
  },
  { timestamps: createdOnly, indexes: [[{ token_hash: 1 }, { unique: true }], [{ user_id: 1, kind: 1 }], [{ expires_at: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 }]] }, // removed by MongoDB a week after expiry
);

/** Signed-in sessions. The cookie holds a random token; only its hash is stored here. */
export const Session = define(
  "Session",
  "sessions",
  {
    user_id: { type: String, required: true },
    token_hash: { type: String, required: true },
    expires_at: { type: Date, required: true },
    last_seen_at: { type: Date, default: () => new Date() },
    // Set when the session was opened by a password-reset link: until then a new password may be chosen once.
    recovery_until: { type: Date, default: null },
  },
  { timestamps: createdOnly, indexes: [[{ token_hash: 1 }, { unique: true }], [{ user_id: 1 }], [{ expires_at: 1 }, { expireAfterSeconds: 0 }]] }, // expired sessions are removed by MongoDB
);

/** Fixed-window counters for login, registration and email requests. `_id` is "<what>:<who>:<window>". */
export const RateLimit = define(
  "RateLimit",
  "rate_limits",
  { count: { type: Number, default: 0 }, expires_at: { type: Date, required: true } },
  { timestamps: false, indexes: [[{ expires_at: 1 }, { expireAfterSeconds: 0 }]] }, // old counters are removed by MongoDB
);

// ----------------------------------------------------------------------------- colleges and staff
export const College = define(
  "College",
  "colleges",
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    name_lower: { type: String, required: true },
    slug: { type: String, required: true, match: /^[a-z0-9]+(-[a-z0-9]+)*$/, minlength: 2, maxlength: 60 },
    city: { type: String, default: null, maxlength: 80 },
    is_active: { type: Boolean, default: true },
    created_by: ref,
  },
  { indexes: [[{ slug: 1 }, { unique: true }], [{ name_lower: 1 }, { unique: true }], [{ is_active: 1, name: 1 }]] },
);

export const ADMIN_PERMISSIONS = ["view_students", "manage_students", "manage_events", "moderate_reports"];

export const AdminCollegeAccess = define(
  "AdminCollegeAccess",
  "admin_college_access",
  {
    admin_user_id: { type: String, required: true },
    college_id: { type: String, required: true },
    permissions: {
      type: [{ type: String, enum: ADMIN_PERMISSIONS }],
      validate: { validator: (list) => list.length >= 1 && list.length <= 4 && new Set(list).size === list.length, message: "invalid permissions" },
    },
    granted_by: ref,
  },
  { indexes: [[{ admin_user_id: 1, college_id: 1 }, { unique: true }], [{ college_id: 1 }]] },
);

// ----------------------------------------------------------------------------- students
/** What other students may see. `_id` is the user id. Email is never copied here. */
export const Profile = define(
  "Profile",
  "profiles",
  {
    first_name: { type: String, required: true, trim: true, minlength: 1, maxlength: 50, match: NO_MARKUP },
    first_name_lower: { type: String, required: true },
    college_id: { type: String, required: true },
    course: { type: String, required: true, trim: true, minlength: 2, maxlength: 100, match: NO_MARKUP },
    study_year: { type: Number, required: true, min: 1, max: 6, validate: Number.isInteger },
    bio: { type: String, default: null, maxlength: 500 },
    avatar_path: { type: String, default: null }, // key of a document in `photos`
    is_verified: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
  },
  { indexes: [[{ college_id: 1, status: 1 }], [{ college_id: 1, first_name_lower: 1 }]] },
);

/** Private profile data, kept apart so that no query for profiles can return it by accident. `_id` is the user id. */
export const ProfilePrivate = define("ProfilePrivate", "profile_private", {
  date_of_birth: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  gender: { type: String, enum: ["male", "female", null], default: null },
});

/** Moderation state, kept apart from the profile classmates can read. `_id` is the user id. */
export const AccountModeration = define(
  "AccountModeration",
  "account_moderation",
  {
    under_review: { type: Boolean, default: false },
    suspended_at: { type: Date, default: null },
    suspended_until: { type: Date, default: null },
    updated_by: ref,
  },
  { timestamps: { createdAt: false, updatedAt: "updated_at" } },
);

/** Profile photos (re-encoded 512px WebP, well under 1 MB). `_id` is "<user id>/<random>.webp". */
export const Photo = define(
  "Photo",
  "photos",
  {
    user_id: { type: String, required: true },
    content_type: { type: String, enum: ["image/webp"], default: "image/webp" },
    size: { type: Number, required: true, max: 1048576 },
    data: { type: Buffer, required: true },
  },
  { timestamps: createdOnly, indexes: [[{ user_id: 1 }]] },
);

// ----------------------------------------------------------------------------- events
export const EVENT_TYPES = ["dandiya_night", "freshers", "college_fest", "cultural", "technical", "sports", "other"];
export const EVENT_STATUSES = ["draft", "published", "closed", "completed"];

export const Event = define(
  "Event",
  "events",
  {
    college_id: { type: String, required: true },
    title: { type: String, required: true, trim: true, minlength: 3, maxlength: 140 },
    slug: { type: String, required: true, match: /^[a-z0-9]+(-[a-z0-9]+)*$/, minlength: 3, maxlength: 80 },
    description: { type: String, default: null, maxlength: 4000 },
    event_type: { type: String, enum: EVENT_TYPES, default: "other" },
    venue: { type: String, default: null, maxlength: 200 },
    starts_at: { type: Date, required: true },
    ends_at: { type: Date, required: true },
    registration_opens_at: { type: Date, default: null },
    registration_closes_at: { type: Date, default: null },
    minimum_age: { type: Number, default: 18, min: 18, max: 99 },
    // Canonical form produced by services/events.normalizeEligibilityRules().
    eligibility_rules: { type: Schema.Types.Mixed, required: true },
    requirements: { type: String, default: null, maxlength: 2000 },
    status: { type: String, enum: EVENT_STATUSES, default: "draft" },
    published_at: { type: Date, default: null },
    created_by: ref,
  },
  { indexes: [[{ slug: 1 }, { unique: true }], [{ college_id: 1, starts_at: -1 }], [{ status: 1, starts_at: -1 }]] },
);

export const EventParticipant = define(
  "EventParticipant",
  "event_participants",
  {
    event_id: { type: String, required: true },
    user_id: { type: String, required: true },
    status: { type: String, enum: ["active", "closed"], default: "active" },
    looking_for: { type: String, enum: ["male", "female", null], default: null },
    // Opaque, event-specific handle shown to other students instead of the user id.
    public_id: { type: String, default: newId },
    closed_at: { type: Date, default: null },
  },
  {
    indexes: [
      [{ event_id: 1, user_id: 1 }, { unique: true }],
      [{ public_id: 1 }, { unique: true }],
      [{ user_id: 1 }],
      [{ event_id: 1, status: 1, created_at: -1 }],
    ],
  },
);

export const Interest = define(
  "Interest",
  "interests",
  {
    event_id: { type: String, required: true },
    from_user_id: { type: String, required: true },
    to_user_id: { type: String, required: true },
    status: { type: String, enum: ["pending", "accepted"], default: "pending" },
    responded_at: { type: Date, default: null },
  },
  {
    timestamps: createdOnly,
    indexes: [
      [{ event_id: 1, from_user_id: 1, to_user_id: 1 }, { unique: true }],
      [{ event_id: 1, to_user_id: 1, created_at: -1 }],
      [{ to_user_id: 1, status: 1 }],
      [{ from_user_id: 1 }],
    ],
  },
);

/** A mutual match; also the conversation. user_a_id < user_b_id, so a pair has exactly one row per event. */
export const Match = define(
  "Match",
  "matches",
  {
    event_id: { type: String, required: true },
    user_a_id: { type: String, required: true },
    user_b_id: { type: String, required: true },
    status: { type: String, enum: ["active", "ended"], default: "active" },
    // Opaque conversation id used in chat URLs instead of the match id.
    public_id: { type: String, default: newId },
    user_a_seen: { type: Boolean, default: false },
    user_b_seen: { type: Boolean, default: false },
    // Number of the latest message; advanced atomically for every message stored.
    last_seq: { type: Number, default: 0 },
    ended_at: { type: Date, default: null },
  },
  {
    timestamps: createdOnly,
    indexes: [
      [{ event_id: 1, user_a_id: 1, user_b_id: 1 }, { unique: true }],
      [{ public_id: 1 }, { unique: true }],
      [{ user_a_id: 1 }],
      [{ user_b_id: 1 }],
    ],
  },
);

export const Message = define(
  "Message",
  "messages",
  {
    match_id: { type: String, required: true },
    sender_id: { type: String, required: true },
    // The service allows 2000 characters; this bound is in UTF-16 units (an emoji counts as two).
    body: { type: String, required: true, minlength: 1, maxlength: 4000 },
    seq: { type: Number, required: true, min: 1 },
    client_id: { type: String, required: true },
  },
  {
    timestamps: createdOnly,
    indexes: [
      [{ match_id: 1, seq: 1 }, { unique: true }],
      [{ match_id: 1, sender_id: 1, client_id: 1 }, { unique: true }],
      [{ sender_id: 1, created_at: -1 }],
    ],
  },
);

export const Block = define(
  "Block",
  "blocks",
  { blocker_id: { type: String, required: true }, blocked_id: { type: String, required: true } },
  { timestamps: createdOnly, indexes: [[{ blocker_id: 1, blocked_id: 1 }, { unique: true }], [{ blocked_id: 1 }]] },
);

// ----------------------------------------------------------------------------- moderation
export const REPORT_REASONS = ["fake_profile", "harassment", "threats", "misleading_information", "spam", "inappropriate_content", "safety_concern", "other"];
export const REPORT_STATUSES = ["open", "in_review", "resolved", "dismissed"];

export const Report = define(
  "Report",
  "reports",
  {
    reporter_id: ref, // emptied when that account is deleted
    reported_user_id: ref, // emptied when that account is deleted
    college_id: { type: String, required: true },
    event_id: ref,
    match_id: ref,
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: null, maxlength: 2000 },
    // Messages the reporter chose to attach: [{ seq, from, body, sent_at }]
    evidence: { type: [Schema.Types.Mixed], default: null },
    status: { type: String, enum: REPORT_STATUSES, default: "open" },
    assigned_to: ref,
    resolved_by: ref,
    resolved_at: { type: Date, default: null },
    resolution_note: { type: String, default: null, maxlength: 2000 },
    // "One undecided report per reporter and subject": while a report is
    // undecided this is "<reporter>|<subject>"; once decided it becomes the
    // report's own id, which frees the pair for a new report.
    open_key: { type: String, required: true },
  },
  {
    indexes: [
      [{ open_key: 1 }, { unique: true }],
      [{ college_id: 1, status: 1, created_at: -1 }],
      [{ reported_user_id: 1 }],
      [{ reporter_id: 1, created_at: -1 }],
      [{ event_id: 1 }],
    ],
  },
);

export const ReportNote = define(
  "ReportNote",
  "report_notes",
  { report_id: { type: String, required: true }, author_id: ref, body: { type: String, required: true, minlength: 1, maxlength: 2000 } },
  { timestamps: createdOnly, indexes: [[{ report_id: 1, created_at: 1 }]] },
);

/**
 * The record of administrative actions. Entries are only ever inserted:
 * the hooks below refuse every update and delete made through this model.
 * (Someone with direct access to the database can still change it.)
 */
export const AuditLog = define(
  "AuditLog",
  "audit_logs",
  {
    seq: { type: Number, required: true }, // increasing number, used for ordering and as the entry id
    actor_id: ref,
    action: { type: String, required: true, minlength: 3, maxlength: 80 },
    target_table: { type: String, default: null },
    target_id: { type: String, default: null },
    college_id: ref,
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  {
    timestamps: createdOnly,
    indexes: [[{ seq: -1 }, { unique: true }], [{ target_table: 1, target_id: 1, seq: -1 }], [{ college_id: 1, seq: -1 }]],
    setup(schema) {
      const refuse = () => {
        throw new Error("audit_logs is append-only");
      };
      for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) {
        schema.pre(operation, { query: true, document: true }, refuse);
      }
      schema.pre("bulkWrite", refuse);
      schema.pre("save", function appendOnly() {
        if (!this.isNew) refuse();
      });
    },
  },
);

/** Named counters (currently: the audit log's sequence). */
export const Counter = define("Counter", "counters", { value: { type: Number, default: 0 } }, { timestamps: false });

// ----------------------------------------------------------------------------- account lifecycle and feedback
/** `_id` is the user id. Deliberately not tied to the account: the row must outlive it. */
export const AccountDeletionRequest = define(
  "AccountDeletionRequest",
  "account_deletion_requests",
  {
    user_ref: { type: String, required: true },
    college_id: ref,
    status: { type: String, enum: ["pending", "cancelled", "completed"], default: "pending" },
    hold_reason: { type: String, enum: ["suspended", "open_reports", null], default: null },
    requested_at: { type: Date, default: () => new Date() },
    decided_at: { type: Date, default: null },
    decided_by: { type: String, enum: ["self", "admin", null], default: null },
  },
  { timestamps: false, indexes: [[{ status: 1, requested_at: 1 }]] },
);

export const FEEDBACK_CATEGORIES = ["bug", "confusing", "idea", "safety", "other"];

export const Feedback = define(
  "Feedback",
  "feedback",
  {
    user_id: ref,
    college_id: ref,
    category: { type: String, enum: FEEDBACK_CATEGORIES, required: true },
    description: { type: String, required: true, minlength: 10, maxlength: 1000 },
    steps: { type: String, default: null, maxlength: 1000 },
    status: { type: String, enum: ["new", "reviewed"], default: "new" },
    reviewed_at: { type: Date, default: null },
    reviewed_by: ref,
  },
  { timestamps: createdOnly, indexes: [[{ status: 1, created_at: -1 }], [{ user_id: 1, created_at: -1 }]] },
);

export const MODELS = {
  User, AuthToken, Session, RateLimit, College, AdminCollegeAccess, Profile, ProfilePrivate, AccountModeration, Photo,
  Event, EventParticipant, Interest, Match, Message, Block, Report, ReportNote, AuditLog, Counter, AccountDeletionRequest, Feedback,
};
