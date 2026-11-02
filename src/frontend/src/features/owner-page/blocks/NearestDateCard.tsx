import type { ReactNode } from "react";
import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The TermPreviewCard date tile: day number over the short month, or with
 * `weekday` the short month, day number and short weekday. */
export function DateTile({
  occursOn,
  className = "bg-primary-soft text-ink",
  weekday = false,
}: {
  occursOn: string;
  className?: string;
  weekday?: boolean;
}) {
  const date = dayjs(occursOn);
  if (weekday) {
    return (
      <div
        aria-hidden="true"
        className={`flex w-14 shrink-0 flex-col items-center justify-center rounded-2xl py-1.5 ${className}`}
      >
        <span className="text-[11px] font-bold uppercase">{date.format("MMM")}</span>
        <span className="text-[22px] font-extrabold leading-none">{date.format("D")}</span>
        <span className="text-[11px] font-bold uppercase">{date.format("ddd")}</span>
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`flex h-[46px] w-[46px] shrink-0 flex-col items-center justify-center rounded-[13px] ${className}`}
    >
      <span className="text-base font-extrabold leading-none">{date.format("D")}</span>
      <span className="text-[10.5px] font-bold">{date.format("MMM")}</span>
    </div>
  );
}

interface NearestDateCardProps {
  kicker: string;
  name: string;
  /** Naive Warsaw wall clock. */
  startsAt: string;
  /** The line under the full date, e.g. the place and sign-up count. */
  details: ReactNode;
  ctaHref: string;
  ctaLabel: string;
  /** `soft`: the organizer page's primary-soft panel; `card`: a white card
   * with a primary weekday tile. */
  variant: "soft" | "card";
}

/** A nearest term or event: date tile, name, full date, details and a
 * sign-up call to action. */
export function NearestDateCard({ kicker, name, startsAt, details, ctaHref, ctaLabel, variant }: NearestDateCardProps) {
  const soft = variant === "soft";
  return (
    <div className={soft ? "rounded-2xl bg-primary-soft p-4" : "rounded-3xl border border-line bg-paper p-4"}>
      <h2
        className={`text-[11px] font-extrabold tracking-wide ${soft ? "text-primary-fg" : "uppercase text-accent-fg"}`}
      >
        {kicker}
      </h2>
      <div className="mt-2 flex items-center gap-3">
        {soft ? (
          <DateTile occursOn={startsAt} className="bg-paper text-ink" />
        ) : (
          <DateTile occursOn={startsAt} className="bg-primary text-on-primary" weekday />
        )}
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-ink">{name}</p>
          <p className="text-[12.5px] text-ink">{dayjs(startsAt).format("dddd, D MMMM · HH:mm")}</p>
          <p className="text-[12.5px] text-ink-soft">{details}</p>
        </div>
      </div>
      <Link
        to={ctaHref}
        className={`mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-4 text-[14px] font-extrabold text-on-primary ${FOCUS_RING}`}
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
