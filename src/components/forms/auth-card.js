import { Panel } from "@/components/ui/misc";

export function AuthCard({ title, description, children, footer }) {
  return (
    <>
      <h1 className="text-3xl font-bold">{title}</h1>
      {description ? <p className="mt-2 text-ink-muted">{description}</p> : null}
      <Panel as="div" className="mt-6 shadow-panel">
        {children}
      </Panel>
      {footer ? <p className="mt-5 text-sm text-ink-muted [&_a]:font-semibold [&_a]:text-brand [&_a]:underline">{footer}</p> : null}
    </>
  );
}
