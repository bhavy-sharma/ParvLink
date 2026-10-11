"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

// Shown when a page throws. The underlying error is deliberately not displayed:
// in production Next.js replaces server error details with a digest, and we do
// not want internals on screen either way.
export default function ErrorPage({ error, retry }) {
  useEffect(() => {
    console.error("Page error", error?.digest ?? "");
  }, [error]);

  return (
    <main id="main" className="mx-auto w-full max-w-md flex-1 px-5 pt-16">
      <h1 className="text-3xl font-bold">This page did not load</h1>
      <p className="mt-2 text-ink-muted">
        Something failed on our side. Try again; if it keeps happening, come back in a few minutes.
      </p>
      {error?.digest ? <p className="mt-2 text-sm text-ink-muted">Reference: {error.digest}</p> : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <ButtonLink href="/" variant="secondary">
          Go to the home page
        </ButtonLink>
      </div>
    </main>
  );
}
