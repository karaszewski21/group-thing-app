import { useEffect, useRef } from "react";
import { Link, useAppPathname, useAppSearch, useNavigationState } from "../../routing/navigation";
import { useMyLocations } from "../../hooks/useMyLocations";
import { placeCreatePath, type PickedLocationState } from "../../utils/appHelpers";
import { localityDetail } from "../../utils/locationLabel";
import { INPUT_CLASS } from "./appComponents";

/* ------------------------------------------------------------------ */
/*  Compact place select for item/group/term/event forms: the caller's */
/*  saved places plus a "+" that opens /places/new (replacing this     */
/*  history entry), which comes back here — again replacing — with the */
/*  new place selected. Hosts keep their typed values in a draft that  */
/*  survives the trip. Managing places lives on /places.               */
/* ------------------------------------------------------------------ */

const ADD_BUTTON =
  "flex h-11 w-11 flex-none items-center justify-center rounded-xl border-[1.5px] border-line bg-cream text-lg font-extrabold text-ink transition-colors hover:bg-mint-soft";
const NOTE_CLASS = "text-[12.5px] text-ink-soft";
const ERROR_CLASS = "text-[12.5px] font-semibold text-danger";

/** The stored place of a group or term, kept as an extra option when it is not
 * among the caller's active places (soft-deleted, or another organizer's). */
export interface FallbackLocation {
  id: string;
  label: string;
  deleted_at: string | null;
}

interface LocationPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  /** `aria-label` of the select — the host field's label. */
  label: string;
  idPrefix: string;
  /** The "no place" option; ignored when `required`. */
  noneLabel?: string;
  /** No "no place" option: a null value shows the "Wybierz miejsce" placeholder. */
  required?: boolean;
  /** The host's failed validation: marks the select and shows `errorText`. */
  invalid?: boolean;
  errorText?: string;
  fallbackLocation?: FallbackLocation | null;
  helperText?: string;
  /** Runs before "+" navigates to /places/new (e.g. to close a modal). */
  onAddClick?: () => void;
}

export function LocationPicker({
  value,
  onChange,
  label,
  idPrefix,
  noneLabel = "Brak miejsca",
  required = false,
  invalid = false,
  errorText = "Wybierz lokalizację",
  fallbackLocation,
  helperText,
  onAddClick,
}: LocationPickerProps) {
  const { data: locations, loading, error } = useMyLocations();
  const selectRef = useRef<HTMLSelectElement>(null);
  const picked = useNavigationState<PickedLocationState>()?.pickedLocation;
  const returnTo = useAppPathname() + useAppSearch();
  const errorId = `${idPrefix}-location-error`;

  const handledPick = useRef<PickedLocationState["pickedLocation"] | null>(null);

  // Back from /places/new: select the new place once (the state is read once,
  // so a refresh doesn’t select it again). A cancel hands back `null` and
  // leaves the value as it was.
  useEffect(() => {
    if (picked?.picker !== idPrefix || handledPick.current === picked) return;
    handledPick.current = picked;
    if (picked.locationId === null) return;
    onChange(picked.locationId);
    selectRef.current?.focus();
  }, [picked, idPrefix, onChange]);

  if (loading) {
    return <p className={NOTE_CLASS}>Ładowanie miejsc…</p>;
  }

  const fallback =
    value !== null && fallbackLocation?.id === value && !locations.some((l) => l.id === value)
      ? fallbackLocation
      : null;
  const own = locations.find((l) => l.id === value);
  const detail = own ? (own.formatted_address ?? localityDetail(own.locality)) : null;
  const empty = required && locations.length === 0 && fallback === null;
  const showError = invalid;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className={ERROR_CLASS}>
          {error}
        </p>
      )}
      {helperText && <p className={NOTE_CLASS}>{helperText}</p>}
      <div className="flex items-center gap-2">
        <select
          ref={selectRef}
          aria-label={label}
          aria-invalid={showError || undefined}
          aria-describedby={showError ? errorId : undefined}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className={`${INPUT_CLASS} w-full min-w-0 flex-1 ${showError ? "border-danger" : ""}`}
        >
          {required ? (
            <option value="" disabled>
              {empty ? "Nie masz jeszcze miejsc" : "Wybierz miejsce"}
            </option>
          ) : (
            <option value="">{noneLabel}</option>
          )}
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
          {fallback && (
            <option value={fallback.id}>
              {fallback.deleted_at === null ? fallback.label : `${fallback.label} (usunięte)`}
            </option>
          )}
        </select>
        <Link
          to={placeCreatePath(returnTo, idPrefix)}
          replace
          onClick={() => onAddClick?.()}
          aria-label="Dodaj nowe miejsce"
          className={ADD_BUTTON}
        >
          +
        </Link>
      </div>
      {detail && <p className={NOTE_CLASS}>{detail}</p>}
      {empty && <p className={NOTE_CLASS}>Dodaj miejsce przyciskiem „+”. Wrócisz tu z zachowanymi danymi i zdjęciami.</p>}
      {showError && (
        <p id={errorId} role="alert" className={ERROR_CLASS}>
          {errorText}
        </p>
      )}
    </div>
  );
}
