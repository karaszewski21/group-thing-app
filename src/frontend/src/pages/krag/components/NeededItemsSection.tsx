import type { NeededItemRowVM } from "./termSectionTypes";

function NeededItemRow({ row }: { row: NeededItemRowVM }) {
  return (
    <div className="kg-bring-item">
      <div className="kg-bring-row">
        <div className="kg-bring-body">
          {row.title}
        </div>
        {row.subtitle != null && <small>{row.subtitle}</small>}
        { row.inlineActions.map((a) => (
          <button
            key={a.key}
            className="kg-bring-btn"
            disabled={a.disabled}
            aria-label={a.ariaLabel}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </div>
      {row.extra}
    </div>
  );
}

/** "Potrzebne rzeczy" card — the Term's needed items and who brings each;
 * row data and click handlers come entirely from the caller. */
export function NeededItemsSection({
  rows,
}: {
  rows: NeededItemRowVM[];
}) {
  return (
    <section className="kg-bring" aria-label="Potrzebne rzeczy">
      <p className="kg-bring-sub">Zgłoś się, jeśli możesz coś przynieść na te zajęcia.</p>
      <div className="kg-bring-list">
        {rows.map((row) => (
          <NeededItemRow key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}
