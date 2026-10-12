import dayjs from "../../../utils/dayjs";

/** "Termin zajęć" card: a date badge with the Term's full date and time, or
 * an empty-state message when the Circle has no Term yet. The Term's
 * description lives in the page header, not here. */
export function TermCard({ date }: { date: string }) {
  return (
    <section aria-label="Termin zajęć" className="mx-5 mt-6 flex items-center gap-3.5 rounded-3xl border border-line bg-paper p-4">
      {date ? (
        <>
          <span
            aria-hidden="true"
            className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-[18px] bg-accent-soft"
          >
            <span className="text-[11px] font-extrabold tracking-widest text-accent-fg uppercase">
              {dayjs(date).format("dd")}
            </span>
            <span className="font-serif text-[26px] leading-none font-extrabold text-ink">{dayjs(date).format("D")}</span>
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase">Termin zajęć</p>
            <p className="text-base font-bold text-ink first-letter:uppercase">
              {dayjs(date).format("dddd, D MMMM YYYY")}
            </p>
            <p className="text-sm text-ink-soft">godz. {dayjs(date).format("HH:mm")}</p>
          </div>
        </>
      ) : (
        <div>
          <p className="text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase">Termin zajęć</p>
          <p className="text-sm text-ink-soft">Organizator nie dodał jeszcze żadnych zajęć.</p>
        </div>
      )}
    </section>
  );
}
