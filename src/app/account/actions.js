"use server";

// Account deletion and feedback. As everywhere else: each action checks the
// session itself, takes the person from that session (never from the form) and
// lets ONE service decide and apply the change.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { ROUTES } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { formError, formSuccess, GENERIC_ERROR } from "@/lib/form-state";
import { call } from "@/lib/services";
import { checkOwnPassword } from "@/lib/services/auth";
import { deleteAccountSchema, feedbackSchema, fieldErrors } from "@/lib/validation/schemas";

const text = (formData, name) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Deletes the signed-in person's own account — or, when the database decides
 * it has to be held (suspended, or under review), records the request.
 * Nothing in the form says WHOSE account: it is always the caller's.
 */
export async function deleteAccountAction(_previous, formData) {
  const user = await requireUser();
  const parsed = deleteAccountSchema.safeParse({ password: text(formData, "password"), confirm: text(formData, "confirm").trim() });
  if (!parsed.success) return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error) });

  // The current password is asked for again, and checked against the stored hash.
  let check;
  try {
    check = await checkOwnPassword(user.id, parsed.data.password);
  } catch (error) {
    logServerError("account.delete.verify", error);
    return formError(GENERIC_ERROR);
  }
  if (check !== "ok") {
    return formError("Check the highlighted fields.", {
      fieldErrors: { password: check === "limited" ? "Too many attempts. Wait a few minutes and try again." : "That is not your current password." },
    });
  }

  const { data: outcome, error } = await call("delete_my_account");
  if (error) {
    logServerError("account.delete", error);
    return formError(describeDbError(error));
  }

  if (outcome !== "deleted") {
    // Held for an administrator. Nothing was deleted and the account still works.
    revalidatePath(ROUTES.deleteAccount);
    redirect(`${ROUTES.deleteAccount}?requested=1`);
  }

  // The service removed the sign-in record and every session; only this
  // browser's cookie is left to clear.
  (await cookies()).delete(SESSION_COOKIE);
  revalidatePath("/", "layout");
  redirect(ROUTES.goodbye);
}

export async function cancelDeletionAction() {
  await requireUser();
  const { error } = await call("cancel_my_account_deletion");
  if (error) {
    logServerError("account.delete.cancel", error);
    return formError(describeDbError(error));
  }
  revalidatePath(ROUTES.deleteAccount);
  redirect(`${ROUTES.deleteAccount}?cancelled=1`);
}

export async function submitFeedbackAction(_previous, formData) {
  await requireUser();
  const values = { category: text(formData, "category"), description: text(formData, "description"), steps: text(formData, "steps") };
  const parsed = feedbackSchema.safeParse(values);
  if (!parsed.success) return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });

  const { error } = await call("submit_feedback", {
    p_category: parsed.data.category,
    p_description: parsed.data.description,
    p_steps: parsed.data.steps,
  });
  if (error) {
    // Codes only: what was written is never logged.
    logServerError("account.feedback", error);
    return formError(describeDbError(error), { values });
  }
  return formSuccess("Thank you — your feedback has been sent to the team.");
}
