import "server-only";

// Small fixed-window rate limiter backed by MongoDB, so the count is shared by
// every server instance. One document per (what, who, window); the increment is
// a single atomic upsert.

import { connectDb, isDuplicateKey } from "@/lib/db/connection";
import { RateLimit } from "@/lib/db/models";
import { hashToken } from "@/lib/auth/tokens";

/**
 * The limits. Per-address limits are strict. Per-network limits are loose on
 * purpose: a whole campus can sit behind one IP address.
 */
export const LIMITS = Object.freeze({
  loginFailuresPerEmail: { limit: 8, windowSeconds: 15 * 60 },
  loginPerIp: { limit: 300, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 100, windowSeconds: 60 * 60 },
  verifyEmailPerEmailMinute: { limit: 1, windowSeconds: 60 },
  verifyEmailPerEmailHour: { limit: 5, windowSeconds: 60 * 60 },
  resetPerEmailHour: { limit: 3, windowSeconds: 60 * 60 },
  emailRequestsPerIp: { limit: 60, windowSeconds: 60 * 60 },
  passwordChecksPerUser: { limit: 8, windowSeconds: 15 * 60 },
});

const keyOf = (name, subject, windowSeconds, now) => `${name}:${hashToken(String(subject).toLowerCase()).slice(0, 32)}:${Math.floor(now / (windowSeconds * 1000))}`;

/** Counts one use. Returns { allowed, remaining }. The subject (email, IP) is stored only as a hash. */
export async function consume(name, subject, now = Date.now()) {
  const rule = LIMITS[name];
  if (!rule) throw new Error(`unknown rate limit: ${name}`);
  await connectDb();
  const _id = keyOf(name, subject, rule.windowSeconds, now);
  const update = { $inc: { count: 1 }, $setOnInsert: { expires_at: new Date(now + rule.windowSeconds * 2000) } };
  let doc;
  try {
    doc = await RateLimit.findOneAndUpdate({ _id }, update, { upsert: true, new: true }).lean();
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    doc = await RateLimit.findOneAndUpdate({ _id }, { $inc: { count: 1 } }, { new: true }).lean(); // two first hits raced
  }
  return { allowed: doc.count <= rule.limit, remaining: Math.max(0, rule.limit - doc.count) };
}

/** Reads without counting: has the limit already been reached? */
export async function isLimited(name, subject, now = Date.now()) {
  const rule = LIMITS[name];
  await connectDb();
  const doc = await RateLimit.findOne({ _id: keyOf(name, subject, rule.windowSeconds, now) }).lean();
  return (doc?.count ?? 0) >= rule.limit;
}

/** Clears a counter (after a successful login). */
export async function reset(name, subject, now = Date.now()) {
  const rule = LIMITS[name];
  await connectDb();
  await RateLimit.deleteOne({ _id: keyOf(name, subject, rule.windowSeconds, now) });
}

/** Housekeeping: removes counters whose window is long over. Cheap; called now and then. */
export async function sweepRateLimits(now = Date.now()) {
  await connectDb();
  await RateLimit.deleteMany({ expires_at: { $lt: new Date(now) } });
}
