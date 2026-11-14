import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Locality, LocationRequest, LocationResponse } from "../../api/locations";
import {
  isGoogleMapsConfigured,
  loadPlaces,
  newSessionToken,
  resolve,
  suggest,
  type LatLng,
  type PlacesApi,
  type ResolvedPlace,
  type SessionToken,
  type Suggestion,
} from "../../lib/googleMaps";
import { INPUT_CLASS } from "./appComponents";
import { LocalityCombobox } from "./LocalityCombobox";
import { MapPinIcon } from "./MapPinIcon";
import { PlaceMapPicker } from "./PlaceMapPicker";

/* ------------------------------------------------------------------ */
/*  The place form of /places/new and /places/:id/edit: a required     */
/*  TERYT locality plus an optional address. One address field: typed  */
/*  text is saved as it is; picking a Google suggestion (biased to     */
/*  the locality) or a point on the map adds the exact position.       */
/* ------------------------------------------------------------------ */

export const LOCATION_INPUT_CLASS = `${INPUT_CLASS} w-full`;
export const LOCATION_LABEL_CLASS = "text-[11px] font-extrabold tracking-wide text-ink-soft";
export const LOCATION_SAVE_BTN_CLASS =
  "flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60";
export const LOCATION_CANCEL_BTN_CLASS =
  "flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft";
const LOCATION_SECONDARY_BTN_CLASS = `${LOCATION_CANCEL_BTN_CLASS} inline-flex items-center gap-1 self-start transition-colors hover:bg-cream hover:text-ink`;
export const LOCATION_ERROR_CLASS = "text-[12.5px] font-semibold text-danger";
export const PLACE_TITLE_CLASS = "font-serif text-[22px] leading-tight font-extrabold tracking-tight text-ink";
const LOCATION_HINT_CLASS ="text-[12.5px] text-ink-soft";

const SEARCH_DEBOUNCE_MS = 300;
const SUGGESTIONS_UNAVAILABLE = "Podpowiedzi adresów są teraz niedostępne. Wpisz adres ręcznie.";
const MAP_UNAVAILABLE = "Mapa jest teraz niedostępna.";
const ADDRESS_HINT = "Potrzebny głównie dla terminów i wydarzeń. Przy przedmiotach widzisz go tylko Ty.";
const EXACT_HINT = "Wybierz adres z podpowiedzi albo wskaż miejsce na mapie, żeby zapisać dokładne położenie.";
const PIN_SET = "Dokładne położenie zaznaczone.";
const POINT_NEEDS_ADDRESS = "Wpisz adres wskazanego miejsca albo usuń pinezkę";

/** The exact position of the address. `placeId` is set while the address
 * text is Google's own (saved as GOOGLE); `byHand` marks a point set on the
 * map, which stays when the text is edited. */
interface Pin extends LatLng {
  placeId: string | null;
  byHand: boolean;
}

function initialPin(initial: LocationResponse | undefined): Pin | null {
  if (!initial || !initial.formatted_address || initial.lat === null || initial.lng === null) return null;
  const google = initial.source === "GOOGLE";
  return { lat: initial.lat, lng: initial.lng, placeId: google ? initial.google_place_id : null, byHand: !google };
}

/** `submit` is the host's `useMyLocations().create`, or its `update` bound to
 * the edited id (a second subscription here would refetch the list on every
 * open); `initial` prefills the edited place. `onSaved` receives the saved place. */
export function LocationAddForm({
  idPrefix,
  initial,
  submit,
  onSaved,
  onCancel,
}: {
  idPrefix: string;
  initial?: LocationResponse;
  submit: (request: LocationRequest) => Promise<LocationResponse>;
  onSaved: (location: LocationResponse) => void;
  onCancel: () => void;
}) {
  const googleConfigured = isGoogleMapsConfigured();
  const [locality, setLocality] = useState<Locality | null>(initial?.locality ?? null);
  const [localityInvalid, setLocalityInvalid] = useState(false);
  const [address, setAddress] = useState(initial?.formatted_address ?? "");
  const [pin, setPin] = useState<Pin | null>(() => initialPin(initial));
  const [suggestionsUnavailable, setSuggestionsUnavailable] = useState(false);
  const [mapRequested, setMapRequested] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [api, setApi] = useState<PlacesApi | null>(null);
  const [loadingApi, setLoadingApi] = useState(false);
  const loadStarted = useRef(false);
  const tokenRef = useRef<SessionToken | null>(null);
  // True from a keystroke until a suggestion or a map point is picked.
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const mounted = useRef(true);
  const listboxId = `${idPrefix}-place-listbox`;
  const optionId = (index: number) => `${idPrefix}-place-opt-${index}`;
  const addressId = `${idPrefix}-address`;
  const addressHintId = `${idPrefix}-address-hint`;
  const addressBlocked = locality === null;
  const canSuggest = googleConfigured && !suggestionsUnavailable;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Debounced autocomplete biased to the chosen locality; no request before
  // the first keystroke.
  useEffect(() => {
    const token = tokenRef.current;
    if (!api || !token || !locality || !suggesting || !address.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      suggest(api, `${address}, ${locality.name}, ${locality.voivodeship}`, token)
        .then((result) => {
          if (cancelled) return;
          setSuggestions(result);
          setOpen(result.length > 0);
          setActive(-1);
        })
        .catch((err: unknown) => {
          // A rejected key, a disabled Places API or billing: suggesting cannot work.
          console.warn("Google Places unavailable", err);
          if (cancelled) return;
          setSuggestions([]);
          setOpen(false);
          setSuggestionsUnavailable(true);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, address, suggesting, locality]);

  async function ensurePlaces() {
    if (!canSuggest || loadStarted.current) return;
    loadStarted.current = true;
    setLoadingApi(true);
    const loaded = await loadPlaces();
    if (!mounted.current) return;
    setLoadingApi(false);
    if (!loaded) {
      setSuggestionsUnavailable(true);
      return;
    }
    tokenRef.current = newSessionToken(loaded);
    setApi(loaded);
  }

  function closeSuggestions() {
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
  }

  function changeLocality(next: Locality | null) {
    if (next?.id !== locality?.id) {
      setAddress("");
      setPin(null);
      setSuggesting(false);
      closeSuggestions();
    }
    setLocality(next);
    setLocalityInvalid(false);
    setError(null);
  }

  function changeAddress(next: string) {
    setAddress(next);
    setError(null);
    // A point set on the map stays; one that came with a picked address goes
    // with that address.
    setPin((current) => (current?.byHand ? { ...current, placeId: null } : null));
    setSuggesting(true);
    if (!next.trim()) closeSuggestions();
  }

  function takePlace(place: ResolvedPlace, byHand: boolean) {
    setAddress(place.formattedAddress);
    setPin({ lat: place.lat, lng: place.lng, placeId: place.placeId, byHand });
    setSuggesting(false);
    closeSuggestions();
    setError(null);
  }

  async function pick(suggestion: Suggestion) {
    setSuggesting(false);
    closeSuggestions();
    try {
      const place = await resolve(suggestion);
      if (mounted.current) takePlace(place, false);
    } catch (err) {
      console.warn("Google Places details unavailable", err);
      if (mounted.current) setError("Nie udało się pobrać adresu. Spróbuj ponownie.");
    } finally {
      // The resolved selection closes the billing session; start a new one.
      if (api) tokenRef.current = newSessionToken(api);
    }
  }

  function handleAddressKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!open) return;
      // Close only the listbox; a host dialog must not see this Esc.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const count = suggestions.length;
      if (count === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setActive((index) => (index < 0 ? (step > 0 ? 0 : count - 1) : (index + step + count) % count));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && active >= 0) void pick(suggestions[active]);
    }
  }

  function addressRequest(): Omit<LocationRequest, "locality_id"> | null {
    const typed = address.trim();
    if (!typed) return null;
    if (pin?.placeId) {
      return {
        formatted_address: typed,
        source: "GOOGLE",
        google_place_id: pin.placeId,
        lat: pin.lat,
        lng: pin.lng,
      };
    }
    return { formatted_address: typed, source: "MANUAL", ...(pin && { lat: pin.lat, lng: pin.lng }) };
  }

  async function save() {
    if (!locality) {
      setLocalityInvalid(true);
      return;
    }
    if (pin && !address.trim()) {
      setError(POINT_NEEDS_ADDRESS);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onSaved(await submit({ locality_id: locality.id, ...addressRequest() }));
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error && err.message ? err.message : "Nie udało się zapisać miejsca.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  // The map opens on request or once there is a pin, so a form left unused
  // costs no map load.
  const mapAllowed = googleConfigured && !mapUnavailable && locality !== null;
  const showMap = mapAllowed && (mapRequested || pin !== null);
  // On an empty field a map point also fills in its address; typed text is
  // never replaced.
  const mapPick = address.trim()
    ? {
        onPoint: (point: LatLng) => {
          setPin({ ...point, placeId: null, byHand: true });
          setError(null);
        },
      }
    : { onPick: (place: ResolvedPlace) => takePlace(place, true) };

  return (
    <div className="flex flex-col gap-3">
      <LocalityCombobox idPrefix={idPrefix} value={locality} onChange={changeLocality} invalid={localityInvalid} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={addressId} className={LOCATION_LABEL_CLASS}>
          Adres (opcjonalnie)
        </label>
        {addressBlocked ? (
          <input
            id={addressId}
            aria-disabled="true"
            aria-describedby={addressHintId}
            readOnly
            value=""
            placeholder="Najpierw wybierz miejscowość"
            className={`${LOCATION_INPUT_CLASS} cursor-not-allowed opacity-60`}
          />
        ) : canSuggest ? (
          <>
            <input
              id={addressId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
              aria-describedby={addressHintId}
              aria-busy={loadingApi || undefined}
              autoComplete="off"
              placeholder="Ulica i numer, np. Szkolna 5"
              value={address}
              onFocus={() => void ensurePlaces()}
              onChange={(e) => {
                void ensurePlaces();
                changeAddress(e.target.value);
              }}
              onBlur={() => {
                setOpen(false);
                setActive(-1);
              }}
              onKeyDown={handleAddressKeyDown}
              className={LOCATION_INPUT_CLASS}
            />
            {open && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Podpowiedzi adresów"
                className="flex flex-col overflow-hidden rounded-xl border-[1.5px] border-line-strong bg-paper"
              >
                {suggestions.map((s, index) => (
                  <li
                    key={`${s.placeId}-${index}`}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void pick(s)}
                    className={`cursor-pointer border-b border-line px-3 py-2 text-[13.5px] last:border-b-0 ${
                      index === active ? "bg-mint-soft" : ""
                    }`}
                  >
                    <span className="block font-extrabold text-ink">{s.mainText}</span>
                    {s.secondaryText && <span className="block text-[12px] text-ink-soft">{s.secondaryText}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <input
            id={addressId}
            aria-describedby={addressHintId}
            value={address}
            onChange={(e) => changeAddress(e.target.value)}
            placeholder="Ulica i numer, np. Szkolna 5"
            className={LOCATION_INPUT_CLASS}
          />
        )}
        <p id={addressHintId} className={LOCATION_HINT_CLASS}>
          {ADDRESS_HINT}
          {mapAllowed && !pin && <> {EXACT_HINT}</>}
        </p>
        {suggestionsUnavailable && (
          <p role="status" className={LOCATION_HINT_CLASS}>
            {SUGGESTIONS_UNAVAILABLE}
          </p>
        )}
        {mapAllowed && !showMap && (
          <button type="button" onClick={() => setMapRequested(true)} className={LOCATION_SECONDARY_BTN_CLASS}>
            <MapPinIcon />
            Wskaż na mapie
          </button>
        )}
        {mapUnavailable && mapRequested && (
          <p role="status" className={LOCATION_HINT_CLASS}>
            {MAP_UNAVAILABLE}
          </p>
        )}
        {showMap && locality && (
          <PlaceMapPicker
            idPrefix={idPrefix}
            locality={locality}
            pin={pin}
            onUnavailable={() => setMapUnavailable(true)}
            {...mapPick}
          />
        )}
        {pin && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="text-[12.5px] font-semibold text-ink">
              {PIN_SET}
            </p>
            <button
              type="button"
              onClick={() => {
                setPin(null);
                setError(null);
              }}
              className={LOCATION_SECONDARY_BTN_CLASS}
            >
              Usuń pinezkę
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className={LOCATION_ERROR_CLASS}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => void save()} disabled={busy} className={LOCATION_SAVE_BTN_CLASS}>
          Zapisz
        </button>
        <button type="button" onClick={onCancel} className={LOCATION_CANCEL_BTN_CLASS}>
          Anuluj
        </button>
      </div>
    </div>
  );
}
