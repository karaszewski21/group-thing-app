import type { NeededItemRowVM } from "./termSectionTypes";

/** The item name keeps the full width; who brings it, or the pledge button,
 * sits underneath so long names and long family names never squeeze. */
function NeededItemRow({ row }: { row: NeededItemRowVM }) {
  const hasFooter = row.subtitle != null || row.inlineActions.length > 0;
  return (
    <div className="py-3.5">
      <div className="text-base leading-snug wrap-break-word">{row.title}</div>
      {hasFooter && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {row.subtitle != null && (
            <small className="max-w-full rounded-full bg-teal-soft px-3 py-1.5 text-[13px] font-extrabold wrap-break-word text-ink">
              {row.subtitle}
            </small>
          )}
          {row.inlineActions.map((a) => (
            <button
              key={a.key}
              type="button"
              className="ml-auto min-h-10 rounded-full border-2 border-accent bg-accent-soft px-3.5 text-sm font-extrabold whitespace-nowrap text-accent-fg disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              disabled={a.disabled}
              aria-label={a.ariaLabel}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      {row.extra}
    </div>
  );
}

/** "Potrzebne rzeczy" card — the Term's needed items and who brings each;
 * row data and click handlers come entirely from the caller. With no items
 * it says so instead of disappearing. */
export function NeededItemsSection({ rows }: { rows: NeededItemRowVM[] }) {
  return (
    <section className="mx-5 mt-6" aria-label="Potrzebne rzeczy">
      <h2 className="font-serif text-[22px] font-bold text-ink">Potrzebne rzeczy</h2>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-[20px] border-2 border-dashed border-line-strong px-4 py-3.5 text-[15px] leading-snug text-ink-soft">Organizator nie prosi o przyniesienie niczego.</p>
      ) : (
        <>
          <p className="mt-1 text-[15px] text-ink-soft">Zgłoś się, jeśli możesz coś przynieść na te zajęcia.</p>
          <div className="mt-3 divide-y divide-line rounded-3xl border border-line bg-paper px-4">
            {rows.map((row) => (
              <NeededItemRow key={row.key} row={row} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
