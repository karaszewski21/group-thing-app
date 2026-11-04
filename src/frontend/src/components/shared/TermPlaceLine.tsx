import type { TermPlaceLocation } from "../../utils/appHelpers";
import { localityDetail, termPlaceMapsUrl } from "../../utils/locationLabel";
import { MapPinIcon } from "./MapPinIcon";

interface TermPlaceLineProps {
  location: TermPlaceLocation | null;
  capacity: number | null;
  attendeeCount?: number | null;
  /** Off inside a card that is itself a link: no nested anchors. */
  withMapLink: boolean;
  className?: string;
}

/** A term's place (bold locality, then the address or the locality's
 * detail line, optional Maps link) and capacity line. */
export function TermPlaceLine({ location, capacity, attendeeCount, withMapLink, className = "" }: TermPlaceLineProps) {
  if (location === null && capacity === null) return null;
  const capacityText =
    capacity === null ? null : attendeeCount != null ? `${attendeeCount}/${capacity} miejsc` : `${capacity} miejsc`;

  return (
    <div className={`flex flex-col gap-1 text-[12.5px] text-ink-soft ${className}`}>
      {location && (
        <div className="flex items-start gap-1.5">
          <span className="mt-0.5">
            <MapPinIcon />
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="font-bold text-ink">{location.locality.name}</span>
            <span>{location.formatted_address ?? localityDetail(location.locality)}</span>
            {withMapLink && (
              <a
                href={termPlaceMapsUrl(location)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Otwórz ${location.label} w Google Maps (nowa karta)`}
                className="mt-0.5 self-start font-bold text-ink underline"
              >
                Otwórz w Google Maps
              </a>
            )}
          </div>
        </div>
      )}
      {capacityText && (
        <span className="self-start rounded-full bg-cream px-2 py-0.5 text-[11.5px] font-bold text-ink-soft">
          {capacityText}
        </span>
      )}
    </div>
  );
}
