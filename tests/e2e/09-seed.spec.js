// The seed script (`npm run seed`): the five dummy accounts it creates can
// really sign in to the running app and land where their role belongs.
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { closeDb, db, login, mailFor } from "./helpers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const run = promisify(execFile);
const SEED_PASSWORD = "SeedCheck2026x";
const seed = (...args) => run(process.execPath, ["scripts/seed.mjs", ...args], { cwd: ROOT, env: { ...process.env, SEED_PASSWORD, NODE_ENV: "test" } });

test.describe.configure({ mode: "serial" });
test.afterAll(closeDb);

test("the script creates the accounts once; running it again changes nothing", async () => {
  const first = await seed();
  expect(first.stdout).toContain("superadmin@campus.test");
  expect(first.stdout).not.toContain(SEED_PASSWORD); // a password taken from the environment is not printed
  const { AdminCollegeAccess, EventParticipant, Profile, User } = await db();
  const users = await User.find({ email: /@campus\.test$/ }).sort({ email: 1 }).lean();
  expect(users.map((user) => [user.email, user.role])).toEqual([
    ["admin@campus.test", "admin"],
    ["student2@campus.test", "student"],
    ["student@campus.test", "student"],
    ["superadmin@campus.test", "super_admin"],
    ["user@campus.test", "student"],
  ]);
  for (const user of users) {
    expect(user.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(user.email_confirmed_at).toBeInstanceOf(Date);
    expect(await mailFor(user.email)).toEqual([]); // seeding sends no email
  }
  const ids = users.map((user) => user._id);
  expect(await Profile.countDocuments({ _id: { $in: ids } })).toBe(2);
  expect(await AdminCollegeAccess.countDocuments({ admin_user_id: { $in: ids } })).toBe(1);
  expect(await EventParticipant.countDocuments({ user_id: { $in: ids } })).toBe(2);

  const again = await seed();
  expect(again.stdout).not.toMatch(/^created/m);
  expect(await User.countDocuments({ email: /@campus\.test$/ })).toBe(5);
});

test("it refuses to run in production", async () => {
  await expect(run(process.execPath, ["scripts/seed.mjs"], { cwd: ROOT, env: { ...process.env, NODE_ENV: "production" } })).rejects.toMatchObject({ code: 1 });
});

for (const [email, lands, sees] of [
  ["superadmin@campus.test", /\/admin$/, "You have access to every college."],
  ["admin@campus.test", /\/admin$/, "Demo Institute of Technology"],
  ["student@campus.test", /\/dashboard$/, "Hi, Aarav"],
  ["student2@campus.test", /\/dashboard$/, "Hi, Diya"],
  ["user@campus.test", /\/onboarding$/, "Create your profile"],
]) {
  test(`${email} signs in and lands in the right place`, async ({ page }) => {
    await login(page, email, SEED_PASSWORD);
    await expect(page).toHaveURL(lands);
    await expect(page.getByText(sees).first()).toBeVisible();
  });
}

test("the two seeded students can find each other in the seeded event", async ({ page }) => {
  await login(page, "student@campus.test", SEED_PASSWORD);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/events");
  await page.getByRole("link", { name: /Demo Dandiya Night/ }).first().click();
  await page.getByRole("link", { name: "Open partner discovery" }).click();
  await expect(page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Diya", exact: true }) })).toBeVisible();
});
