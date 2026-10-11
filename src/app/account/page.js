import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/auth/routes";

// There is no account overview screen; the two account pages are linked from the footer.
export default function AccountIndex() {
  redirect(ROUTES.profile);
}
