import { useEffect, useRef } from "react";
import type { EventResponse } from "../domain";

const DAY_FORMAT = new Intl.DateTimeFormat("pl-PL", { weekday: "long", day: "numeric", month: "long" });
const TIME_FORMAT = new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit" });

/** The API sends naive Warsaw wall-clock strings; parsing and formatting both in local time round-trips them. */
function formatWhen(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt);
  const times = endsAt ? `${TIME_FORMAT.format(start)}–${TIME_FORMAT.format(new Date(endsAt))}` : TIME_FORMAT.format(start);
  return `${DAY_FORMAT.format(start)} · ${times}`;
}

interface SavedCardProps {
  event: EventResponse;
  /** Banner URL from the upload response; null when there is none. */
  bannerUrl: string | null;
  /** Move focus to the card title once shown (the control that had focus has unmounted). */
  focusOnMount?: boolean;
}

/** Confirmation card (`role="status"`), rendered only from the POST response. */
export function SavedCard({ event, bannerUrl, focusOnMount = false }: SavedCardProps) {
  const titleRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (focusOnMount) titleRef.current?.focus();
  }, [focusOnMount]);

  return (
    <div className="status" role="status">
      {bannerUrl && <img className="thumb" src={bannerUrl} alt="" />}
      <p ref={titleRef} className="t" tabIndex={-1}>
        Wydarzenie zapisane
      </p>
      <p className="name">{event.name}</p>
      <p className="s">{formatWhen(event.starts_at, event.ends_at)}</p>
      {event.location && (
        <p className="s">
          {event.location.name}, {event.location.formatted_address}
        </p>
      )}
    </div>
  );
}
