// Serves a partner's profile photo without revealing whose it is.
//
// Photos are stored under a key that contains the owner's user id, so that key
// never reaches a browser. Instead the browser asks for a photo by event +
// event-specific handle, and this route:
//   1. requires a signed-in user;
//   2. asks the service whether THIS user may see THAT person in THIS event
//      (it returns nothing otherwise) and gets the bytes back in the same call.

import { getCurrentUser } from "@/lib/auth/session";
import { getStudentEvent } from "@/lib/data/student-events";
import { call } from "@/lib/services";
import { partnerHandleSchema } from "@/lib/validation/schemas";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const parsed = partnerHandleSchema.safeParse(await params);
  if (!parsed.success) return notFound();

  const event = await getStudentEvent(parsed.data.slug).catch(() => null);
  if (!event) return notFound();

  const { data: photo, error } = await call("partner_photo", { p_event_id: event.id, p_handle: parsed.data.handle });
  if (error || !photo) return notFound();

  return new Response(photo.data, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      // Only this browser may keep it, and only briefly: access can be withdrawn.
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
