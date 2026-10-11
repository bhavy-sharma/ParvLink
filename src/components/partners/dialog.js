"use client";

import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";

/**
 * A button that opens a modal dialog. Built on the native <dialog>, which
 * gives focus trapping, Esc-to-close and a backdrop without extra script.
 *
 * Anything inside can close it with `onClick={closeDialog}` (or `onSubmit`).
 */
/** Closes the dialog that contains the element the event came from. */
export function closeDialog(event) {
  event.currentTarget.closest("dialog")?.close();
}

export function Dialog({ label, title, variant = "secondary", size = "sm", triggerClassName, children }) {
  const ref = useRef(null);
  const titleId = useId();

  return (
    <>
      <Button variant={variant} size={size} className={triggerClassName} onClick={() => ref.current?.showModal()}>
        {label}
      </Button>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-panel border border-line bg-surface p-0 text-ink shadow-panel backdrop:bg-ink/55"
      >
        <div className="p-5 sm:p-6">
          <h2 id={titleId} className="text-xl font-semibold">
            {title}
          </h2>
          <div className="mt-3">{children}</div>
        </div>
      </dialog>
    </>
  );
}
