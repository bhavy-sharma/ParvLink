"use client";

import { useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

const subscribe = () => () => {};
/** False in server-rendered HTML, true once this component is interactive. */
function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Submit button that disables itself and changes its label while the form is
 * being sent.
 *
 * It also stays disabled until the page's scripts have loaded. Signed-in pages
 * stream their content and need those scripts to draw the result of a
 * submission; a click that got in earlier would be answered with a blank page
 * until they arrived.
 */
export function SubmitButton({ children, pendingLabel = "Saving…", disabled = false, ...props }) {
  const { pending } = useFormStatus();
  const hydrated = useHydrated();
  return (
    <Button
      type="submit"
      {...props}
      disabled={!hydrated || pending || disabled}
      aria-busy={pending || undefined}
      // Look normal (not greyed out) for the instant before scripts load.
      data-hydrating={hydrated ? undefined : ""}
      className={cn("disabled:data-[hydrating]:cursor-progress disabled:data-[hydrating]:opacity-100", props.className)}
    >
      {pending ? pendingLabel : children}
    </Button>
  );
}
