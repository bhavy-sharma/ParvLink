"use server";

import { revalidatePath } from "next/cache";
import { logServerError } from "@/lib/auth/errors";
import { requireProfile } from "@/lib/auth/session";
import { call } from "@/lib/services";

export async function markMatchesSeenAction() {
  await requireProfile();
  const { error } = await call("mark_my_matches_seen");
  if (error) {
    logServerError("matches.mark-seen", error);
    return false;
  }
  revalidatePath("/", "layout");
  return true;
}
