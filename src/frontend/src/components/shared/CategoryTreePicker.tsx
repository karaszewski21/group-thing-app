import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Category } from "../../api/categories";
import { useCategories } from "../../hooks/useCategories";
import {
  CATEGORY_PATH_SEPARATOR,
  buildCategoryIndex,
  categoryPathNames,
  foldCategoryText,
  isLeaf,
  searchCategories,
  type CategoryIndex,
} from "../../utils/categoryTree";
import { pluralPl } from "../../utils/plural";
import { INPUT_CLASS } from "./appComponents";
import { SearchIcon } from "./appIcons";
import { ModalSheet } from "./ModalSheet";

/** `leaf`: only leaves select (items, needed items). `any`: every node selects (admin parent). */
export type CategoryPickerMode = "leaf" | "any";

export interface CategoryTreePickerProps {
  /** Id of the host's visible label `<span>`; the trigger is never wrapped in a `<label>`. */
  labelledBy: string;
  /** Selected category id; `null` or `""` means none. */
  value: string | null;
  /** Receives the chosen id, or `null` from "Kategoria główna (brak)". */
  onChange: (id: string | null) => void;
  mode?: CategoryPickerMode;
  /** `any` mode only: offer "Kategoria główna (brak)", which clears the value. */
  allowRoot?: boolean;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

const SHEET_TITLE = "Wybierz kategorię";
const MAX_RESULTS = 50;
const ROOT_LABEL = "Kategoria główna (brak)";
const CHEVRON = "›";

const TEXT_BTN_CLASS = "rounded-md font-bold text-ink-soft hover:text-ink";
const ROW_CLASS =
  "flex w-full items-center justify-between gap-3 border-b border-line px-1 py-3 text-left text-[14.5px] text-ink hover:bg-cream";

/** The picker's sheet events must not reach a host handler (a form's Enter/Esc, an outer sheet's Tab trap). */
function stop(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * Category field: a trigger button plus a portaled search + drill-down sheet.
 * The trigger subscribes to `useCategories` once and hands the index to the
 * sheet, so opening it never refetches.
 */
export function CategoryTreePicker({
  labelledBy,
  value,
  onChange,
  mode = "leaf",
  allowRoot = false,
  placeholder = SHEET_TITLE,
  disabled = false,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: CategoryTreePickerProps) {
  const generatedId = useId();
  const triggerId = id ?? `${generatedId}-trigger`;
  const { data, loading, error } = useCategories();
  const index = useMemo(() => buildCategoryIndex(data), [data]);
  const [open, setOpen] = useState(false);

  const selected = value ? index.byId.get(value) : undefined;
  const ancestors = selected ? categoryPathNames(index, selected.id).slice(0, -1) : [];

  function select(next: string | null) {
    setOpen(false);
    onChange(next);
  }

  return (
    <>
      <button
        type="button"
        id={triggerId}
        aria-labelledby={`${labelledBy} ${triggerId}`}
        aria-haspopup="dialog"
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`${INPUT_CLASS} flex w-full items-center justify-between gap-2 text-left aria-[invalid=true]:border-danger disabled:opacity-60`}
      >
        {selected ? (
          <span className="min-w-0">
            {ancestors.length > 0 && (
              <>
                <span className="block text-[12px] text-ink-soft">
                  {ancestors.join(CATEGORY_PATH_SEPARATOR)} {CHEVRON}
                </span>{" "}
              </>
            )}
            <span className="block font-bold">{selected.name}</span>
          </span>
        ) : (
          <span className="text-ink-soft">{placeholder}</span>
        )}
        <span aria-hidden="true" className="text-base text-ink-soft">
          {CHEVRON}
        </span>
      </button>
      {open && (
        // Portaled out of the host <form>/<label>; React events still bubble, so the wrapper stops them.
        <span className="contents" onClick={stop} onKeyDown={stop}>
          {createPortal(
            <CategoryTreeSheet
              idPrefix={generatedId}
              index={index}
              loading={loading}
              error={error}
              value={value || null}
              mode={mode}
              allowRoot={mode === "any" && allowRoot}
              onSelect={select}
              onClose={() => setOpen(false)}
            />,
            document.body,
          )}
        </span>
      )}
    </>
  );
}

function CategoryTreeSheet({
  idPrefix,
  index,
  loading,
  error,
  value,
  mode,
  allowRoot,
  onSelect,
  onClose,
}: {
  idPrefix: string;
  index: CategoryIndex;
  loading: boolean;
  error: string | null;
  value: string | null;
  mode: CategoryPickerMode;
  allowRoot: boolean;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  // `undefined` until the user navigates: the selected node's parent level, even if the tree loads after opening.
  const [chosenLevel, setLevel] = useState<string | null | undefined>(undefined);
  const level = chosenLevel !== undefined ? chosenLevel : value ? (index.byId.get(value)?.parent_id ?? null) : null;
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const focusFirstRow = useRef(false);
  const listboxId = `${idPrefix}-results`;
  const optionId = (i: number) => `${idPrefix}-result-${i}`;

  const needle = foldCategoryText(query.trim());
  const search = useMemo(() => searchCategories(index, query), [index, query]);
  const searching = needle !== "";
  const shown = search.results.slice(0, MAX_RESULTS);
  const showResults = searching && shown.length > 0;

  const current = level ? index.byId.get(level) : undefined;
  const crumbs = current ? categoryPathNames(index, current.id) : [];
  const rows = index.childrenOf(current?.id ?? null);

  useEffect(() => {
    if (!focusFirstRow.current) return;
    focusFirstRow.current = false;
    listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [level]);

  function goTo(next: string | null) {
    focusFirstRow.current = true;
    setLevel(next);
  }

  /** Ancestor id `depth` levels below the root on the current path. */
  function ancestorAt(depth: number): string | null {
    let node = current;
    for (let i = crumbs.length - 1; i > depth && node; i--) {
      node = node.parent_id ? index.byId.get(node.parent_id) : undefined;
    }
    return node?.id ?? null;
  }

  function changeQuery(next: string) {
    setQuery(next);
    setActive(-1);
  }

  function chooseResult(category: Category) {
    if (mode === "leaf" && !isLeaf(index, category.id)) {
      changeQuery("");
      setLevel(category.id);
      return;
    }
    onSelect(category.id);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (query === "") return;
      // Clear only the search; the sheet must not see this Esc.
      event.preventDefault();
      event.stopPropagation();
      changeQuery("");
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const count = shown.length;
      if (!showResults) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : count - 1) : (i + step + count) % count));
      return;
    }
    if (event.key === "Enter") {
      // Never an implicit form submission.
      event.preventDefault();
      if (showResults && active >= 0 && active < shown.length) chooseResult(shown[active].category);
    }
  }

  return (
    <ModalSheet title={SHEET_TITLE} onClose={onClose}>
      <label className="flex items-center gap-2 rounded-xl border-[1.5px] border-line bg-cream px-3 py-2.5 focus-within:border-mint">
        <SearchIcon c="currentColor" />
        <input
          role="combobox"
          aria-label="Szukaj kategorii"
          aria-autocomplete="list"
          aria-expanded={showResults}
          aria-controls={showResults ? listboxId : undefined}
          aria-activedescendant={showResults && active >= 0 ? optionId(active) : undefined}
          placeholder="Szukaj kategorii, np. „buty”"
          value={query}
          onChange={(e) => changeQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-soft"
        />
      </label>

      {error && (
        <p role="alert" className="mt-3 text-[12.5px] font-semibold text-danger">
          {error}
        </p>
      )}
      {loading && <p className="mt-3 text-[13px] text-ink-soft">Ładowanie kategorii…</p>}

      {searching ? (
        <>
          <p aria-live="polite" className="mb-0.5 mt-2.5 text-[12px] text-ink-soft">
            {search.total} {pluralPl(search.total, "wynik", "wyniki", "wyników")}
          </p>
          {search.total > MAX_RESULTS && (
            <p className="text-[12px] text-ink-soft">
              Pokazano {MAX_RESULTS} z {search.total} — zawęź wyszukiwanie
            </p>
          )}
          {showResults && (
            <ul id={listboxId} role="listbox" aria-label="Wyniki wyszukiwania" className="flex flex-col">
              {shown.map(({ category, path }, i) => (
                <li
                  key={category.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseResult(category)}
                  className={`flex cursor-pointer items-center justify-between gap-3 border-b border-line px-1 py-3 text-[14.5px] ${
                    i === active ? "rounded-[10px] px-2.5 outline-2 outline-mint" : ""
                  }`}
                >
                  <span className="min-w-0">
                    {path.length > 0 && (
                      <>
                        <span className="block text-[12px] text-ink-soft">
                          {path.join(CATEGORY_PATH_SEPARATOR)} {CHEVRON}
                        </span>{" "}
                      </>
                    )}
                    <span className="block font-bold text-ink">{highlight(category.name, needle)}</span>
                  </span>
                  {!isLeaf(index, category.id) && (
                    <span aria-hidden="true" className="text-base text-ink-soft">
                      {CHEVRON}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {current && (
            <button
              type="button"
              onClick={() => goTo(current.parent_id)}
              className={`${TEXT_BTN_CLASS} mb-1 mt-3 text-[13px] text-mint hover:text-mint`}
            >
              ‹ Wstecz
            </button>
          )}
          <nav aria-label="Ścieżka" className="mb-2 mt-3.5 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-soft">
            {current ? (
              <button type="button" onClick={() => goTo(null)} className={TEXT_BTN_CLASS}>
                Wszystkie
              </button>
            ) : (
              <b className="text-ink">Wszystkie</b>
            )}
            {crumbs.map((name, depth) => (
              <span key={depth} className="flex items-center gap-1">
                <span aria-hidden="true">{CHEVRON}</span>
                {depth === crumbs.length - 1 ? (
                  <b className="text-ink">{name}</b>
                ) : (
                  <button type="button" onClick={() => goTo(ancestorAt(depth))} className={TEXT_BTN_CLASS}>
                    {name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          {(allowRoot || (mode === "any" && current)) && (
            <div className="mb-2 flex flex-wrap gap-2">
              {mode === "any" && current && (
                <button
                  type="button"
                  onClick={() => onSelect(current.id)}
                  className="rounded-[10px] bg-mint px-3 py-2 text-[13px] font-extrabold text-white"
                >
                  Wybierz „{current.name}”
                </button>
              )}
              {allowRoot && (
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className="rounded-[10px] border border-line px-3 py-2 text-[13px] font-extrabold text-ink-soft"
                >
                  {ROOT_LABEL}
                </button>
              )}
            </div>
          )}

          <ul ref={listRef} aria-label={current?.name ?? "Wszystkie"} className="flex flex-col">
            {rows.map((category) => {
              const leaf = isLeaf(index, category.id);
              return (
                <li key={category.id}>
                  <button
                    type="button"
                    aria-current={category.id === value || undefined}
                    onClick={() => (leaf ? onSelect(category.id) : goTo(category.id))}
                    className={`${ROW_CLASS} ${category.id === value ? "rounded-[10px] bg-primary-soft px-2.5 font-bold" : ""}`}
                  >
                    <span>{category.name}</span>
                    {leaf ? (
                      <span aria-hidden="true" className="text-[12px] text-ink-soft">
                        wybierz
                      </span>
                    ) : (
                      <span aria-hidden="true" className="text-base text-ink-soft">
                        {CHEVRON}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </ModalSheet>
  );
}

/** Wraps the first diacritic-insensitive match of `needle` in `<mark>`. */
function highlight(name: string, needle: string): ReactNode {
  if (!needle) return name;
  const chars = Array.from(name);
  const offsets: number[] = [];
  let folded = "";
  for (const char of chars) {
    offsets.push(folded.length);
    folded += foldCategoryText(char);
  }
  const at = folded.indexOf(needle);
  if (at < 0) return name;
  const startChar = offsets.findLastIndex((offset) => offset <= at);
  const endIndex = offsets.findIndex((offset) => offset >= at + needle.length);
  const endChar = endIndex < 0 ? chars.length : endIndex;
  return (
    <>
      {chars.slice(0, startChar).join("")}
      <mark className="rounded-sm bg-primary-soft text-ink">{chars.slice(startChar, endChar).join("")}</mark>
      {chars.slice(endChar).join("")}
    </>
  );
}
