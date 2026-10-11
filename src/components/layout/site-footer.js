import Link from "next/link";
import { cn } from "@/lib/cn";
import { ROUTES } from "@/lib/auth/routes";

/** Links every screen ends with. `signedIn` adds the ones that need an account. */
export function SiteFooter({ signedIn = false, className }) {
  return (
    <footer className={cn("mx-auto w-full max-w-5xl px-5 py-6 text-sm text-ink-muted", className)}>
      <nav aria-label="About this site" className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span>ParvLink</span>
        <Link href={ROUTES.privacy} className="underline hover:text-ink">
          Privacy
        </Link>
        <Link href={ROUTES.terms} className="underline hover:text-ink">
          Terms
        </Link>
        {signedIn ? (
          <>
            <Link href={ROUTES.feedback} className="underline hover:text-ink">
              Send feedback
            </Link>
            <Link href={ROUTES.deleteAccount} className="underline hover:text-ink">
              Delete account
            </Link>
          </>
        ) : null}
      </nav>
    </footer>
  );
}
