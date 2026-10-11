import "server-only";

import { call } from "@/lib/services";

/**
 * Names for the colleges an event's rules mention, as a Map(id → name).
 * Read as the viewer, so a student only gets names of colleges they may see
 * (open ones); the rest are summarised as "N other colleges".
 */
export async function getCollegeNames(events) {
  const ids = new Set();
  for (const event of [events].flat()) {
    for (const id of event?.eligibility_rules?.colleges?.ids ?? []) ids.add(id);
    if (event?.colleges?.id) ids.add(event.colleges.id);
  }
  const names = new Map();
  for (const event of [events].flat()) {
    if (event?.colleges?.id) names.set(event.colleges.id, event.colleges.name);
  }
  const missing = [...ids].filter((id) => !names.has(id));
  if (missing.length > 0) {
    const { data } = await call("college_names", { ids: missing });
    for (const college of data ?? []) names.set(college.id, college.name);
  }
  return names;
}
