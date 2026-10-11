import "server-only";

// Shared by every service: errors, the caller's context, authorization
// helpers and the audit log.
//
// MongoDB has no row level security. These functions ARE the access rules now:
// every service takes the caller from `ctx` (built from the session by
// src/lib/auth/session.js — never from a form field or a parameter) and checks
// what that caller may do before touching a model.

import { connectDb } from "@/lib/db/connection";
import { AdminCollegeAccess, AuditLog, Block, College, Counter, Profile, User } from "@/lib/db/models";

// ----------------------------------------------------------------------------- errors
/**
 * A refusal the caller is meant to see. `message` is a stable code that
 * src/lib/auth/errors.js turns into a sentence. `code` keeps the classes the
 * rest of the app already distinguishes:
 *   P0001  a rule said no           42501  not signed in / not allowed
 *   23505  already exists           23514  invalid values     23503  refers to something that is gone
 */
export class ServiceError extends Error {
  constructor(message, { code = "P0001", details = null } = {}) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.details = details;
  }
}

export function fail(message, details = null) {
  throw new ServiceError(message, { details });
}
export function deny(message = "not_authorized") {
  throw new ServiceError(message, { code: "42501" });
}

// ----------------------------------------------------------------------------- caller context
/**
 * The caller of a service. Built once per request from the verified session
 * (or, in tests and scripts, from a user id read from the database).
 *   { uid, role, emailConfirmed }   — uid null means "nobody is signed in".
 */
export function makeContext(user) {
  return {
    uid: user?.id ?? null,
    role: user?.role ?? null,
    emailConfirmed: Boolean(user?.email_confirmed_at),
    memo: new Map(), // per-request cache for the lookups below
  };
}

/** A context for a user id, with the role read from the database. For tests, scripts and background work. */
export async function contextFor(userId) {
  await connectDb();
  const user = userId ? await User.findById(userId).select("role email_confirmed_at").lean() : null;
  return makeContext(user ? { id: user._id, role: user.role, email_confirmed_at: user.email_confirmed_at } : null);
}

async function memo(ctx, key, load) {
  if (!ctx.memo.has(key)) ctx.memo.set(key, Promise.resolve(load()));
  return ctx.memo.get(key);
}

export const isSuperAdmin = (ctx) => Boolean(ctx.uid) && ctx.role === "super_admin";
export const isStaff = (ctx) => Boolean(ctx.uid) && (ctx.role === "admin" || ctx.role === "super_admin");

/** Signed in at all. */
export function requireSignedIn(ctx) {
  if (!ctx?.uid) deny("not_authenticated");
  return ctx.uid;
}

/** The caller's own profile (or null), read once per request. */
export function myProfile(ctx) {
  return memo(ctx, "profile", () => (ctx.uid ? Profile.findById(ctx.uid).lean() : null));
}

/**
 * First line of every partner and chat service: signed in and not suspended.
 * A suspended student is refused here whatever page or request they use.
 */
export async function requireUser(ctx) {
  const uid = requireSignedIn(ctx);
  const profile = await myProfile(ctx);
  if (profile?.status === "suspended") fail("account_suspended");
  return uid;
}

export function requireAdmin(ctx) {
  const uid = requireSignedIn(ctx);
  if (!isStaff(ctx)) deny();
  return uid;
}

export function requireSuperAdmin(ctx) {
  const uid = requireSignedIn(ctx);
  if (!isSuperAdmin(ctx)) deny();
  return uid;
}

/** The college of the caller's ACTIVE profile, or null. */
export async function currentCollegeId(ctx) {
  const profile = await myProfile(ctx);
  return profile && profile.status === "active" ? profile.college_id : null;
}

/** The caller's college assignments. Empty unless the caller currently holds the admin role. */
export function myAssignments(ctx) {
  return memo(ctx, "assignments", () => (ctx.uid && ctx.role === "admin" ? AdminCollegeAccess.find({ admin_user_id: ctx.uid }).lean() : []));
}

/** Super Admin, or an admin assigned to that college with at least one of `wanted` (any permission if none is named). */
export async function hasCollegePermission(ctx, collegeId, ...wanted) {
  if (!ctx.uid || !collegeId) return false;
  if (isSuperAdmin(ctx)) return true;
  const assignments = await myAssignments(ctx);
  return assignments.some((row) => row.college_id === collegeId && (wanted.length === 0 || row.permissions.some((p) => wanted.includes(p))));
}

/** Ids of the colleges the caller administers with at least one of `perms` (any assignment if null). Super Admin: all. */
export async function adminColleges(ctx, perms = null) {
  if (!ctx.uid) return [];
  if (isSuperAdmin(ctx)) {
    const all = await memo(ctx, "allColleges", () => College.find({}).select("_id").lean());
    return all.map((college) => college._id);
  }
  const assignments = await myAssignments(ctx);
  return assignments.filter((row) => perms === null || row.permissions.some((p) => perms.includes(p))).map((row) => row.college_id);
}

export async function isBlockedBetween(one, two) {
  if (!one || !two) return false;
  return Boolean(await Block.exists({ $or: [{ blocker_id: one, blocked_id: two }, { blocker_id: two, blocked_id: one }] }));
}

// ----------------------------------------------------------------------------- audit log
/** "U-3F2B8C1E": how admins refer to a student or report without a name or email. */
export const shortRef = (prefix, id) => `${prefix}-${String(id).replace(/-/g, "").slice(0, 8).toUpperCase()}`;

function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, stripNulls(v)]));
  }
  return value;
}

/**
 * Appends one entry. The actor is always the caller of the service — there is
 * no parameter for it. `actor: null` is for automatic actions and scripts.
 */
export async function audit(ctx, action, table, target, collegeId, metadata = {}) {
  const counter = await Counter.findOneAndUpdate({ _id: "audit_logs" }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean();
  await AuditLog.create({
    seq: counter.value,
    actor_id: ctx?.uid ?? null,
    action,
    target_table: table,
    target_id: target === null || target === undefined ? null : String(target),
    college_id: collegeId ?? null,
    metadata: stripNulls(metadata ?? {}),
  });
}

/** How the actor of an entry is named for the caller: never another admin's identity. */
export async function actorLabel(ctx, actorId, roleCache = new Map()) {
  if (!actorId) return "system";
  if (actorId === ctx.uid) return "you";
  if (!roleCache.has(actorId)) roleCache.set(actorId, (await User.findById(actorId).select("role").lean())?.role ?? null);
  return roleCache.get(actorId) === "super_admin" ? "super_admin" : "admin";
}

// ----------------------------------------------------------------------------- shaping results
/** Lean documents → what pages receive: `id` instead of `_id`, dates as ISO strings. */
export function plain(value) {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    if (value._bsontype === "Binary") return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key === "_id" ? "id" : key] = plain(item);
    return out;
  }
  return value;
}

/** Escapes text for use inside a regular expression (search boxes). */
export const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const clampLimit = (value, fallback, max) => Math.min(Math.max(Number.isInteger(value) ? value : fallback, 1), max);
export const clampOffset = (value) => Math.max(Number.isInteger(value) ? value : 0, 0);

/** Counts for a list of ids in one query: Map(id → count). */
export async function countBy(Model, field, ids, extra = {}) {
  if (ids.length === 0) return new Map();
  const rows = await Model.aggregate([{ $match: { [field]: { $in: ids }, ...extra } }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }]);
  return new Map(rows.map((row) => [row._id, row.n]));
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === "string" && UUID.test(value);
