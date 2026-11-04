import type { Locality } from "../api/locations";
import { buildMapsUrl } from "../lib/googleMaps";
import type { TermPlaceLocation } from "./appHelpers";

/** The line under a locality's name: "gm. Kęty, pow. oświęcimski, małopolskie". */
export function localityDetail(locality: Locality): string {
  return `gm. ${locality.gmina}, pow. ${locality.powiat}, ${locality.voivodeship}`;
}

/** A Google Maps search for a place without an address. The gmina and
 * voivodeship tell apart the many same-named villages. */
export function localityMapsQuery(locality: Locality): string {
  return `${locality.name}, gmina ${locality.gmina}, ${locality.voivodeship}, Polska`;
}

/** A term or event place on Google Maps: the address with its place id, or
 * a search on the locality when the place has no address. */
export function termPlaceMapsUrl(location: TermPlaceLocation): string {
  return location.formatted_address
    ? buildMapsUrl({ query: location.formatted_address, google_place_id: location.google_place_id })
    : buildMapsUrl({ query: localityMapsQuery(location.locality) });
}
