import { cn } from "@/lib/cn";

const sizes = {
  sm: "size-9 text-sm",
  md: "size-14 text-xl",
  lg: "size-28 text-4xl",
};

/**
 * Profile photo, or the person's initial when there is none.
 *
 * `src` is a short-lived signed URL from the private avatars bucket. A plain
 * <img> is used on purpose: next/image would copy the private photo into the
 * shared image-optimizer cache.
 */
export function Avatar({ src, name, size = "md", className }) {
  const initial = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-marigold font-display font-bold text-ink",
        sizes[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- see component comment
        <img src={src} alt="" width={112} height={112} className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}
