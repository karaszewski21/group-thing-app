import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { LocalitySearchResult } from "../../api/localities";
import type { Locality } from "../../api/locations";
import { useLocalitySearch } from "../../hooks/useLocalitySearch";
import { localityDetail } from "../../utils/locationLabel";
import { LOCATION_ERROR_CLASS, LOCATION_INPUT_CLASS, LOCATION_LABEL_CLASS } from "./LocationAddForm";

/* ------------------------------------------------------------------ */
/*  "Lokalizacja *": a TERYT locality picked by name or postal code    */
/*  from the server's dictionary (`useLocalitySearch`).                */
/* ------------------------------------------------------------------ */

const RESULT_LIMIT = 8;
const MIN_QUERY_LENGTH = 2;
export const LOCALITY_PICK_ERROR = "Wybierz miejscowość z listy";

function optionDetail(result: LocalitySearchResult): string {
  const postal = result.postal_code ? `${result.postal_code} · ` : "";
  const town = result.kind === "TOWN" ? " · miasto" : "";
  return `${postal}${localityDetail(result)}${town}`;
}

function toLocality({ id, name, kind, gmina, powiat, voivodeship }: LocalitySearchResult): Locality {
  return { id, name, kind, gmina, powiat, voivodeship };
}

/** Controlled by the host form: `value` is the chosen locality, `invalid`
 * asks for the pick error (a save attempted without a locality). Typed text
 * left without a pick shows the same error once the field loses focus. */
export function LocalityCombobox({
  idPrefix,
  value,
  onChange,
  invalid = false,
}: {
  idPrefix: string;
  value: Locality | null;
  onChange: (locality: Locality | null) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [unpicked, setUnpicked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = useRef(false);
  const { data: results, total, loading, error: searchError } = useLocalitySearch(text, RESULT_LIMIT);
  // New results invalidate the highlighted index.
  const [shownResults, setShownResults] = useState(results);
  if (shownResults !== results) {
    setShownResults(results);
    setActive(-1);
  }

  const inputId = `${idPrefix}-locality`;
  const labelId = `${idPrefix}-locality-label`;
  const hintId = `${idPrefix}-locality-hint`;
  const errorId = `${idPrefix}-locality-error`;
  const listboxId = `${idPrefix}-locality-listbox`;
  const optionId = (index: number) => `${idPrefix}-locality-opt-${index}`;
  const expanded = open && results.length > 0;
  const more = total - results.length;
  const showError = value === null && (invalid || unpicked);
  const noResults =
    open && text.trim().length >= MIN_QUERY_LENGTH && !loading && !searchError && results.length === 0;
  const status = noResults
    ? "Brak wyników — sprawdź pisownię albo wpisz kod pocztowy"
    : expanded && more > 0
      ? `… i ${more} więcej — doprecyzuj wpis`
      : "";

  function pick(result: LocalitySearchResult) {
    setOpen(false);
    setActive(-1);
    setText("");
    setUnpicked(false);
    onChange(toLocality(result));
  }

  // "zmień" swaps the chip for the input; focus follows to the input.
  useEffect(() => {
    if (!focusInput.current || value) return;
    focusInput.current = false;
    inputRef.current?.focus();
  }, [value]);

  function change() {
    focusInput.current = true;
    onChange(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (!expanded) return;
      // Close only the listbox; a host dialog must not see this Esc.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const count = results.length;
      if (count === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setOpen(true);
      setActive((index) => (index < 0 ? (step > 0 ? 0 : count - 1) : (index + step + count) % count));
      return;
    }
    if (event.key === "Enter") {
      // Never submits a host form: Enter only picks the highlighted option.
      event.preventDefault();
      const option = expanded ? results[active] : undefined;
      if (option) pick(option);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label id={labelId} htmlFor={inputId} className={LOCATION_LABEL_CLASS}>
        Lokalizacja{" "}
        <span aria-hidden="true" className="text-danger">
          *
        </span>
      </label>
      {value ? (
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex items-center justify-between gap-2 rounded-xl border-[1.5px] border-mint bg-mint-soft px-3 py-2 text-[13.5px]"
        >
          <div className="min-w-0">
            <span className="block font-extrabold text-ink">{value.name}</span>
            <span className="block text-[12px] text-ink-soft">{localityDetail(value)}</span>
          </div>
          <button
            type="button"
            onClick={change}
            aria-label={`Zmień miejscowość ${value.name}`}
            className="flex-none rounded-[9px] px-1.5 py-1 text-[12px] font-extrabold text-ink-soft hover:text-ink"
          >
            zmień
          </button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-required="true"
            aria-expanded={expanded}
            aria-controls={expanded ? listboxId : undefined}
            aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
            aria-invalid={showError || undefined}
            aria-describedby={showError ? `${errorId} ${hintId}` : hintId}
            autoComplete="off"
            placeholder="Miejscowość lub kod pocztowy"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setActive(-1);
              setUnpicked(false);
            }}
            onBlur={() => {
              setOpen(false);
              setActive(-1);
              if (text.trim()) setUnpicked(true);
            }}
            onKeyDown={handleKeyDown}
            className={`${LOCATION_INPUT_CLASS} ${showError ? "border-danger" : ""}`}
          />
          {expanded && (
            <div className="overflow-hidden rounded-xl border-[1.5px] border-line-strong bg-paper">
              <ul id={listboxId} role="listbox" aria-label="Podpowiedzi miejscowości">
                {results.map((result, index) => (
                  <li
                    key={`${result.id}-${result.postal_code ?? ""}`}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(result)}
                    className={`cursor-pointer border-b border-line px-3 py-2 text-[13.5px] last:border-b-0 ${
                      index === active ? "bg-mint-soft" : ""
                    }`}
                  >
                    <span className="block font-extrabold text-ink">{result.name}</span>
                    <span className="block text-[12px] text-ink-soft">{optionDetail(result)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Always rendered, so screen readers announce its changes. */}
          <p role="status" className="px-1 text-[12.5px] text-ink-soft empty:sr-only">
            {status}
          </p>
          {showError && (
            <p id={errorId} role="alert" className={LOCATION_ERROR_CLASS}>
              {LOCALITY_PICK_ERROR}
            </p>
          )}
          {searchError && (
            <p role="alert" className={LOCATION_ERROR_CLASS}>
              {searchError}
            </p>
          )}
          <p id={hintId} className="text-[12.5px] text-ink-soft">
            Np. „Kęty”, „Nowa Wieś” albo „32-650”.
          </p>
        </>
      )}
    </div>
  );
}
