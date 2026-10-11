import { Suspense } from "react";
import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Skeleton } from "@/components/ui/misc";
import { ROUTES } from "@/lib/auth/routes";

export const metadata = { title: "Link problem" };

// Fixed messages keyed by a short reason code. The code is looked up in this
// table; the query string itself is never rendered.
const REASONS = {
  expired: {
    title: "That link has expired",
    body: "Confirmation links only work for a limited time. Ask for a new one and open it straight away.",
    primary: { href: ROUTES.verifyEmail, label: "Send a new link" },
  },
  unavailable: {
    title: "We could not check that link",
    body: "The sign-in service did not respond. Wait a moment and open the link from your email again.",
    primary: { href: ROUTES.login, label: "Go to log in" },
  },
  invalid: {
    title: "That link did not work",
    body: "It may have been used already, or copied incompletely. If you have confirmed your email before, log in. Otherwise ask for a new link.",
    primary: { href: ROUTES.login, label: "Log in" },
  },
};

export default function AuthErrorPage({ searchParams }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto w-full max-w-5xl px-5 py-5">
        <Logo />
      </header>
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-5 pb-16 pt-6 sm:pt-12">
        <Suspense fallback={<Skeleton className="h-48" />}>
          <Reason searchParams={searchParams} />
        </Suspense>
      </main>
    </div>
  );
}

async function Reason({ searchParams }) {
  const { reason } = await searchParams;
  const content = Object.hasOwn(REASONS, reason) ? REASONS[reason] : REASONS.invalid;
  return (
    <>
      <h1 className="text-3xl font-bold">{content.title}</h1>
      <Panel as="div" className="mt-6 space-y-5 shadow-panel">
        <p>{content.body}</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={content.primary.href}>{content.primary.label}</ButtonLink>
          {content.primary.href !== ROUTES.verifyEmail ? (
            <ButtonLink href={ROUTES.verifyEmail} variant="secondary">
              Send a new link
            </ButtonLink>
          ) : null}
        </div>
      </Panel>
    </>
  );
}
