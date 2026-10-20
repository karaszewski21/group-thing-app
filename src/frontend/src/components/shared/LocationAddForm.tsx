import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CreateLocationRequest, LocationResponse } from "../../api/locations";
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

/* ------------------------------------------------------------------ */
/*  Form adding one saved place: Google search (mockup 2c) or manual   */
/*  entry (2d). Inline only — shared by the forms' LocationPicker and  */
/*  the "Moje miejsca" panel view.                                     */
/* ------------------------------------------------------------------ */

export const LOCATION_INPUT_CLASS = "w-full rounded-xl border-[1.5px] border-line bg-cream px-3.5 py-2.5 text-ink";
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

/** `create` is the host's `useMyLocations().create` (a second subscription
 * here would refetch the list on every open); `onSaved` receives the created
 * place, or the already saved one with the same Google place id. */
export function LocationAddForm({
  idPrefix,
  create,
  onSaved,
  onCancel,
}: {
  idPrefix: string;
  create: (request: CreateLocationRequest) => Promise<LocationResponse>;
  onSaved: (location: LocationResponse) => void;
  onCancel: () => void;
}) {
  const googleConfigured = isGoogleMapsConfigured();
  const [mode, setMode] = useState<"google" | "manual">(googleConfigured ? "google" : "manual");
  const [unavailable, setUnavailable] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<ResolvedPlace | null>(null);
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
  const listboxId = `${idPrefix}-place-listbox`;
  const optionId = (index: number) => `${idPrefix}-place-opt-${index}`;

  useEffect(() => {
    if (!focusSearch.current) return;
    focusSearch.current = false;
    searchRef.current?.focus();
  }, [picked, mode]);

  // Debounced autocomplete; no request before the first keystroke.
  useEffect(() => {
    const token = tokenRef.current;
    if (!api || !token || picked || mode !== "google" || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      suggest(api, query, token)
        .then((result) => {
          if (cancelled) return;
          setSuggestions(result);
          setOpen(result.length > 0);
          setActive(-1);
        })
        .catch(() => {
          if (cancelled) return;
          setSuggestions([]);
          setOpen(false);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, query, picked, mode]);

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
      setPicked(place);
      setName(place.name);
      setError(null);
    } catch {
      setError("Nie udało się pobrać adresu. Spróbuj ponownie.");
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
    if (event.key === "Enter" && open && active >= 0) {
      event.preventDefault();
      void pick(suggestions[active]);
    }
  }

  function switchMode(next: "google" | "manual") {
    focusSearch.current = next === "google";
    setUnavailable(false);
    setError(null);
    setMode(next);
  }

  async function save() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Podaj nazwę miejsca");
      return;
    }
    let request: CreateLocationRequest;
    if (mode === "google") {
      if (!picked) {
        setError("Wybierz adres z listy");
        return;
      }
      request = {
        source: "GOOGLE",
        name: trimmedName,
        formatted_address: picked.formattedAddress,
        google_place_id: picked.placeId,
        lat: picked.lat,
        lng: picked.lng,
        notes: notes.trim() || null,
      };
    } else {
      if (!address.trim()) {
        setError("Podaj adres");
        return;
      }
      request = { source: "MANUAL", name: trimmedName, formatted_address: address.trim(), notes: notes.trim() || null };
    }
    setError(null);
    setBusy(true);
    try {
      onSaved(await create(request));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Nie udało się zapisać miejsca.");
    } finally {
      setBusy(false);
    }
  }

  const searching = mode === "google" && !picked;

  return (
    <div className="flex flex-col gap-2">
      {unavailable && mode === "manual" && (
        <p role="alert" className={LOCATION_ERROR_CLASS}>
          {SEARCH_UNAVAILABLE}
        </p>
      )}

      {searching && (
        <>
          <input
            ref={searchRef}
            role="combobox"
            aria-label="Szukaj adresu lub nazwy miejsca"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
            aria-busy={loadingApi || undefined}
            placeholder={loadingApi ? "Ładowanie wyszukiwarki…" : "Szukaj adresu lub nazwy miejsca…"}
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
              className="flex flex-col overflow-hidden rounded-xl border-[1.5px] border-line bg-paper"
            >
              {suggestions.map((s, index) => (
                <li
                  key={`${s.placeId}-${index}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pick(s)}
                  className={`cursor-pointer px-3.5 py-2 text-[13px] ${index === active ? "bg-cream" : ""}`}
                >
                  <span className="font-bold text-ink">{s.mainText}</span>
                  {s.secondaryText && <span className="text-ink-soft">, {s.secondaryText}</span>}
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className={LOCATION_ERROR_CLASS}>
              {error}
            </p>
          )}
          <button type="button" onClick={() => switchMode("manual")} className={LOCATION_TEXT_BTN_CLASS}>
            wpisz ręcznie
          </button>
        </>
      )}

      {!searching && (
        <>
          {picked && mode === "google" && (
            <div className="flex items-center gap-2 text-[13px] text-ink">
              <span className="min-w-0 flex-1">{picked.formattedAddress}</span>
              <button
                type="button"
                onClick={() => {
                  focusSearch.current = true;
                  setPicked(null);
                  setQuery("");
                }}
                className={LOCATION_CANCEL_BTN_CLASS}
              >
                zmień
              </button>
            </div>
          )}
          <span className={LOCATION_LABEL_CLASS}>Nazwa miejsca</span>
          <input
            aria-label="Nazwa miejsca"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Sala nr 2"
            className={LOCATION_INPUT_CLASS}
          />
          {mode === "manual" && (
            <>
              <span className={LOCATION_LABEL_CLASS}>Adres</span>
              <input
                aria-label="Adres"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="np. ul. Szkolna 5, 60-001 Poznań"
                className={LOCATION_INPUT_CLASS}
              />
            </>
          )}
          <span className={LOCATION_LABEL_CLASS}>Notatka</span>
          <input
            aria-label="Notatka"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="np. I piętro, drzwi po lewej"
            className={LOCATION_INPUT_CLASS}
          />
          {error && (
            <p role="alert" className={LOCATION_ERROR_CLASS}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => void save()} disabled={busy} className={LOCATION_SAVE_BTN_CLASS}>
              Zapisz miejsce
            </button>
            <button type="button" onClick={onCancel} className={LOCATION_CANCEL_BTN_CLASS}>
              Anuluj
            </button>
            {mode === "manual" && googleConfigured && (
              <button
                type="button"
                onClick={() => switchMode("google")}
                className={`${LOCATION_TEXT_BTN_CLASS} ml-auto`}
              >
                szukaj w Google
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
