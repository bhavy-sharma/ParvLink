import { buttonClasses } from "@/components/ui/button";
import Link from "next/link";

const control = "block min-h-11 w-full rounded-field border border-line-strong bg-surface px-3.5 text-ink hover:border-ink-muted";

/**
 * Search + filter bar. A plain GET form: the filters live in the URL, so
 * results can be bookmarked and the back button works, with no client script.
 *
 * `selects`: [{ name, label, value, options: [{ value, label }] }]
 */
export function EventFilters({ action, query, searchLabel, selects, hasFilters }) {
  return (
    <form action={action} method="get" role="search" className="rounded-panel border border-line bg-surface p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(9.5rem,1fr))_auto] lg:items-end">
        <div>
          <label htmlFor="filter-q" className="mb-1.5 block text-sm font-semibold">
            {searchLabel}
          </label>
          <input id="filter-q" name="q" type="search" defaultValue={query} maxLength={80} className={control} />
        </div>
        {selects.map((select) => (
          <div key={select.name}>
            <label htmlFor={`filter-${select.name}`} className="mb-1.5 block text-sm font-semibold">
              {select.label}
            </label>
            <select id={`filter-${select.name}`} name={select.name} defaultValue={select.value} className={`${control} pr-9`}>
              {select.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className={buttonClasses({ variant: "secondary" })}>
            Apply
          </button>
          {hasFilters ? (
            <Link href={action} className={buttonClasses({ variant: "ghost" })}>
              Clear
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
}

/** Reads one filter from searchParams, accepting only known values. */
export function pickFilter(value, allowed, fallback = "") {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

export function pickQuery(value) {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}
