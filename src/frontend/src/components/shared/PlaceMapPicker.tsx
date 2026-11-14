import { useEffect, useRef, useState } from "react";
import type { Locality } from "../../api/locations";
import { geocode, loadMaps, reverseGeocode, type LatLng, type MapsApi, type ResolvedPlace } from "../../lib/googleMaps";
import { localityMapsQuery } from "../../utils/locationLabel";

const POLAND_CENTER: LatLng = { lat: 52.07, lng: 19.48 };
const PIN_ZOOM = 17;
const LOCALITY_ZOOM = 13;
const COUNTRY_ZOOM = 6;
// Advanced markers need a map id; Google's demo id needs no Cloud styling.
const MAP_ID = "DEMO_MAP_ID";

type PickHandler =
  | { onPick: (place: ResolvedPlace) => void; onPoint?: undefined }
  | { onPoint: (point: LatLng) => void; onPick?: undefined };

/** The place form's map: clicking it or dragging the pin picks the point.
 * With `onPick` the point's address is reverse-geocoded; with `onPoint` the
 * bare point is handed over (a hand-typed address keeps its text). `pin` is
 * the parent's picked point (from search or an earlier pick); without it the
 * map centres on the locality. `onUnavailable` fires when the map cannot load. */
export function PlaceMapPicker({
  idPrefix,
  locality,
  pin,
  onPick,
  onPoint,
  onUnavailable,
}: {
  idPrefix: string;
  locality: Locality;
  pin: LatLng | null;
  onUnavailable: () => void;
} & PickHandler) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [api, setApi] = useState<MapsApi | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbacks = useRef({ onPick, onPoint, onUnavailable });
  const pinRef = useRef(pin);
  const hintId = `${idPrefix}-map-hint`;

  useEffect(() => {
    callbacks.current = { onPick, onPoint, onUnavailable };
    pinRef.current = pin;
  });

  useEffect(() => {
    let cancelled = false;
    void loadMaps().then((loaded) => {
      if (cancelled) return;
      if (loaded) setApi(loaded);
      else callbacks.current.onUnavailable();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // One map per mount; clicks and drags go through `pickAt`.
  useEffect(() => {
    const container = containerRef.current;
    if (!api || !container) return;
    const map = new api.Map(container, {
      center: POLAND_CENTER,
      zoom: COUNTRY_ZOOM,
      mapId: MAP_ID,
      clickableIcons: false,
      streetViewControl: false,
      mapTypeControl: false,
      fullscreenControl: false,
    });
    const marker = new api.AdvancedMarkerElement({
      gmpDraggable: true,
      title: "Wybrane miejsce",
    });
    let disposed = false;

    async function pickAt(position: LatLng) {
      marker.position = position;
      marker.map = map;
      setError(null);
      if (callbacks.current.onPoint) {
        callbacks.current.onPoint(position);
        return;
      }
      setLocating(true);
      try {
        const place = await reverseGeocode(api!, position);
        if (!disposed) callbacks.current.onPick?.(place);
      } catch (err) {
        console.warn("Google Geocoding unavailable", err);
        if (disposed) return;
        // The pin goes back to the last picked place.
        if (pinRef.current) marker.position = pinRef.current;
        else marker.map = null;
        setError("Nie udało się ustalić adresu w tym miejscu. Wskaż inny punkt.");
      } finally {
        if (!disposed) setLocating(false);
      }
    }

    const clickListener = map.addListener("click", (event: google.maps.MapMouseEvent) => {
      if (event.latLng) void pickAt({ lat: event.latLng.lat(), lng: event.latLng.lng() });
    });
    const dragListener = marker.addListener("dragend", () => {
      const position = marker.position;
      if (!position) return;
      const point = position instanceof google.maps.LatLng ? position.toJSON() : position;
      void pickAt({ lat: Number(point.lat), lng: Number(point.lng) });
    });
    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      disposed = true;
      clickListener.remove();
      dragListener.remove();
      marker.map = null;
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [api]);

  // Follows the parent's pin; without one, centres on the locality.
  const pinLat = pin?.lat;
  const pinLng = pin?.lng;
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!api || !map || !marker) return;
    if (pinLat !== undefined && pinLng !== undefined) {
      const position = { lat: pinLat, lng: pinLng };
      marker.position = position;
      marker.map = map;
      map.setCenter(position);
      map.setZoom(Math.max(map.getZoom() ?? PIN_ZOOM, PIN_ZOOM));
      return;
    }
    marker.map = null;
    let cancelled = false;
    void geocode(api, localityMapsQuery(locality)).then((center) => {
      if (cancelled || !center) return;
      map.setCenter(center);
      map.setZoom(LOCALITY_ZOOM);
    });
    return () => {
      cancelled = true;
    };
  }, [api, pinLat, pinLng, locality]);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        ref={containerRef}
        role="region"
        aria-label={`Mapa: ${locality.name}`}
        aria-describedby={hintId}
        aria-busy={!api || locating || undefined}
        className="h-56 w-full overflow-hidden rounded-xl border-[1.5px] border-line-strong bg-cream"
      />
      <p id={hintId} className="text-[12.5px] text-ink-soft">
        {locating ? "Ustalanie adresu…" : "Kliknij mapę lub przeciągnij pinezkę, aby wskazać dokładne miejsce."}
      </p>
      {error && (
        <p role="alert" className="text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
