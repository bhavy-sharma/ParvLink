// The whole surface, service by service: what is reachable from a request, and
// that nobody who is not signed in — and no student — gets past the door of
// anything they should not. MongoDB has no row level security; this list and
// the checks inside each service ARE the access rules.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SERVICES } from "@/lib/services";
import { createWorld, refused, testDatabase } from "./helpers";

const db = testDatabase("lockdown");
let world;
beforeAll(async () => {
  await db.start();
  world = await createWorld();
});
afterAll(() => db.stop());

const ID = "3f2b8c1e-5a4d-4e6f-9a7b-0c1d2e3f4a5b";
// Plausible arguments for every service, so a refusal is about WHO, not about bad input.
const ARGS = {
  create_my_profile: { p_first_name: "A", p_college_id: ID, p_course: "BSc", p_study_year: 1, p_date_of_birth: "2000-01-01" },
  update_my_profile: { first_name: "A", course: "BSc", study_year: 1, bio: "" },
  set_my_photo: { webp: Buffer.from("RIFFxxxxWEBP") },
  college_names: { ids: [ID] },
  admin_get_college: { college_id: ID },
  admin_create_college: { name: "New College", slug: "new-college", city: "" },
  admin_update_college: { college_id: ID, name: "New College", slug: "new-college", city: "", is_active: true },
  admin_grant_admin_role: { target_email: "x@y.test" },
  admin_revoke_admin_role: { target_user_id: ID },
  admin_assign_college: { user_id: ID, college_id: ID, permissions: ["view_students"] },
  admin_revoke_college_access: { user_id: ID, college_id: ID },
  get_student_event: { slug: "some-event" },
  event_participation_check: { p_event_id: ID },
  admin_get_event: { event_id: ID },
  admin_create_event: { college_id: ID, title: "An event", event_type: "other", starts_at: new Date(Date.now() + 86400000), ends_at: new Date(Date.now() + 90000000), minimum_age: 18, eligibility_rules: {} },
  admin_update_event: { event_id: ID, row: {} },
  admin_change_event_status: { event_id: ID, from: "draft", to: "published" },
  join_event: { p_event_id: ID, p_looking_for: "male" },
  set_event_profile_open: { p_event_id: ID, p_open: false },
  my_event_participation: { p_event_id: ID },
  discover_event_partners: { p_event_id: ID },
  send_interest: { p_event_id: ID, p_handle: ID },
  list_received_interests: { p_event_id: ID },
  my_received_interest_counts: {},
  my_unread_match_count: {},
  mark_my_matches_seen: {},
  partner_photo: { p_event_id: ID, p_handle: ID },
  block_partner: { p_event_id: ID, p_handle: ID },
  unblock_partner: { p_block_id: ID },
  report_partner: { p_event_id: ID, p_handle: ID, p_reason: "spam" },
  chat_open: { p_conversation: ID },
  chat_messages: { p_conversation: ID },
  chat_latest_seq: { p_conversation: ID },
  chat_send: { p_conversation: ID, p_body: "hello", p_client_id: ID },
  block_chat_partner: { p_conversation: ID },
  report_chat_partner: { p_conversation: ID, p_reason: "spam" },
  admin_get_report: { p_report: ID },
  admin_view_report_evidence: { p_report: ID },
  admin_set_report_status: { p_report: ID, p_status: "in_review" },
  admin_assign_report: { p_report: ID, p_assign: true },
  admin_add_report_note: { p_report: ID, p_body: "a note" },
  admin_get_user: { p_user: ID },
  admin_moderate_user: { p_user: ID, p_action: "suspend", p_reason: "A long enough reason." },
  admin_complete_account_deletion: { p_user: ID },
  submit_feedback: { p_category: "bug", p_description: "A description long enough." },
  admin_set_feedback_reviewed: { p_feedback: ID, p_reviewed: true },
};

const NAMES = Object.keys(SERVICES).sort();
// Everything a college admin or Super Admin can do and a student must never reach.
const STAFF_ONLY = NAMES.filter((name) => name.startsWith("admin_") || ["my_admin_scope", "manageable_colleges", "list_audit"].includes(name));
const SUPER_ADMIN_ONLY = [
  "admin_list_colleges", "admin_get_college", "admin_create_college", "admin_update_college", "admin_list_admins", "admin_grant_admin_role",
  "admin_revoke_admin_role", "admin_list_access", "admin_assign_college", "admin_revoke_college_access", "admin_list_deletion_requests",
  "admin_complete_account_deletion", "admin_list_feedback", "admin_set_feedback_reviewed", "admin_inbox_counts",
];

describe("what is reachable", () => {
  test("the registry is exactly the list this test knows about", () => {
    // Adding a service means deciding, here, who may call it.
    expect(NAMES).toMatchSnapshot();
    expect(Object.isFrozen(SERVICES)).toBe(true);
  });

  test("nothing takes the caller from its arguments", () => {
    for (const name of NAMES) {
      const source = SERVICES[name].toString();
      const params = source.slice(source.indexOf("(") + 1, source.indexOf(")"));
      expect(params.startsWith("ctx"), name).toBe(true);
      for (const forbidden of ["actor", "caller", "sender", "reporter", "p_uid", "as_user"]) expect(source.slice(0, 300), `${name}: ${forbidden}`).not.toContain(`${forbidden}_id`);
    }
  });
});

describe("a visitor who is not signed in", () => {
  test.each(NAMES)("%s is refused", async (name) => {
    expect(await refused(null, name, ARGS[name] ?? {})).toBe("not_authenticated");
  });
});

describe("a student — including one who knows every id", () => {
  test.each(STAFF_ONLY)("%s is refused", async (name) => {
    for (const who of [world.u.a1, world.u.newcomer, world.u.suspendedA]) {
      expect(await refused(who, name, ARGS[name] ?? {}), `${name} as ${who}`).toBe("not_authorized");
    }
  });
});

describe("a college admin — even with every permission on their college", () => {
  test.each(SUPER_ADMIN_ONLY)("%s is Super Admin only", async (name) => {
    for (const who of [world.u.adminA, world.u.adminNone]) expect(await refused(who, name, ARGS[name] ?? {})).toBe("not_authorized");
  });
});

describe("a signed-in account whose user record is gone", () => {
  test("is treated as nobody", async () => {
    expect(await refused("00000000-0000-4000-8000-000000000000", "my_profile")).toBe("not_authenticated");
  });
});
