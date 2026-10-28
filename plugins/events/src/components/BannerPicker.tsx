import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent } from "react";
import { BANNER_MIME_TYPES, MESSAGES, validateBanner } from "../domain";

const ERROR_ID = "event-banner-error";

interface BannerPickerProps {
  value: File | null;
  onChange: (file: File | null) => void;
}

/** Optional banner: a drop zone when empty, a local preview with "Zmień"/"Usuń" once chosen.
 * An invalid file is rejected here and the previous choice is kept; its error shows until
 * the next choice, removal, or focus moving on to another field. */
export function BannerPicker({ value, onChange }: BannerPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLButtonElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  // The focused control unmounts when the picker switches between drop zone and preview.
  const moveFocus = useRef(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (value ? changeRef : dropRef).current?.focus();
  }, [value]);

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const invalid = validateBanner(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    moveFocus.current = value === null;
    onChange(file);
  }

  // A null relatedTarget is the native file dialog taking focus, not the user moving on.
  function leave(e: FocusEvent<HTMLDivElement>) {
    if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setError(null);
  }

  function remove() {
    setError(null);
    moveFocus.current = true;
    onChange(null);
  }

  const describedBy = error ? ERROR_ID : undefined;

  return (
    <div onBlur={leave}>
      <span className="label">
        Baner <span className="opt">opcjonalnie</span>
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={BANNER_MIME_TYPES.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={choose}
      />
      {value ? (
        <div className="banner-img">
          {preview && <img src={preview} alt="Podgląd banera" />}
          <div className="acts">
            <button
              ref={changeRef}
              type="button"
              className="chip"
              aria-describedby={describedBy}
              onClick={() => inputRef.current?.click()}
            >
              Zmień{" "}
              <span className="sr-only">baner</span>
            </button>
            <button type="button" className="chip" onClick={remove}>
              Usuń{" "}
              <span className="sr-only">baner</span>
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={dropRef}
          type="button"
          className="banner-drop"
          aria-describedby={describedBy}
          onClick={() => inputRef.current?.click()}
        >
          <b>+ Dodaj baner</b>
          <span>{MESSAGES.bannerHint}</span>
        </button>
      )}
      {error && (
        <p id={ERROR_ID} className="err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
