#!/usr/bin/env node
// Seeds a development or demo database with one account of each kind:
//
//   superadmin@campus.test   Super Admin
//   admin@campus.test        College admin (Demo Institute of Technology, every permission)
//   student@campus.test      Student with a complete profile and photo
//   student2@campus.test     A second student, so discovery and matching can be tried
//   user@campus.test         A confirmed account that has not created a profile yet
//
// plus two colleges and one published event that both students have joined.
//
//   npm run seed                       # create what is missing, leave the rest alone
//   npm run seed -- --reset-passwords  # also set every seed account's password again
//
// The password is SEED_PASSWORD if set, otherwise the default printed at the
// end. These are DUMMY accounts with a publicly known password:
// the script refuses to run with NODE_ENV=production unless --force is given,
// and nothing in the application ever runs it.

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { withDb } from "./lib/env.mjs";

const args = new Set(process.argv.slice(2));
const DEFAULT_PASSWORD = "CampusDemo2026";
const password = process.env.SEED_PASSWORD || DEFAULT_PASSWORD;

if (process.env.NODE_ENV === "production" && !args.has("--force")) {
  console.error("Refusing to seed dummy accounts with NODE_ENV=production. Use --force only on a database that is not used by real students.");
  process.exit(1);
}
if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password) || Buffer.byteLength(password) > 72) {
  console.error("SEED_PASSWORD must be 10 to 72 characters with at least one letter and one number.");
  process.exit(1);
}

const COLLEGES = [
  { name: "Demo Institute of Technology", slug: "demo-institute-of-technology", city: "Pune" },
  { name: "Sample Arts and Science College", slug: "sample-arts-and-science-college", city: "Mumbai" },
];

const ACCOUNTS = [
  { email: "superadmin@campus.test", role: "super_admin", label: "Super Admin" },
  { email: "admin@campus.test", role: "admin", label: "College admin", adminOf: 0 },
  {
    email: "student@campus.test", role: "student", label: "Student",
    profile: { first_name: "Aarav", course: "B.Tech Computer Science", study_year: 2, bio: "Looking for a dandiya partner who does not mind two left feet.", date_of_birth: "2005-03-14", gender: "male", college: 0, colour: "#3b2fb8" },
    joins: "female",
  },
  {
    email: "student2@campus.test", role: "student", label: "Student",
    profile: { first_name: "Diya", course: "B.Tech Electronics", study_year: 3, bio: "Quiz nights, hackathons, and anything with music.", date_of_birth: "2004-08-22", gender: "female", college: 0, colour: "#f2a516" },
    joins: "male",
  },
  { email: "user@campus.test", role: "student", label: "User without a profile" },
];

const photo = (colour) => sharp({ create: { width: 512, height: 512, channels: 3, background: colour } }).webp({ quality: 80 }).toBuffer();

await withDb(async () => {
  const { AdminCollegeAccess, ADMIN_PERMISSIONS, College, Event, EventParticipant, Photo, Profile, ProfilePrivate, User } = await import("../src/lib/db/models.js");
  const { hashPassword } = await import("../src/lib/auth/passwords.js");
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const log = (what, created) => console.log(`${created ? "created " : "exists  "} ${what}`);

  // --- colleges
  const colleges = [];
  for (const item of COLLEGES) {
    let college = await College.findOne({ slug: item.slug });
    const created = !college;
    if (created) college = await College.create({ ...item, name_lower: item.name.toLowerCase(), is_active: true });
    colleges.push(college);
    log(`college   ${item.name}`, created);
  }

  // --- accounts
  const users = new Map();
  for (const item of ACCOUNTS) {
    let user = await User.findOne({ email: item.email });
    const created = !user;
    if (created) {
      // Seed accounts are created already confirmed, so no email has to be sent to try the app.
      user = await User.create({ email: item.email, password_hash: passwordHash, email_confirmed_at: now, role: item.role, role_updated_at: now, terms_version: "seed", terms_accepted_at: now });
    } else if (args.has("--reset-passwords")) {
      await User.updateOne({ _id: user._id }, { $set: { password_hash: passwordHash, email_confirmed_at: user.email_confirmed_at ?? now, role: item.role } });
    }
    users.set(item.email, user);
    log(`account   ${item.email}  (${item.label})`, created);

    if (item.adminOf !== undefined) {
      const college = colleges[item.adminOf];
      const assigned = await AdminCollegeAccess.findOne({ admin_user_id: user._id, college_id: college._id });
      if (!assigned) await AdminCollegeAccess.create({ admin_user_id: user._id, college_id: college._id, permissions: [...ADMIN_PERMISSIONS] });
      log(`access    ${item.email} → ${college.name} (all permissions)`, !assigned);
    }

    if (item.profile) {
      const { date_of_birth: dateOfBirth, gender, college: collegeIndex, colour, ...fields } = item.profile;
      const hasProfile = await Profile.exists({ _id: user._id });
      if (!hasProfile) {
        const key = `${user._id}/${randomUUID()}.webp`;
        const data = await photo(colour);
        await Photo.create({ _id: key, user_id: user._id, size: data.length, data });
        await ProfilePrivate.updateOne({ _id: user._id }, { $set: { date_of_birth: dateOfBirth, gender } }, { upsert: true });
        await Profile.create({ _id: user._id, ...fields, first_name_lower: fields.first_name.toLowerCase(), college_id: colleges[collegeIndex]._id, avatar_path: key });
      }
      log(`profile   ${fields.first_name} (${item.email})`, !hasProfile);
    }
  }

  // --- one published event at the first college, joined by both students
  const title = "Demo Dandiya Night";
  let event = await Event.findOne({ college_id: colleges[0]._id, title });
  const createdEvent = !event;
  if (createdEvent) {
    const starts = new Date(now.getTime() + 14 * 86400000);
    event = await Event.create({
      college_id: colleges[0]._id,
      title,
      slug: `demo-dandiya-night-${randomUUID().slice(0, 6)}`,
      description: "A seeded example event: garba and dandiya on the main lawn. Come as a pair, or find a partner here.",
      event_type: "dandiya_night",
      venue: "Main lawn",
      starts_at: starts,
      ends_at: new Date(starts.getTime() + 4 * 3600000),
      minimum_age: 18,
      eligibility_rules: { colleges: { mode: "selected", ids: [colleges[0]._id] }, courses: [], study_years: [] },
      status: "published",
      published_at: now,
      created_by: users.get("admin@campus.test")._id,
    });
  }
  log(`event     ${title}`, createdEvent);
  for (const item of ACCOUNTS.filter((account) => account.joins)) {
    const user = users.get(item.email);
    const joined = await EventParticipant.exists({ event_id: event._id, user_id: user._id });
    if (!joined) await EventParticipant.create({ event_id: event._id, user_id: user._id, status: "active", looking_for: item.joins });
    log(`joined    ${item.email} → ${title}`, !joined);
  }

  console.log("\nSeed accounts (all confirmed, all with the same password):\n");
  for (const item of ACCOUNTS) console.log(`  ${item.email.padEnd(26)} ${item.label}`);
  console.log(`\n  Password: ${process.env.SEED_PASSWORD ? "(the value of SEED_PASSWORD)" : DEFAULT_PASSWORD}`);
  console.log("\nThese are dummy accounts. Never run this against a database real students use.");
});
