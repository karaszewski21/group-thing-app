import type { EventResponse } from "../../../api/events";
import { AddToCalendarButton } from "../../../components/shared/AddToCalendarButton";
import { CopyIcon } from "../../../components/shared/appIcons";
import { BTN_GHOST, BTN_SM, CARD } from "../../../components/shared/uiStyles";
import dayjs from "../../../utils/dayjs";
import { localityDetail, termPlaceMapsUrl } from "../../../utils/locationLabel";

const EYEBROW = "text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase";

interface EventWhenCardProps {
  event: EventResponse;
  /** Absolute URL of the event page, for the calendar entry and "Kopiuj link". */
  url: string;
  /** Called after the link is copied, e.g. to show "Skopiowano link". */
  onCopyLink: () => void;
}

/** "Termin wydarzenia" card, an event-only copy of `TermCard`: a date badge
 * with the full date and the start–end time, the place, and the calendar and
 * copy-link actions. Events have no capacity. */
export function EventWhenCard({ event, url, onCopyLink }: EventWhenCardProps) {
  const start = dayjs(event.starts_at);
  const time = event.ends_at ? `${start.format("HH:mm")}–${dayjs(event.ends_at).format("HH:mm")}` : start.format("HH:mm");
  const { location } = event;

  return (
    <section aria-label="Termin wydarzenia" className={`mx-5 mt-6 ${CARD}`}>
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="flex h-16 w-14 shrink-0 flex-col items-center justify-center rounded-[18px] bg-accent-soft"
        >
          <span className="text-[11px] font-extrabold tracking-widest text-accent-fg uppercase">{start.format("dd")}</span>
          <span className="font-serif text-[26px] leading-none font-extrabold text-ink">{start.format("D")}</span>
        </span>
        <div className="min-w-0">
          <p className={EYEBROW}>Termin wydarzenia</p>
          <p className="text-base font-bold text-ink first-letter:uppercase">{start.format("dddd, D MMMM YYYY")}</p>
          <p className="text-sm text-ink-soft">godz. {time}</p>
        </div>
      </div>
      {location && (
        <div className="mt-3 border-t border-line pt-3">
          <p className={EYEBROW}>Miejsce</p>
          <p className="font-bold text-ink">{location.locality.name}</p>
          <p className="text-sm text-ink-soft">{location.formatted_address ?? localityDetail(location.locality)}</p>
          <a
            href={termPlaceMapsUrl(location)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-sm font-bold text-ink underline"
          >
            Otwórz w Google Maps<span aria-hidden="true"> ↗</span>{" "}
            <span className="sr-only">(nowa karta)</span>
          </a>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <AddToCalendarButton
          event={{
            uid: event.id,
            title: event.name,
            occursOn: event.starts_at,
            groupName: location?.label ?? event.name,
            url,
          }}
          size="sm"
          direction="down"
        />
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url);
            onCopyLink();
          }}
          className={`${BTN_GHOST} ${BTN_SM} inline-flex items-center gap-2 whitespace-nowrap`}
        >
          <CopyIcon c="currentColor" />
          Kopiuj link
        </button>
      </div>
    </section>
  );
}
