import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Locality, LocationRequest, LocationResponse } from "../../api/locations";
import {
  isGoogleMapsConfigured,
  loadPlaces,
  newSessionToken,
  resolve,
  suggest,
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
/*  TERYT locality plus an optional address (Google search biased to   */
/*  that locality or pinned on its map, or typed by hand).             */
/* ------------------------------------------------------------------ */

export const LOCATION_INPUT_CLASS = `${INPUT_CLASS} w-full`;
export const LOCATION_LABEL_CLASS = "text-[11px] font-extrabold tracking-wide text-ink-soft";
export const LOCATION_SAVE_BTN_CLASS =
  "flex-none rounded-[9px] bg-mint px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-60";
export const LOCATION_CANCEL_BTN_CLASS =
  "flex-none rounded-[9px] border border-line px-2.5 py-1.5 text-[11.5px] font-extrabold text-ink-soft";
const LOCATION_TEXT_BTN_CLASS =
  "self-start rounded-[9px] px-1.5 py-1 text-[12px] font-bold text-ink-soft transition-colors hover:bg-cream hover:text-ink";
export const LOCATION_ERROR_CLASS = "text-[12.5px] font-semibold text-danger";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_UNAVAILABLE = "Wyszukiwarka niedostępna — wpisz adres ręcznie";
const ADDRESS_HINT = "Potrzebny głównie dla terminów i wydarzeń. Przy przedmiotach widzisz go tylko Ty.";

type AddressMode = "google" | "manual";

function initialPicked(initial: LocationResponse | undefined): ResolvedPlace | null {
  if (!initial || initial.source !== "GOOGLE" || !initial.formatted_address) return null;
  if (initial.google_place_id === null || initial.lat === null || initial.lng === null) return null;
  return {
    placeId: initial.google_place_id,
    name: initial.formatted_address,
    formattedAddress: initial.formatted_address,
    lat: initial.lat,
    lng: initial.lng,
  };
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
  const [picked, setPicked] = useState<ResolvedPlace | null>(() => initialPicked(initial));
  // A saved Google address shows as picked even when search is not configured.
  const [mode, setMode] = useState<AddressMode>(() =>
    picked || (googleConfigured && initial?.source !== "MANUAL") ? "google" : "manual",
  );
  const [unavailable, setUnavailable] = useState(false);
  const [mapRequested, setMapRequested] = useState(false);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [address, setAddress] = useState(initial?.source === "MANUAL" ? (initial.formatted_address ?? "") : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [api, setApi] = useState<PlacesApi | null>(null);
  const [loadingApi, setLoadingApi] = useState(false);
  const loadStarted = useRef(false);
  const tokenRef = useRef<SessionToken | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const mounted = useRef(true);
  const listboxId = `${idPrefix}-place-listbox`;
  const optionId = (index: number) => `${idPrefix}-place-opt-${index}`;
  const addressId = `${idPrefix}-address`;
  const addressHintId = `${idPrefix}-address-hint`;
  const addressBlocked = locality === null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!focusSearch.current) return;
    focusSearch.current = false;
    searchRef.current?.focus();
  }, [picked, mode]);

  // Debounced autocomplete biased to the chosen locality; no request before
  // the first keystroke.
  useEffect(() => {
    const token = tokenRef.current;
    if (!api || !token || !locality || picked || mode !== "google" || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      suggest(api, `${query}, ${locality.name}, ${locality.voivodeship}`, token)
        .then((result) => {
          if (cancelled) return;
          setSuggestions(result);
          setOpen(result.length > 0);
          setActive(-1);
        })
        .catch((err: unknown) => {
          // A rejected key, a disabled Places API or billing: searching cannot work.
          console.warn("Google Places unavailable", err);
          if (cancelled) return;
          setSuggestions([]);
          setOpen(false);
          setUnavailable(true);
          setMode("manual");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query, picked, mode, locality]);

  async function ensurePlaces() {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setLoadingApi(true);
    const loaded = await loadPlaces();
    setLoadingApi(false);
    if (!loaded) {
      loadStarted.current = false;
      setUnavailable(true);
      setMode("manual");
      return;
    }
    tokenRef.current = newSessionToken(loaded);
    setApi(loaded);
  }

  function clearAddress() {
    setPicked(null);
    setQuery("");
    setAddress("");
    setSuggestions([]);
    setOpen(false);
    setActive(-1);
  }

  function changeLocality(next: Locality | null) {
    if (next?.id !== locality?.id) clearAddress();
    setLocality(next);
    setLocalityInvalid(false);
    setError(null);
  }

  function changeQuery(next: string) {
    setQuery(next);
    if (!next.trim()) {
      setSuggestions([]);
      setOpen(false);
      setActive(-1);
    }
  }

  async function pick(suggestion: Suggestion) {
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
    try {
      const place = await resolve(suggestion);
      if (!mounted.current) return;
      setPicked(place);
      setError(null);
    } catch (err) {
      console.warn("Google Places details unavailable", err);
      if (mounted.current) setError("Nie udało się pobrać adresu. Spróbuj ponownie.");
    } finally {
      // The resolved selection closes the billing session; start a new one.
      if (api) tokenRef.current = newSessionToken(api);
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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

  function switchMode(next: AddressMode) {
    focusSearch.current = next === "google";
    clearAddress();
    setUnavailable(false);
    setError(null);
    setMode(next);
  }

  function addressRequest(): Omit<LocationRequest, "locality_id"> | null | undefined {
    if (mode === "google") {
      if (picked) {
        return {
          formatted_address: picked.formattedAddress,
          source: "GOOGLE",
          google_place_id: picked.placeId,
          lat: picked.lat,
          lng: picked.lng,
        };
      }
      return query.trim() ? undefined : null;
    }
    const typed = address.trim();
    return typed ? { formatted_address: typed, source: "MANUAL" } : null;
  }

  async function save() {
    if (!locality) {
      setLocalityInvalid(true);
      return;
    }
    const addressPart = addressRequest();
    if (addressPart === undefined) {
      setError("Wybierz adres z listy");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      onSaved(await submit({ locality_id: locality.id, ...addressPart }));
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error && err.message ? err.message : "Nie udało się zapisać miejsca.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const searching = mode === "google" && !picked;
  // The map opens on request or once a place is picked, so a form left
  // unused costs no map load.
  const mapAllowed = googleConfigured && mode === "google" && !mapUnavailable && locality !== null;
  const showMap = mapAllowed && (mapRequested || picked !== null);

  return (
    <div className="flex flex-col gap-3">
      <LocalityCombobox idPrefix={idPrefix} value={locality} onChange={changeLocality} invalid={localityInvalid} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor={addressId} className={LOCATION_LABEL_CLASS}>
          Adres (opcjonalnie)
        </label>
        {unavailable && mode === "manual" && (
          <p role="alert" className={LOCATION_ERROR_CLASS}>
            {SEARCH_UNAVAILABLE}
          </p>
        )}
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
        ) : picked && mode === "google" ? (
          <div className="flex items-center gap-2 text-[13px] text-ink">
            <span id={addressId} className="min-w-0 flex-1">
              {picked.formattedAddress}
            </span>
            <button
              type="button"
              onClick={() => {
                focusSearch.current = googleConfigured;
                clearAddress();
                if (!googleConfigured) setMode("manual");
              }}
              className={LOCATION_CANCEL_BTN_CLASS}
            >
              zmień
            </button>
          </div>
        ) : searching ? (
          <>
            <input
              ref={searchRef}
              id={addressId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
              aria-describedby={addressHintId}
              aria-busy={loadingApi || undefined}
              autoComplete="off"
              placeholder={loadingApi ? "Ładowanie wyszukiwarki…" : "Ulica i numer"}
              value={query}
              onFocus={() => void ensurePlaces()}
              onChange={(e) => {
                void ensurePlaces();
                changeQuery(e.target.value);
              }}
              onKeyDown={handleSearchKeyDown}
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
            onChange={(e) => setAddress(e.target.value)}
            placeholder="np. ul. Szkolna 5"
            className={LOCATION_INPUT_CLASS}
          />
        )}
        <p id={addressHintId} className="text-[12.5px] text-ink-soft">
          {ADDRESS_HINT}
        </p>
        {mapAllowed && !showMap && (
          <button
            type="button"
            onClick={() => setMapRequested(true)}
            className={`${LOCATION_TEXT_BTN_CLASS} inline-flex items-center gap-1`}
          >
            <MapPinIcon />
            wskaż na mapie
          </button>
        )}
        {showMap && locality && (
          <PlaceMapPicker
            idPrefix={idPrefix}
            locality={locality}
            pin={picked}
            onPick={(place) => {
              setPicked(place);
              setQuery("");
              setSuggestions([]);
              setOpen(false);
              setActive(-1);
              setError(null);
            }}
            onUnavailable={() => setMapUnavailable(true)}
          />
        )}
        {!addressBlocked && searching && (
          <button type="button" onClick={() => switchMode("manual")} className={LOCATION_TEXT_BTN_CLASS}>
            wpisz ręcznie
          </button>
        )}
        {!addressBlocked && mode === "manual" && googleConfigured && (
          <button type="button" onClick={() => switchMode("google")} className={LOCATION_TEXT_BTN_CLASS}>
            szukaj w Google
          </button>
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
