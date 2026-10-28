import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  MESSAGES,
  PLACE_ADDRESS_MAX,
  PLACE_NAME_MAX,
  createLocation,
  listMyLocations,
  validatePlace,
  type LocationResponse,
  type PlaceInput,
} from "../domain";

const TITLE_ID = "location-sheet-title";
const PLACE_HINT_ID = "place-add-hint";
const FOCUSABLE =
  'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

type Places = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; places: LocationResponse[] };

interface LocationSheetProps {
  selectedId: string | null;
  onSelect: (location: LocationResponse | null) => void;
  onClose: () => void;
}

/** Same cycling rule as the host's `components/shared/trapFocus.ts`. */
function trapFocus(e: KeyboardEvent, container: HTMLElement) {
  const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  const inside = active !== container && container.contains(active);
  if (e.shiftKey && (!inside || active === first)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (!inside || active === last)) {
    e.preventDefault();
    first.focus();
  }
}

/** "Lokalizacja" bottom sheet: my places, an inline add-place form and "Bez lokalizacji". */
export function LocationSheet({ selectedId, onSelect, onClose }: LocationSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [places, setPlaces] = useState<Places>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    let active = true;
    setPlaces({ kind: "loading" });
    void listMyLocations().then((result) => {
      if (!active) return;
      setPlaces(result.ok ? { kind: "ready", places: result.value } : { kind: "error", message: result.error });
    });
    return () => {
      active = false;
    };
  }, [reload]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab" && dialogRef.current) {
      trapFocus(e, dialogRef.current);
    }
  }

  function choose(location: LocationResponse | null) {
    onSelect(location);
    onClose();
  }

  // Portalled out of the event form; the span keeps clicks and keys from bubbling into it.
  return createPortal(
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div
        className="sheet-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          ref={dialogRef}
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          <div className="sheet-head">
            <h2 id={TITLE_ID}>Lokalizacja</h2>
            <button type="button" className="close" aria-label="Zamknij" onClick={onClose}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>

          {places.kind === "loading" && (
            <p className="hint" role="status">
              Wczytywanie miejsc…
            </p>
          )}
          {places.kind === "error" && (
            <>
              <p className="err" role="alert">
                {places.message}
              </p>
              <button type="button" className="ghost" onClick={() => setReload((n) => n + 1)}>
                Spróbuj ponownie
              </button>
            </>
          )}
          {places.kind === "ready" &&
            places.places.map((place) => (
              <button
                key={place.id}
                type="button"
                className="opt-row"
                aria-pressed={place.id === selectedId}
                onClick={() => choose(place)}
              >
                <b>{place.name}</b>
                <span>{place.formatted_address}</span>
              </button>
            ))}

          {adding ? (
            <PlaceAddForm onCreated={choose} />
          ) : (
            <button type="button" className="ghost dashed" onClick={() => setAdding(true)}>
              + Dodaj nowe miejsce
            </button>
          )}

          <button type="button" className="ghost" onClick={() => choose(null)}>
            Bez lokalizacji
          </button>
        </div>
      </div>
    </span>,
    document.body,
  );
}

function PlaceAddForm({ onCreated }: { onCreated: (location: LocationResponse) => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<PlaceInput>({ name: "", address: "" });
  const [touched, setTouched] = useState({ name: false, address: false });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const errors = validatePlace(place);
  const invalid = Object.keys(errors).length > 0;
  const nameError = touched.name ? errors.name : undefined;
  const addressError = touched.address ? errors.address : undefined;

  async function submit() {
    if (busy) return;
    if (invalid) {
      setTouched({ name: true, address: true });
      return;
    }
    setBusy(true);
    setFailure(null);
    const result = await createLocation(place);
    if (result.ok) {
      onCreated(result.value);
      return;
    }
    setBusy(false);
    setFailure(result.error);
  }

  return (
    <div
      className="form"
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div>
        <label className="label" htmlFor="place-name">
          Nazwa
        </label>
        <input
          ref={nameRef}
          id="place-name"
          className="input"
          value={place.name}
          maxLength={PLACE_NAME_MAX}
          placeholder="Np. Park Jordana"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "place-name-error" : undefined}
          onChange={(e) => setPlace((p) => ({ ...p, name: e.target.value }))}
          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
        />
        {nameError && (
          <p id="place-name-error" className="err" role="alert">
            {nameError}
          </p>
        )}
      </div>
      <div>
        <label className="label" htmlFor="place-address">
          Adres
        </label>
        <input
          id="place-address"
          className="input"
          value={place.address}
          maxLength={PLACE_ADDRESS_MAX}
          placeholder="Np. al. 3 Maja 11, Kraków"
          aria-invalid={addressError ? true : undefined}
          aria-describedby={addressError ? "place-address-error" : undefined}
          onChange={(e) => setPlace((p) => ({ ...p, address: e.target.value }))}
          onBlur={() => setTouched((t) => ({ ...t, address: true }))}
        />
        {addressError && (
          <p id="place-address-error" className="err" role="alert">
            {addressError}
          </p>
        )}
      </div>
      {failure && (
        <p className="alertbox" role="alert">
          {failure}
        </p>
      )}
      <div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void submit()}
          aria-disabled={!busy && invalid ? true : undefined}
          aria-describedby={invalid ? PLACE_HINT_ID : undefined}
        >
          {busy ? "Dodawanie…" : "Dodaj miejsce"}
        </button>
        {invalid && (
          <p id={PLACE_HINT_ID} className="hint">
            {MESSAGES.placeInvalid}
          </p>
        )}
      </div>
    </div>
  );
}
