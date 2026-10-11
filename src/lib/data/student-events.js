import "server-only";

import { eventPhase } from "@/lib/events";
import { call } from "@/lib/services";

const ORDER = { open: 0, upcoming: 1, closed: 2, completed: 3 };

/**
 * Events the signed-in student may see: published, closed or completed events
 * whose rules invite their college. The service decides that; drafts are never
 * returned, not even to someone who is both a student and an admin.
 *
 * Sorted: open first, then opening soon (both soonest first), then closed and
 * completed (most recent first).
 */
export async function listStudentEvents({ limit = 200 } = {}) {
  // Newest first, so that if there are ever more events than the limit it is
  // the oldest ones that drop off the list, not the upcoming ones.
  const { data, error } = await call("list_student_events", { limit });
  if (error) throw new Error("Events could not be loaded.");

  const now = new Date();
  return (data ?? [])
    .map((event) => ({ ...event, phase: eventPhase(event, now) }))
    .sort((a, b) => {
      if (ORDER[a.phase] !== ORDER[b.phase]) return ORDER[a.phase] - ORDER[b.phase];
      const diff = new Date(a.starts_at) - new Date(b.starts_at);
      return a.phase === "open" || a.phase === "upcoming" ? diff : -diff;
    });
}

/** One event by its URL slug, or null if it does not exist or is not visible to this student. */
export async function getStudentEvent(slug) {
  const { data, error } = await call("get_student_event", { slug });
  if (error) throw new Error("The event could not be loaded.");
  return data ?? null;
}
