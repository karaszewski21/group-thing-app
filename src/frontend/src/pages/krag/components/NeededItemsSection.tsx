import type { NeededItemRowVM } from "./termSectionTypes";

function NeededItemRow({ row }: { row: NeededItemRowVM }) {
  return (
    <div className="kg-bring-item">
      <div className="kg-bring-row">
        <div className="kg-bring-body">
          {row.title}
          {row.subtitle != null && <small>{row.subtitle}</small>}
        </div>
        {row.inlineActions.map((a) => (
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
  heading,
  subtitle,
  rows,
}: {
  heading: string;
  subtitle?: string;
  rows: NeededItemRowVM[];
}) {
  return (
    <section className="kg-bring" aria-labelledby="needed-items-heading">
      <h2 id="needed-items-heading">{heading}</h2>
      {subtitle && <p className="kg-bring-sub">{subtitle}</p>}
      <div className="kg-bring-list">
        {rows.map((row) => (
          <NeededItemRow key={row.key} row={row} />
        ))}
      </div>
    </section>
  );
}
