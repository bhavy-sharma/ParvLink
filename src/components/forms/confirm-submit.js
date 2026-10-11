"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

/**
 * Two-step submit for actions that take something away. The first press asks,
 * the second one submits the surrounding <form>.
 */
export function ConfirmSubmit({ children, confirmLabel, pendingLabel = "Working…", variant = "danger", confirmVariant = "dangerSolid", size = "sm" }) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();

  if (!armed) {
    return (
      <Button variant={variant} size={size} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button type="submit" variant={confirmVariant} size={size} disabled={pending}>
        {pending ? pendingLabel : confirmLabel}
      </Button>
      <Button variant="ghost" size={size} disabled={pending} onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}
