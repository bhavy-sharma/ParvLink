// The signed-in student's OWN profile photo. Takes no user id: it serves the
// photo of whoever the session belongs to, and nothing else.

import { getCurrentUser } from "@/lib/auth/session";
import { call } from "@/lib/services";

const empty = (status) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return empty(401);
  const { data: photo, error } = await call("my_photo");
  if (error || !photo) return empty(404);
  return new Response(photo.data, {
    status: 200,
    headers: {
      "Content-Type": "image/webp",
      // The address changes whenever the photo does (see getAvatarUrl), so this copy can be kept for a while.
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
