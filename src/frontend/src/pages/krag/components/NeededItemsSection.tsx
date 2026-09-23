import type { NeededItemRowVM, TermSectionVM } from "./termSectionTypes";

/** One "kto co przynosi" / "potrzebne rzeczy" row — shared by both
 * `PrivateTermView` and `PublicTermView`, whose callers build the
 * `NeededItemRowVM`s from their own hook's data and their own
 * `gateAction`-wrapped handlers. */
function NeededItemRow({ row }: { row: NeededItemRowVM }) {
  return (
    <div className="kg-bring-item">
      <div className="kg-bring-row">
        {row.avatar !== undefined && (
          <span
            className={`kg-bring-av ${row.avatar ? "" : "kg-bring-av-empty"}`}
            style={row.avatar ? { background: row.avatar.color } : undefined}
          >
            {row.avatar ? row.avatar.initials : "?"}
          </span>
        )}
        <div className="kg-bring-body">
          {row.title}
          {row.subtitle != null && <small>{row.subtitle}</small>}
        </div>
        {row.inlineActions.map((a) => (
          <button
            key={a.key}
            className={`kg-bring-btn ${a.active ? "is-on" : ""}`}
            disabled={a.disabled}
            aria-label={a.ariaLabel}
            onClick={a.onClick}
          >
            {a.label}
          </button>
        ))}
      </div>
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

/** "Kto co przynosi" (private) / "Potrzebne rzeczy" (public) card —
 * structurally identical between the two views; only the row data and
 * click handlers differ, supplied entirely via `section`. */
export function NeededItemsSection({ section }: { section: TermSectionVM<NeededItemRowVM> }) {
  return (
    <div className="kg-bring">
      <h2>{section.heading}</h2>
      {section.subtitleText && <p className="kg-bring-sub">{section.subtitleText}</p>}
      <div className="kg-bring-list">
        {section.rows.length === 0 && section.emptyNode}
        {section.rows.map((row) => (
          <NeededItemRow key={row.key} row={row} />
        ))}
      </div>
    </div>
  );
}
