import type { PublicLocationResponse } from "../../../api/locations";
import { buildMapsUrl } from "../../../lib/googleMaps";
import dayjs from "../../../utils/dayjs";

const EYEBROW = "text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase";

interface TermCardProps {
  date: string;
  location: PublicLocationResponse | null;
  capacity: number | null;
  attendeeCount?: number;
}

/** "Termin zajęć" card: a date badge with the Term's full date and time, its
 * place and how many places are taken, or an empty-state message when the
 * Circle has no Term yet. The Term's description lives in the page header,
 * not here. Capacity is informational only: signing up is never blocked. */
export function TermCard({ date, location, capacity, attendeeCount }: TermCardProps) {
  return (
    <section aria-label="Termin zajęć" className="mx-5 mt-6 rounded-3xl border border-line bg-paper p-4">
      {date ? (
        <>
          <div className="flex items-center gap-3.5">
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
              <p className={EYEBROW}>Termin zajęć</p>
              <p className="text-base font-bold text-ink first-letter:uppercase">
                {dayjs(date).format("dddd, D MMMM YYYY")}
              </p>
              <p className="text-sm text-ink-soft">godz. {dayjs(date).format("HH:mm")}</p>
            </div>
          </div>
          {location && (
            <div className="mt-3 border-t border-line pt-3">
              <p className={EYEBROW}>Miejsce</p>
              <p className="font-bold text-ink">{location.name}</p>
              <p className="text-sm text-ink-soft">{location.formatted_address}</p>
              {location.notes && <p className="text-sm text-ink-soft">{location.notes}</p>}
              <a
                href={buildMapsUrl(location)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-sm font-bold text-ink underline"
              >
                Otwórz w Google Maps<span aria-hidden="true"> ↗</span>{" "}
                <span className="sr-only">(nowa karta)</span>
              </a>
            </div>
          )}
          {capacity != null && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-sm text-ink">
                Zapisanych {attendeeCount ?? 0} z {capacity}
              </p>
              {attendeeCount != null && attendeeCount >= capacity && (
                <p role="status" className="mt-2 rounded-2xl bg-accent-soft px-3 py-2 text-sm font-bold text-accent-fg">
                  <span aria-hidden="true">ⓘ </span>Brak wolnych miejsc
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div>
          <p className={EYEBROW}>Termin zajęć</p>
          <p className="text-sm text-ink-soft">Organizator nie dodał jeszcze żadnych zajęć.</p>
        </div>
      )}
    </section>
  );
}
