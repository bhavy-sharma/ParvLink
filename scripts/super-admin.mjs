#!/usr/bin/env node
// Makes an account a Super Admin, or takes that role away.
//
//   npm run admin:bootstrap -- you@your-college.edu
//   npm run admin:demote    -- you@your-college.edu
//
// This is the ONLY way a Super Admin comes into existence. It runs on a
// machine that holds the database connection string — nothing reachable from
// the website can do this, and nobody gets the role by registering first.
// The account must already exist and have a confirmed email address. Both
// actions are written to the audit log.

import { withDb } from "./lib/env.mjs";

const [action, rawEmail] = process.argv.slice(2);
const email = String(rawEmail ?? "").trim().toLowerCase();
if (!["promote", "demote"].includes(action) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/super-admin.mjs <promote|demote> <email>");
  process.exit(1);
}

await withDb(async () => {
  const { AdminCollegeAccess, AuditLog, Counter, User } = await import("../src/lib/db/models.js");
  const user = await User.findOne({ email }).lean();
  if (!user || !user.email_confirmed_at) {
    throw new Error(`No email-confirmed account found for "${email}". Register and confirm the address in the app first.`);
  }
  const next = action === "promote" ? "super_admin" : "student";
  if (action === "demote" && user.role !== "super_admin") throw new Error(`"${email}" is not a Super Admin.`);
  if (user.role === next) {
    console.log(`"${email}" already has the role ${next}. Nothing changed.`);
    return;
  }
  await User.updateOne({ _id: user._id }, { $set: { role: next, role_granted_by: null, role_updated_at: new Date() } });
  // A Super Admin needs no college assignments; a former admin's are removed with the role.
  await AdminCollegeAccess.deleteMany({ admin_user_id: user._id });
  const counter = await Counter.findOneAndUpdate({ _id: "audit_logs" }, { $inc: { value: 1 } }, { upsert: true, new: true }).lean();
  await AuditLog.create({ seq: counter.value, actor_id: null, action: "user_roles.update", target_table: "user_roles", target_id: user._id, college_id: null, metadata: { old: { role: user.role }, new: { role: next }, by: "command line" } });
  console.log(`"${email}" is now ${next === "super_admin" ? "a Super Admin" : "a student"}. They should log out and log in again.`);
});
