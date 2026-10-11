import Link from "next/link";
import { cn } from "@/lib/cn";

/** Two overlapping circles: a pair. */
export function PairMark({ onDark = false, className }) {
  return (
    <svg viewBox="0 0 40 28" aria-hidden="true" className={cn("h-7 w-10 shrink-0", className)}>
      <circle cx="14" cy="14" r="12" fill={onDark ? "#ffffff" : "var(--color-brand)"} />
      <circle cx="26" cy="14" r="12" fill="var(--color-marigold)" style={{ mixBlendMode: onDark ? "normal" : "multiply" }} />
    </svg>
  );
}

export function Logo({ href = "/", className }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 rounded-full font-display text-lg font-bold text-ink", className)}>
      <PairMark />
      <span>ParvLink</span>
    </Link>
  );
}
