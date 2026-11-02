import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { LocationResponse } from "../../api/locations";
import { useMyLocations } from "../../hooks/useMyLocations";
import { placeCreatePath, type PickedLocationState } from "../../utils/appHelpers";
import { LOCATION_ERROR_CLASS, LOCATION_INPUT_CLASS, LocationAddForm } from "./LocationAddForm";

/* ------------------------------------------------------------------ */
/*  Compact place select for group/term/event forms: the caller's      */
/*  saved places plus a "+" that opens /places/new, which comes back   */
/*  here with the new place selected. Inside a modal (whose typed      */
/*  values would not survive leaving the page) the "+" expands an      */
/*  inline add form instead. Managing places lives on /places.         */
/* ------------------------------------------------------------------ */

/** The stored place of a group or term, kept as an extra option when it is not
 * among the caller's active places (soft-deleted, or another organizer's). */
const ADD_BUTTON =
  "flex h-11 w-11 flex-none items-center justify-center rounded-xl border-[1.5px] border-line bg-cream text-lg font-extrabold text-ink transition-colors hover:bg-mint-soft";

export interface FallbackLocation {
  id: string;
  name: string;
  formatted_address: string;
  notes: string | null;
  deleted_at: string | null;
}

interface LocationPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  /** `aria-label` of the select — the host field's label. */
  label: string;
  noneLabel: string;
  idPrefix: string;
  fallbackLocation?: FallbackLocation | null;
  helperText?: string;
  /** "page" (default): "+" goes to /places/new; "inline": an add form expands here. */
  addMode?: "page" | "inline";
}

export function LocationPicker({
  value,
  onChange,
  label,
  noneLabel,
  idPrefix,
  fallbackLocation,
  helperText,
  addMode = "page",
}: LocationPickerProps) {
  const { data: locations, loading, error, create } = useMyLocations();
  const [adding, setAdding] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addFormId = `${idPrefix}-add-location`;
  const location = useLocation();
  const navigate = useNavigate();
  const picked = (location.state as PickedLocationState | null)?.pickedLocation;
  const returnTo = location.pathname + location.search;

  const handledPick = useRef<PickedLocationState["pickedLocation"] | null>(null);

  // Back from /places/new: select the new place once (a re-render before the
  // state is dropped must not select it again), then drop the state so a
  // refresh doesn't either.
  useEffect(() => {
    if (picked?.picker !== idPrefix || handledPick.current === picked) return;
    handledPick.current = picked;
    onChange(picked.locationId);
    navigate(returnTo, { replace: true, state: null });
    selectRef.current?.focus();
  }, [picked, idPrefix, onChange, navigate, returnTo]);

  if (loading) {
    return <p className="text-[12.5px] text-ink-soft">Ładowanie miejsc…</p>;
  }

  const fallback =
    value !== null && fallbackLocation?.id === value && !locations.some((l) => l.id === value)
      ? fallbackLocation
      : null;
  const selected: FallbackLocation | undefined = locations.find((l) => l.id === value) ?? fallback ?? undefined;

  function handleSaved(location: LocationResponse) {
    setAdding(false);
    onChange(location.id);
    selectRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className={LOCATION_ERROR_CLASS}>
          {error}
        </p>
      )}
      {helperText && <p className="text-[12.5px] text-ink-soft">{helperText}</p>}
      <div className="flex items-center gap-2">
        <select
          ref={selectRef}
          aria-label={label}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className={`${LOCATION_INPUT_CLASS} min-w-0 flex-1`}
        >
          <option value="">{noneLabel}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
          {fallback && (
            <option value={fallback.id}>
              {fallback.deleted_at === null ? fallback.name : `${fallback.name} (usunięte)`}
            </option>
          )}
        </select>
        {addMode === "page" ? (
          <Link to={placeCreatePath(returnTo, idPrefix)} aria-label="Dodaj nowe miejsce" className={ADD_BUTTON}>
            +
          </Link>
        ) : (
          <button
            ref={addButtonRef}
            type="button"
            aria-label="Dodaj nowe miejsce"
            aria-expanded={adding}
            aria-controls={adding ? addFormId : undefined}
            onClick={() => setAdding((open) => !open)}
            className={ADD_BUTTON}
          >
            {adding ? "–" : "+"}
          </button>
        )}
      </div>
      {selected && <p className="text-[12.5px] text-ink-soft">{selected.formatted_address}</p>}
      {adding && (
        <div id={addFormId} className="rounded-xl border-[1.5px] border-line p-2.5">
          <LocationAddForm
            idPrefix={idPrefix}
            create={create}
            onSaved={handleSaved}
            onCancel={() => {
              setAdding(false);
              addButtonRef.current?.focus();
            }}
          />
        </div>
      )}
    </div>
  );
}
