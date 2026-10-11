import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { SiteFooter } from "@/components/layout/site-footer";
import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";
import { MIN_AGE } from "@/lib/validation/limits";

// Everything on this page describes what the application does today. There is
// no sample content: no invented students, notices, numbers or testimonials.
const STEPS = [
  { title: "Join an event", body: "Your college’s admins list the events you can enter, including ones hosted by other colleges that invited yours." },
  { title: "See who else needs a partner", body: "Say who you are looking for. You see the students who joined the same event and are looking too." },
  { title: "Match when it is mutual", body: "Send interest. Nothing happens unless the other person is interested as well; then you are matched." },
  { title: "Talk it through", body: "Matched students get a private conversation inside the app to plan their entry." },
];

const POINTS = [
  { title: "A small, plain profile", body: "First name, course, year, a short bio and a photo (needed before you join an event). Your email address and date of birth are never shown to other students." },
  { title: "You stay in control", body: "Block or report anyone. Step out of an event’s partner search whenever you like. Delete your account yourself, at any time." },
  { title: `For students ${MIN_AGE} and over`, body: "You confirm your email address and your age before your profile goes live. Admins of your college moderate reports." },
];

export default function LandingPage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5">
        <Logo />
        <ButtonLink href={ROUTES.login} variant="ghost" size="sm">
          Log in
        </ButtonLink>
      </header>

      <main id="main" className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 pb-16 pt-8 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-16">
          <div>
            <h1 className="text-5xl font-extrabold sm:text-6xl lg:text-7xl">Don’t sit the event out for want of a partner.</h1>
            <p className="mt-6 max-w-xl text-lg text-ink-muted">
              Hackathons, duets, quizzes, debates: most college events need two or more. ParvLink is where students find each other in time to enter.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={ROUTES.register} size="lg">
                Create an account
              </ButtonLink>
              <ButtonLink href={ROUTES.login} variant="secondary" size="lg">
                Log in
              </ButtonLink>
            </div>
            <p className="mt-4 text-sm text-ink-muted">Free for students. In beta: your college has to be listed before you can create a profile.</p>

            {/* 🌟 PREMIUM CREATOR CREDITS (UPPER SECTION, BIG & CLEAN) 🌟 */}
            <div className="mt-12 border-t border-line pt-8">
              <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:gap-12">
                <div className="flex flex-col">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-ink-muted">Design</span>
                  <span className="text-3xl font-black text-ink sm:text-4xl lg:text-5xl">
                    Gaurav Pratap Singh
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-ink-muted">Build</span>
                  <span className="text-3xl font-black text-ink sm:text-4xl lg:text-5xl">
                    Bhavy Sharma
                  </span>
                </div>
              </div>
            </div>
            {/* ----------------------------------------------------------- */}

          </div>

          <div className="mx-auto w-full max-w-md rounded-panel bg-ink p-5 text-white sm:p-7">
            <h2 className="font-display text-xl font-bold text-white">How it works</h2>
            <ol className="mt-5 space-y-5">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-marigold font-display text-lg font-bold text-ink">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-display text-lg font-bold leading-tight text-white">{step.title}</h3>
                    <p className="mt-1 text-sm text-white/75">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="care-heading" className="border-t border-line bg-surface">
          <div className="mx-auto w-full max-w-6xl px-5 py-14">
            <h2 id="care-heading" className="max-w-xl text-3xl font-bold">
              Built for students, with limits on purpose
            </h2>
            <ul className="mt-8 grid gap-8 md:grid-cols-3">
              {POINTS.map((point) => (
                <li key={point.title}>
                  <h3 className="text-xl font-semibold">{point.title}</h3>
                  <p className="mt-2 text-ink-muted">{point.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-10 max-w-2xl rounded-field bg-marigold-soft px-4 py-3 text-sm text-marigold-ink [&_a]:font-semibold [&_a]:underline">
              Profiles are not identity-checked, and conversations are private but not end-to-end encrypted. The <Link href={ROUTES.privacy}>Privacy notice</Link> says exactly
              what is stored and who can see it; the <Link href={ROUTES.terms}>Terms of use</Link> say what is expected of you.
            </p>
          </div>
        </section>
      </main>

      <SiteFooter className="max-w-6xl" />
    </div>
  );
}