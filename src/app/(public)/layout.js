import { Logo } from "@/components/layout/logo";
import { SiteFooter } from "@/components/layout/site-footer";
import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";

// Pages anyone can read without an account: the privacy notice, the terms and
// the page shown after an account is deleted. Nothing here reads the session.
export default function PublicLayout({ children }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-5">
        <Logo />
        <ButtonLink href={ROUTES.login} variant="ghost" size="sm">
          Log in
        </ButtonLink>
      </header>
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
