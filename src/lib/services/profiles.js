import "server-only";

// Student profiles, private profile data and photos.

import { randomUUID } from "node:crypto";
import { ageOn, parseIsoDate, todayIso } from "@/lib/dates";
import { isDuplicateKey } from "@/lib/db/connection";
import { AccountModeration, College, Photo, Profile, ProfilePrivate, User } from "@/lib/db/models";
import { MIN_AGE } from "@/lib/validation/limits";
import { audit, deny, fail, hasCollegePermission, myProfile, plain, requireSignedIn, shortRef } from "./core";

const NO_MARKUP = /^[^<>\u0000-\u001f\u007f]*$/;
const cleanBio = (bio) => {
  const text = typeof bio === "string" ? bio.trim() : "";
  return text === "" ? null : text;
};

/** The caller's own profile with its college, or null if they have not created one. */
export async function my_profile(ctx) {
  requireSignedIn(ctx);
  const profile = await myProfile(ctx);
  if (!profile) return null;
  const college = await College.findById(profile.college_id).select("name city").lean();
  return plain({ ...profile, colleges: college ? { id: college._id, name: college.name, city: college.city } : null });
}

/** The caller's own private data. There is no way to ask for anyone else's. */
export async function my_private_profile(ctx) {
  const uid = requireSignedIn(ctx);
  const row = await ProfilePrivate.findById(uid).select("date_of_birth gender").lean();
  return row ? { date_of_birth: row.date_of_birth, gender: row.gender ?? null } : null;
}

/**
 * Creates the caller's profile. The only way a profile comes into existence:
 * confirmed email, an open college, a real date of birth and the minimum age
 * are all checked here, not only by the form.
 */
export async function create_my_profile(ctx, { p_first_name, p_college_id, p_course, p_study_year, p_date_of_birth, p_bio = null }) {
  const uid = requireSignedIn(ctx);
  const user = await User.findById(uid).select("email_confirmed_at").lean();
  if (!user?.email_confirmed_at) fail("email_not_verified");
  if (await Profile.exists({ _id: uid })) fail("profile_exists");
  if (!p_college_id || !(await College.exists({ _id: p_college_id, is_active: true }))) fail("invalid_college");

  const today = todayIso();
  const hundredYearsAgo = `${Number(today.slice(0, 4)) - 100}${today.slice(4)}`;
  if (!parseIsoDate(p_date_of_birth) || p_date_of_birth > today || p_date_of_birth < hundredYearsAgo) fail("invalid_date_of_birth");
  if (ageOn(p_date_of_birth) < MIN_AGE) fail("under_age");

  const firstName = String(p_first_name ?? "").trim();
  const course = String(p_course ?? "").trim();
  const year = Number(p_study_year);
  if (firstName.length < 1 || firstName.length > 50 || !NO_MARKUP.test(firstName)) fail("invalid_profile", "first_name");
  if (course.length < 2 || course.length > 100 || !NO_MARKUP.test(course)) fail("invalid_profile", "course");
  if (!Number.isInteger(year) || year < 1 || year > 6) fail("invalid_profile", "study_year");
  const bio = cleanBio(p_bio);
  if (bio && bio.length > 500) fail("invalid_profile", "bio");

  // Private data first: a profile never exists without its date of birth.
  await ProfilePrivate.updateOne({ _id: uid }, { $set: { date_of_birth: p_date_of_birth }, $setOnInsert: { gender: null } }, { upsert: true });
  try {
    await Profile.create({ _id: uid, first_name: firstName, first_name_lower: firstName.toLowerCase(), college_id: p_college_id, course, study_year: year, bio });
  } catch (error) {
    if (isDuplicateKey(error)) fail("profile_exists");
    throw error;
  }
  ctx.memo.delete("profile");
  return uid;
}

/**
 * Edits the caller's own profile: name, course, year and bio only. College,
 * verification and status are not writable here by anyone.
 * Returns false when the profile cannot be edited (missing or suspended).
 */
export async function update_my_profile(ctx, { first_name, course, study_year, bio }) {
  const uid = requireSignedIn(ctx);
  const name = String(first_name ?? "").trim();
  const courseText = String(course ?? "").trim();
  const year = Number(study_year);
  const bioText = cleanBio(bio);
  if (name.length < 1 || name.length > 50 || !NO_MARKUP.test(name)) fail("invalid_profile", "first_name");
  if (courseText.length < 2 || courseText.length > 100 || !NO_MARKUP.test(courseText)) fail("invalid_profile", "course");
  if (!Number.isInteger(year) || year < 1 || year > 6) fail("invalid_profile", "study_year");
  if (bioText && bioText.length > 500) fail("invalid_profile", "bio");

  const result = await Profile.updateOne(
    { _id: uid, status: "active" },
    { $set: { first_name: name, first_name_lower: name.toLowerCase(), course: courseText, study_year: year, bio: bioText } },
  );
  ctx.memo.delete("profile");
  return result.matchedCount === 1;
}

// ----------------------------------------------------------------------------- photos
/**
 * Stores a new photo for the caller and makes it their profile photo.
 * `webp` must already be the re-encoded image (src/lib/images.js); the storage
 * key is made here from the caller's id and a random name.
 * Returns false when the profile cannot be edited.
 */
export async function set_my_photo(ctx, { webp }) {
  const uid = requireSignedIn(ctx);
  if (!Buffer.isBuffer(webp) || webp.length === 0 || webp.length > 1048576) fail("invalid_photo");
  // "RIFF....WEBP": only what our own encoder produces is ever stored.
  if (webp.subarray(0, 4).toString("latin1") !== "RIFF" || webp.subarray(8, 12).toString("latin1") !== "WEBP") fail("invalid_photo");
  const profile = await Profile.findById(uid).select("status avatar_path").lean();
  if (!profile || profile.status !== "active") return false;

  const key = `${uid}/${randomUUID()}.webp`;
  await Photo.create({ _id: key, user_id: uid, size: webp.length, data: webp });
  const linked = await Profile.updateOne({ _id: uid, status: "active" }, { $set: { avatar_path: key } });
  if (linked.matchedCount !== 1) {
    await Photo.deleteOne({ _id: key });
    return false;
  }
  // Every older photo of this user goes, not only the one that was linked.
  await Photo.deleteMany({ user_id: uid, _id: { $ne: key } });
  ctx.memo.delete("profile");
  return true;
}

export async function remove_my_photo(ctx) {
  const uid = requireSignedIn(ctx);
  const unlinked = await Profile.updateOne({ _id: uid, status: "active" }, { $set: { avatar_path: null } });
  if (unlinked.matchedCount !== 1) return false;
  await Photo.deleteMany({ user_id: uid });
  ctx.memo.delete("profile");
  return true;
}

/** The caller's own current photo: { data, content_type } or null. */
export async function my_photo(ctx) {
  const uid = requireSignedIn(ctx);
  const profile = await myProfile(ctx);
  if (!profile?.avatar_path) return null;
  const photo = await Photo.findOne({ _id: profile.avatar_path, user_id: uid }).select("data content_type").lean();
  return photo ? { data: Buffer.from(photo.data.buffer ?? photo.data), content_type: photo.content_type } : null;
}

// ----------------------------------------------------------------------------- colleges a student may see
/** Open colleges, for the onboarding form and event invitations. */
export async function list_active_colleges(ctx) {
  requireSignedIn(ctx);
  const rows = await College.find({ is_active: true }).select("name city").sort({ name: 1 }).lean();
  return rows.map((college) => ({ id: college._id, name: college.name, city: college.city }));
}

/** Names of specific colleges, limited to the ones the caller may know about: open ones, and closed ones they administer. */
export async function college_names(ctx, { ids }) {
  requireSignedIn(ctx);
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string"))].slice(0, 200);
  if (wanted.length === 0) return [];
  const rows = await College.find({ _id: { $in: wanted } }).select("name city is_active").lean();
  const visible = [];
  for (const college of rows) {
    if (college.is_active || (await hasCollegePermission(ctx, college._id))) visible.push({ id: college._id, name: college.name, city: college.city });
  }
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------------------- account standing
/**
 * The caller's own standing: { status, suspended_until }. Never the reason or
 * who decided. Also where a suspension with an end date is lifted once that
 * date has passed (and recorded as an automatic action).
 */
export async function my_account_status(ctx) {
  const uid = requireSignedIn(ctx);
  const profile = await Profile.findById(uid).select("status college_id").lean();
  if (!profile) return { status: null };
  const moderation = await AccountModeration.findById(uid).select("suspended_until").lean();
  const until = moderation?.suspended_until ?? null;

  if (profile.status === "suspended" && until && until <= new Date()) {
    const restored = await Profile.updateOne({ _id: uid, status: "suspended" }, { $set: { status: "active" } });
    if (restored.modifiedCount === 1) {
      await AccountModeration.updateOne({ _id: uid }, { $set: { suspended_at: null, suspended_until: null, updated_by: null } });
      await audit(null, "profiles.restore", "profiles", uid, profile.college_id, { ref: shortRef("U", uid), automatic: true, reason: "Suspension period ended" });
    }
    ctx.memo.delete("profile");
    return { status: "active", suspended_until: null };
  }
  return { status: profile.status, suspended_until: profile.status === "suspended" && until ? until.toISOString() : null };
}

/** Guard used by the photo routes: refuses when nobody is signed in. */
export function assertSignedIn(ctx) {
  if (!ctx?.uid) deny("not_authenticated");
}
