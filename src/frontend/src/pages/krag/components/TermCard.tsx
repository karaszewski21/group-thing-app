/** "Termin zajęć" card — the public view's next-Term summary (date, wall-
 * clock time, optional description), or an empty-state message when the
 * Circle has no Term yet. Pure presentational: `date`/`time` are already
 * formatted by the caller (`formatTermWhen`). */
export function TermCard({
  date,
  time,
  description,
}: {
  date: string | null;
  time?: string;
  description?: string | null;
}) {
  return (
    <div className="kg-term">
      <div className="kg-term-eyebrow">Termin zajęć</div>
      {date ? (
        <>
          <div className="kg-term-date">{date}</div>
          {time && <div className="kg-term-time">🕒 godz. {time}</div>}
          {description && <p className="kg-term-desc">{description}</p>}
        </>
      ) : (
        <p className="kg-term-empty">Organizator nie dodał jeszcze żadnych zajęć.</p>
      )}
    </div>
  );
}
