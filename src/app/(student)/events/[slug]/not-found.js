import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";

export default function EventNotFound() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">We could not find that event</h1>
      <p className="mt-2 text-ink-muted">
        It may have been removed, the link may be wrong, or the event may not be open to your college.
      </p>
      <div className="mt-6">
        <ButtonLink href={ROUTES.events}>See all events</ButtonLink>
      </div>
    </div>
  );
}
