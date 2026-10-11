// Password hashing. bcrypt (via bcryptjs, pure JavaScript — no native build on
// the host). Passwords are never stored, logged or returned; only the hash is.
//
// Also loaded by the scripts in /scripts: relative imports only.

import bcrypt from "bcryptjs";

// 12 rounds ≈ a quarter of a second per check on current server hardware.
const ROUNDS = 12;
// bcrypt only reads the first 72 bytes. The forms cap passwords at 72
// characters; this guards the multi-byte case so two long passwords that
// differ after byte 72 are not treated as equal.
const MAX_BYTES = 72;

export function passwordFitsBcrypt(password) {
  return typeof password === "string" && Buffer.byteLength(password, "utf8") <= MAX_BYTES;
}

export async function hashPassword(password) {
  if (!passwordFitsBcrypt(password) || password.length === 0) throw new Error("password_not_hashable");
  return bcrypt.hash(password, ROUNDS);
}

// Compared against when no account (or no password) exists, so that an unknown
// address takes as long to refuse as a wrong password.
const DUMMY_HASH = bcrypt.hashSync("no-such-account-placeholder", ROUNDS);

/** True only if `password` matches `hash`. Always does one full bcrypt comparison. */
export async function verifyPassword(password, hash) {
  const candidate = typeof password === "string" && passwordFitsBcrypt(password) ? password : "";
  const matched = await bcrypt.compare(candidate, typeof hash === "string" && hash ? hash : DUMMY_HASH);
  return Boolean(hash) && candidate !== "" && matched;
}
