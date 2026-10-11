import "server-only";

import { call } from "@/lib/services";

/** Colleges a student can pick: open ones only. */
export async function listActiveColleges() {
  const { data, error } = await call("list_active_colleges");
  if (error) throw new Error("Colleges could not be loaded.");
  return data ?? [];
}
