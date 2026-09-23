import type { ListingRowVM, TermSectionVM } from "./termSectionTypes";

/** One "twoje wystawione rzeczy" / "rzeczy od innych" / "rzeczy do wymiany"
 * row — shared by both `PrivateTermView` and `PublicTermView`. */
function ListingRow({ row }: { row: ListingRowVM }) {
  return (
    <div className="kg-bring-item">
      <div className="kg-bring-row">
        <div className="kg-bring-body">
          {row.title}
          {row.subtitle != null && <small>{row.subtitle}</small>}
        </div>
      </div>
      {row.actions.length > 0 && (
        <div className="kg-fulfill-row" style={{ flexWrap: "wrap" }}>
          {row.actions.map((a) => (
            <button
              key={a.key}
              type="button"
              className="kg-bring-btn"
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
      {row.statusLine && <div className="kg-status-line">{row.statusLine}</div>}
      {row.confirmAction && (
        <div className="kg-fulfill-actions" style={{ marginTop: "8px" }}>
          <button className="kg-btn-primary" disabled={row.confirmAction.disabled} onClick={row.confirmAction.onClick}>
            {row.confirmAction.label}
          </button>
        </div>
      )}
    </div>
  );
}

/** One listings card (heading + rows) — used for "Twoje wystawione rzeczy",
 * "Rzeczy od innych", and the public "Rzeczy do wymiany", all structurally
 * identical; only the row data/handlers differ per caller. */
export function ListingsSection({ section }: { section: TermSectionVM<ListingRowVM> }) {
  return (
    <>
      <h2 style={section.headingStyle}>{section.heading}</h2>
      {section.subtitleText && <p className="kg-bring-sub">{section.subtitleText}</p>}
      <div className="kg-bring-list">
        {section.rows.length === 0 && section.emptyNode}
        {section.rows.map((row) => (
          <ListingRow key={row.key} row={row} />
        ))}
      </div>
    </>
  );
}
