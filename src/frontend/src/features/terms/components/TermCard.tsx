import { Link } from "../../../routing/navigation";
import { ABOUT_POINTS_PATH } from "../../../routing/paths";
import { formatPrice } from "../../../utils/appHelpers";
import dayjs from "../../../utils/dayjs";

const EYEBROW = "text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase";

interface TermCardProps {
  date: string;
  capacity: number | null;
  attendeeCount?: number;
  /** Points for attendance; the badge shows only above 0. */
  attendancePoints?: number;
  /** Decimal string (`"25.50"`); `null` for a free term, which shows no badge. */
  price?: string | null;
  /** Online payment link; without one a priced term is paid on site. */
  paymentUrl?: string | null;
}

/** "Termin zajęć" card: a date badge with the Term's full date and time and a
 * notice once no places remain, or an empty-state message when the Circle has
 * no Term yet. Capacity is informational only: signing up is never blocked. */
export function TermCard({
  date,
  capacity,
  attendeeCount,
  attendancePoints = 0,
  price = null,
  paymentUrl = null,
}: TermCardProps) {
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
              <span className="font-serif text-[26px] leading-none font-extrabold text-ink">
                {dayjs(date).format("D")}
              </span>
            </span>
            <div className="min-w-0">
              <p className={EYEBROW}>Termin zajęć</p>
              <p className="text-base font-bold text-ink first-letter:uppercase">
                {dayjs(date).format("dddd, D MMMM YYYY")}
              </p>
              <p className="text-sm text-ink-soft">godz. {dayjs(date).format("HH:mm")}</p>
            </div>
          </div>
          {(price != null || attendancePoints > 0) && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {price != null && (
                <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[12.5px] font-extrabold text-primary-fg">
                  {formatPrice(price)}
                </span>
              )}
              {price != null && paymentUrl == null && (
                <>
                  {" "}
                  <span className="text-[13px] text-ink-soft">płatność na miejscu</span>
                </>
              )}
              {attendancePoints > 0 && (
                <>
                  {" "}
                  <span className="rounded-full bg-lime-soft px-2.5 py-1 text-[12.5px] font-extrabold text-accent-fg">
                    +{attendancePoints} pkt za obecność
                  </span>{" "}
                  <Link
                    to={ABOUT_POINTS_PATH}
                    className="rounded-sm font-bold text-primary-fg underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
                  >
                    Co to są punkty?
                  </Link>
                </>
              )}
            </p>
          )}
          {price != null && paymentUrl != null && (
            <p className="mt-2 text-[13px] text-ink-soft">Płatność online po zapisaniu się.</p>
          )}
          {capacity != null && attendeeCount != null && attendeeCount >= capacity && (
            <p role="status" className="mt-3 rounded-2xl bg-accent-soft px-3 py-2 text-sm font-bold text-accent-fg">
              <span aria-hidden="true">ⓘ </span>Brak wolnych miejsc
            </p>
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
