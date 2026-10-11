import { Logo } from "@/components/layout/logo";
import { SiteFooter } from "@/components/layout/site-footer";

export default function AuthLayout({ children }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto w-full max-w-5xl px-5 py-5">
        <Logo />
      </header>
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-16 pt-6 sm:pt-12">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
