import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/dates";
import { siteDetails } from "@/lib/site";
import { LEGAL_VERSION } from "@/lib/validation/limits";

/** A marked gap the operator has to fill in. Never replaced with invented details. */
export function Placeholder({ children }) {
  return (
    <mark data-placeholder className="rounded bg-marigold-soft px-1 font-semibold text-marigold-ink">
      [{children}]
    </mark>
  );
}

export function LegalSection({ id, title, children }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="pt-4 text-2xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Frame shared by the privacy notice and the terms. */
export function LegalPage({ title, intro, children }) {
  const details = siteDetails();
  return (
    <article className="space-y-4 leading-relaxed [&_a]:font-semibold [&_a]:text-brand [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
      <header>
        <h1 className="text-4xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Version {LEGAL_VERSION} ({formatDate(LEGAL_VERSION)})
        </p>
      </header>
      {!details.complete ? (
        <Alert tone="warning" title="Draft — not yet completed by the operator" data-legal-draft>
          This page accurately describes what the software does with your data, but the parts that only the organisation running it can supply are still
          marked <Placeholder>like this</Placeholder>, and the text has not been confirmed as legally reviewed. It must be completed before the service is
          opened to students.
        </Alert>
      ) : null}
      <p className="text-lg text-ink-muted">{intro}</p>
      {children}
    </article>
  );
}

/** The operator's name, or the marked placeholder. */
export function OperatorName() {
  const details = siteDetails();
  return details.operatorName ? <strong>{details.operatorName}</strong> : <Placeholder>OPERATOR NAME — NOT YET CONFIGURED</Placeholder>;
}

/** The support address as a mail link, or the marked placeholder. */
export function SupportEmail() {
  const details = siteDetails();
  return details.supportEmail ? <a href={`mailto:${details.supportEmail}`}>{details.supportEmail}</a> : <Placeholder>SUPPORT EMAIL — NOT YET CONFIGURED</Placeholder>;
}
