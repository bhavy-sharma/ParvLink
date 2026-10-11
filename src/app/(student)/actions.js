"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeDbError, logServerError } from "@/lib/auth/errors";
import { ROUTES } from "@/lib/auth/routes";
import { getMyProfile, requireProfile, requireUser } from "@/lib/auth/session";
import { formError, formSuccess } from "@/lib/form-state";
import { toAvatarWebp, UnsupportedImageError } from "@/lib/images";
import { call } from "@/lib/services";
import { AVATAR_ACCEPTED_TYPES, AVATAR_MAX_UPLOAD_BYTES } from "@/lib/validation/limits";
import { fieldErrors, profileCreateSchema, profileUpdateSchema } from "@/lib/validation/schemas";

const text = (formData, name) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function createProfileAction(_previous, formData) {
  await requireUser();
  if (await getMyProfile()) redirect(ROUTES.dashboard);

  const values = {
    firstName: text(formData, "firstName"),
    collegeId: text(formData, "collegeId"),
    course: text(formData, "course"),
    studyYear: text(formData, "studyYear"),
    dateOfBirth: text(formData, "dateOfBirth"),
    bio: text(formData, "bio"),
  };
  const parsed = profileCreateSchema.safeParse(values);
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });
  }

  // The function takes no user id: the database uses the caller's verified
  // session, and re-checks email confirmation, college and age itself.
  const { error } = await call("create_my_profile", {
    p_first_name: parsed.data.firstName,
    p_college_id: parsed.data.collegeId,
    p_course: parsed.data.course,
    p_study_year: parsed.data.studyYear,
    p_date_of_birth: parsed.data.dateOfBirth,
    p_bio: parsed.data.bio,
  });

  if (error) {
    if (error.message === "profile_exists") redirect(ROUTES.dashboard);
    logServerError("profile.create", error);
    const fieldByMessage = { invalid_college: "collegeId", under_age: "dateOfBirth", invalid_date_of_birth: "dateOfBirth" };
    const field = fieldByMessage[error.message];
    const message = describeDbError(error);
    return formError(field ? "Check the highlighted fields." : message, { fieldErrors: field ? { [field]: message } : {}, values });
  }

  revalidatePath("/", "layout");
  redirect(ROUTES.dashboard);
}

export async function updateProfileAction(_previous, formData) {
  await requireProfile();

  const values = {
    firstName: text(formData, "firstName"),
    course: text(formData, "course"),
    studyYear: text(formData, "studyYear"),
    bio: text(formData, "bio"),
  };
  const parsed = profileUpdateSchema.safeParse(values);
  if (!parsed.success) {
    return formError("Check the highlighted fields.", { fieldErrors: fieldErrors(parsed.error), values });
  }

  // Only these four columns are listed, and the database would reject any
  // other column anyway (college, verification and status are not writable).
  // The profile edited is always the caller's own; the service takes it from the session.
  const { data: saved, error } = await call("update_my_profile", {
    first_name: parsed.data.firstName,
    course: parsed.data.course,
    study_year: parsed.data.studyYear,
    bio: parsed.data.bio,
  });

  if (error) {
    logServerError("profile.update", error);
    return formError(describeDbError(error), { values });
  }
  if (!saved) {
    return formError("Your profile cannot be edited right now. If it has been suspended, contact your college admin.", { values });
  }

  revalidatePath("/", "layout");
  return formSuccess("Profile saved.", { values });
}

export async function updateAvatarAction(_previous, formData) {
  await requireProfile();

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return formError("Choose a photo first.");
  }
  if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
    return formError("That photo is larger than 4 MB. Choose a smaller one.");
  }
  if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
    return formError("Use a JPEG, PNG or WebP photo.");
  }

  let webp;
  try {
    // Decodes and re-encodes the image: proves it is a real photo and strips
    // location and device metadata. The browser's file type is not trusted.
    webp = await toAvatarWebp(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof UnsupportedImageError) {
      return formError("That file could not be read as a photo. Use a JPEG, PNG or WebP image.");
    }
    throw error;
  }

  // Stored by the service under a key made from the verified user id and a
  // random name — never from the uploaded file's name. The previous photo is
  // removed in the same step.
  const { data: saved, error } = await call("set_my_photo", { webp });
  if (error) {
    logServerError("profile.avatar.upload", error);
    return formError("The photo could not be saved. Try again in a moment.");
  }
  if (!saved) return formError("Your profile cannot be edited right now.");

  revalidatePath("/", "layout");
  return formSuccess("Photo updated.");
}

export async function removeAvatarAction() {
  const { profile } = await requireProfile();
  if (!profile.avatar_path) return;

  const { error } = await call("remove_my_photo");
  if (error) {
    logServerError("profile.avatar.remove", error);
    return;
  }

  revalidatePath("/", "layout");
}
