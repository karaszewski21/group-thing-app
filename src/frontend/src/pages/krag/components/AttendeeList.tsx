import { Avatar } from "../../../components/shared/Avatar";
import { attendeeElementId, type ListingRowVM } from "./termSectionTypes";

export interface AttendeeVM {
  partyId: number;
  name: string;
  /** Items this person offers to lend / swap / give away on this Term. */
  listings: ListingRowVM[];
}

function ListingRow({ row }: { row: ListingRowVM }) {
  return (
    <div className="kg-bring-item flex">
      <div className="kg-bring-body">
        {row.title}
        {row.subtitle != null && <small>{row.subtitle}</small>}
      </div>
      {row.actions.length > 0 && (
        <div className="kg-fulfill-row" style={{ flexWrap: "wrap", marginTop: 8 }}>
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
    </div>
  );
}

/** "Zapisani na zajęcia" — one entry per attendee with the items they offer
 * (and the take/swap buttons for each). `activePartyId` highlights the entry
 * picked from the visualization. */
export function AttendeeList({
  attendees,
  activePartyId,
}: {
  attendees: AttendeeVM[];
  activePartyId: number | null;
}) {
  return (
    <section className="kg-bring" aria-labelledby="attendees-heading">
      <p className="kg-bring-sub">Rzeczy, które uczestnicy oferują do pożyczenia, zamiany lub oddania.</p>
      <ul className="kg-bring-list" style={{ listStyle: "none", padding: 0 }}>
        {attendees.length === 0 && <li className="kg-bring-empty">Nikt jeszcze się nie zapisał.</li>}
        {attendees.map((attendee) => (
          <li
            key={attendee.partyId}
            id={attendeeElementId(attendee.partyId)}
            tabIndex={-1}
            className={`kg-attendee ${attendee.partyId === activePartyId ? "is-on" : ""}`}
          >
            <div className="kg-attendee-head ">
              <Avatar name={attendee.name} showsSharesIcon={attendee.listings.length > 0} />
              <strong>{attendee.name}</strong>
            </div>
            {attendee.listings.length > 0 && (
              <div className="kg-attendee-items">
                {attendee.listings.map((row) => (
                  <ListingRow key={row.key} row={row} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
