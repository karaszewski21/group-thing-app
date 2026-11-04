import { useId, type ReactNode } from "react";
import type { Locality } from "../../api/locations";
import { buildMapsUrl } from "../../lib/googleMaps";
import { localityDetail, localityMapsQuery } from "../../utils/locationLabel";
import { PlaceMapEmbed } from "./PlaceMapEmbed";
import { CARD } from "./uiStyles";

/** The fields a place card reads: items, terms and events all carry them. */
export interface PlaceCardLocation {
  locality: Locality;
  formatted_address: string | null;
  google_place_id?: string | null;
}

export const PLACE_LINK = "text-[13px] font-bold text-primary-fg underline underline-offset-2";
const LOCALITY_MAP_ZOOM = 12;
const ADDRESS_MAP_ZOOM = 16;

interface PlaceCardProps {
  heading: string;
  /** `null` renders only the heading and `children` (e.g. "set a place"). */
  location: PlaceCardLocation | null;
  /** A removed place: "(usunięte)", no Maps link and no map. */
  deleted?: boolean;
  /** `false` when the address is private and `children` show it instead;
   * the map and the Maps link still use it. */
  showAddress?: boolean;
  /** Outer spacing of the card. */
  className?: string;
  children?: ReactNode;
}

/** The one place card of items, terms and events: 📍 the locality with its
 * gmina/powiat/voivodeship line and the address when there is one, a Google
 * Maps link and a map pinning the address (or the locality without one). */
export function PlaceCard({
  heading,
  location,
  deleted = false,
  showAddress = true,
  className = "mt-3",
  children,
}: PlaceCardProps) {
  const headingId = useId();
  return (
    <section className={`${className} ${CARD}`} aria-labelledby={headingId}>
      <h3 id={headingId} className="text-xs font-bold text-ink-soft">
        {heading}
      </h3>
      {location && <PlaceDetails location={location} deleted={deleted} showAddress={showAddress} />}
      {children}
    </section>
  );
}

/** The card's body without its section and heading, for a page that frames
 * the place in its own section. */
export function PlaceDetails({
  location,
  deleted = false,
  showAddress = true,
}: {
  location: PlaceCardLocation;
  deleted?: boolean;
  showAddress?: boolean;
}) {
  const { locality, formatted_address: address } = location;
  const localityQuery = localityMapsQuery(locality);
  const mapsUrl = address
    ? buildMapsUrl({ query: address, google_place_id: location.google_place_id })
    : buildMapsUrl({ query: localityQuery });
  return (
    <>
      <div className="mt-1.5 flex items-start gap-2.5">
        <span aria-hidden="true">📍</span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold wrap-break-word text-ink">
            {deleted ? `${locality.name} (usunięte)` : locality.name}
          </p>
          {showAddress && address && <p className="text-[13px] wrap-break-word text-ink">{address}</p>}
          <p className="text-[13px] wrap-break-word text-ink-soft">{localityDetail(locality)}</p>
          {!deleted && (
            <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={PLACE_LINK}>
              Otwórz w Mapach <span className="sr-only">(nowa karta)</span>
            </a>
          )}
        </div>
      </div>
      {!deleted && (
        <PlaceMapEmbed
          query={address ? `${address}, ${localityQuery}` : localityQuery}
          zoom={address ? ADDRESS_MAP_ZOOM : LOCALITY_MAP_ZOOM}
          title={`Mapa: ${locality.name}`}
        />
      )}
    </>
  );
}
