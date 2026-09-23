/** "Termin zajęć" card — the Term's date and wall-clock time, or an
 * empty-state message when the Circle has no Term yet. `date`/`time` are
 * already formatted by the caller. The Term's description lives in the
 * page header, not here. */
export function TermCard({ date, time }: { date: string | null; time?: string }) {
  return (
    <div className="kg-term">
      <div className="kg-term-eyebrow">Termin zajęć</div>
      {date ? (
        <>
          <div className="kg-term-date">{date}</div>
          {time && <div className="kg-term-time">🕒 godz. {time}</div>}
        </>
      ) : (
        <p className="kg-term-empty">Organizator nie dodał jeszcze żadnych zajęć.</p>
      )}
    </div>
  );
}
