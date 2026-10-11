import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto w-full max-w-5xl px-5 py-5">
        <Logo />
      </header>
      <main id="main" className="mx-auto w-full max-w-md flex-1 px-5 pt-12">
        <h1 className="text-3xl font-bold">We could not find that page</h1>
        <p className="mt-2 text-ink-muted">The link may be old, or the address may have a typo.</p>
        <div className="mt-6">
          <ButtonLink href="/">Go to the home page</ButtonLink>
        </div>
      </main>
    </div>
  );
}
