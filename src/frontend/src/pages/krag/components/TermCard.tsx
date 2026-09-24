import dayjs from "../../../utils/dayjs";
/** "Termin zajęć" card — the Term's date and wall-clock time, or an
 * empty-state message when the Circle has no Term yet. `date`/`time` are
 * already formatted by the caller. The Term's description lives in the
 * page header, not here. */
export function TermCard({ date }: { date: string }) {
  return (
    <div className="kg-term">
      <div className="kg-term-eyebrow">Termin zajęć</div>
      {date ? (
        <div className="flex justify-between items-center">
          <div className="kg-term-date">{dayjs(date).format('DD MMMM YYYY')}</div>
          <div className="kg-term-time">🕒 godz. {dayjs(date).format('HH:mm')}</div>
        </div>
      ) : (
        <p className="kg-term-empty">Organizator nie dodał jeszcze żadnych zajęć.</p>
      )}
    </div>
  );
}
