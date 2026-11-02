import { useRef, useState } from "react";
import type { LocationResponse } from "../domain";
import { LocationSheet } from "./LocationSheet";

const LABEL_ID = "event-location-label";
const BUTTON_ID = "event-location-button";

interface LocationFieldProps {
  value: LocationResponse | null;
  onChange: (location: LocationResponse | null) => void;
}

/** "Lokalizacja" row: shows the chosen place (or a placeholder) and opens the picker sheet. */
export function LocationField({ value, onChange }: LocationFieldProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div>
      <span className="label" id={LABEL_ID}>
        Lokalizacja <span className="opt">opcjonalnie</span>
      </span>
      <button
        ref={triggerRef}
        id={BUTTON_ID}
        type="button"
        className="loc"
        aria-labelledby={`${LABEL_ID} ${BUTTON_ID}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {value ? (
          <>
            <span>
              <b>{value.name}</b>
              <span>{value.formatted_address}</span>
            </span>
            <span>
              Zmień <span aria-hidden="true">›</span>
            </span>
          </>
        ) : (
          <>
            <span className="ph">Wybierz lub dodaj miejsce</span>
            <span aria-hidden="true">›</span>
          </>
        )}
      </button>
      {open && <LocationSheet selectedId={value?.id ?? null} onSelect={onChange} onClose={close} />}
    </div>
  );
}
