// Random tokens for sessions and emailed links.
//
// The token itself goes to the browser (cookie) or the mailbox (link). The
// database only ever holds its SHA-256 hash, so a copy of the database does not
// let anyone sign in, confirm an address or reset a password.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, URL-safe (43 characters). */
export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
export function looksLikeToken(value) {
  return typeof value === "string" && TOKEN_SHAPE.test(value);
}

export function sameHash(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
