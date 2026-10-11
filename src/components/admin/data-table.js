import { cn } from "@/lib/cn";

/**
 * A table that stays usable on a phone: it scrolls sideways inside its own
 * frame instead of stretching the page.
 * columns: [{ key, header, align?: "right", className? }]   rows: [{ key, cells: { [key]: node } }]
 */
export function DataTable({ caption, columns, rows }) {
  return (
    <div className="overflow-x-auto rounded-panel border border-line bg-surface" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-paper/70 text-left">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn("whitespace-nowrap px-4 py-2.5 font-semibold", column.align === "right" && "text-right")}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.key}>
              {columns.map((column, index) => {
                const Cell = index === 0 ? "th" : "td";
                return (
                  <Cell
                    key={column.key}
                    scope={index === 0 ? "row" : undefined}
                    className={cn("px-4 py-2.5 align-top font-normal", column.align === "right" && "text-right tabular-nums", column.className)}
                  >
                    {row.cells[column.key]}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
