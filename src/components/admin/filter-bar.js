import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";

const control = "block min-h-11 w-full rounded-field border border-line-strong bg-surface px-3.5 text-ink hover:border-ink-muted";

/**
 * Filters for an admin list. A plain GET form: the filters live in the URL, so
 * a filtered list can be bookmarked or shared and "back" works. Submitting
 * always returns to page 1.
 *
 * fields: [{ type: "search" | "select" | "date", name, label, value, options?, placeholder? }]
 */
export function FilterBar({ action, fields, hasFilters, label = "Filters" }) {
  return (
    <form action={action} method="get" role="search" aria-label={label} className="rounded-panel border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map((field) => {
          const id = `filter-${field.name}`;
          return (
            <div key={field.name} className={field.type === "search" ? "sm:col-span-2 lg:col-span-1" : undefined}>
              <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
                {field.label}
              </label>
              {field.type === "select" ? (
                <select id={id} name={field.name} defaultValue={field.value} className={`${control} pr-9`}>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={id}
                  name={field.name}
                  type={field.type === "date" ? "date" : "search"}
                  defaultValue={field.value}
                  maxLength={field.type === "search" ? 80 : undefined}
                  placeholder={field.placeholder}
                  className={control}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="submit" className={buttonClasses({ variant: "secondary", size: "sm" })}>
          Apply
        </button>
        {hasFilters ? (
          <Link href={action} className={buttonClasses({ variant: "ghost", size: "sm" })}>
            Clear
          </Link>
        ) : null}
      </div>
    </form>
  );
}
