import "server-only";

import { auditSubject } from "@/lib/admin";
import { call } from "@/lib/services";

// How the people in an audit entry are named for whoever is looking at it.
//   Super Admin   sees admins' sign-in emails (as on the Admins screen).
//   College admin sees "you" or "another admin" — never another admin's identity.
// Students are never named here: entries about them carry a short reference.

/** Returns { actorName(entry), subjectFor(entry) } for the signed-in admin. */
export async function auditNames(scope) {
  let emails = new Map();
  if (scope.isSuperAdmin) {
    const { data } = await call("admin_list_admins");
    emails = new Map((data ?? []).map((person) => [person.user_id, person.email]));
  }
  return {
    actorName(entry) {
      if (!entry.actor_id) return entry.metadata?.automatic ? "the system" : "the database owner";
      if (entry.actor_id === scope.user.id) return "you";
      if (scope.isSuperAdmin) return emails.get(entry.actor_id) ?? "a former admin";
      return "another admin";
    },
    subjectFor(entry) {
      if (["user_roles", "admin_college_access"].includes(entry.target_table)) return emails.get(entry.target_id) ?? null;
      return auditSubject(entry);
    },
  };
}
