import { cn } from "@/lib/cn";

const tones = {
  error: "border-danger/30 bg-danger-soft text-danger",
  success: "border-ok/30 bg-ok-soft text-ok",
  info: "border-brand/20 bg-brand-soft text-brand-strong",
  warning: "border-marigold/60 bg-marigold-soft text-marigold-ink",
};

export function Alert({ tone = "info", title, children, className, ...props }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-field border px-4 py-3 text-sm", tones[tone], className)}
      {...props}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={cn(title && "mt-0.5", "[&_a]:font-semibold [&_a]:underline")}>{children}</div>
    </div>
  );
}
