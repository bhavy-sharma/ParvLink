import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";

export default function ConversationNotFound() {
  return (
    <div className="mx-auto max-w-md pt-6">
      <h1 className="text-3xl font-bold">We could not find that conversation</h1>
      <p className="mt-2 text-ink-muted">The link may be wrong, or this conversation is not one of yours. Your conversations are listed with your matches.</p>
      <div className="mt-6">
        <ButtonLink href={ROUTES.matches}>Go to my matches</ButtonLink>
      </div>
    </div>
  );
}
