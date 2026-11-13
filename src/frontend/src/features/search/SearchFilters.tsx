import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Category } from "../../api/categories";
import type { ItemCondition } from "../../api/inventories";
import type { SearchFilters as SearchFilterValues, SearchMode, SearchScope } from "../../api/search";
import { ModalSheet } from "../../components/shared/ModalSheet";
import { nextIndex } from "../../components/shared/rovingIndex";
import { useCategories } from "../../hooks/useCategories";
import { useClientValue } from "../../lib/useClientValue";
import { ITEM_MODE_TO_RESERVATION_TYPE, ITEM_MODES } from "../../utils/appHelpers";
import { buildCategoryIndex, type CategoryIndex } from "../../utils/categoryTree";
import dayjs from "../../utils/dayjs";
import { CONDITION_LABELS } from "../../utils/productCategory";
import { SEGMENT_CLASS, segmentTone } from "./segmentStyles";

const SCOPES: { id: SearchScope; label: string }[] = [
  { id: "mine", label: "Moje grupy" },
  { id: "all", label: "Wszędzie" },
];

const CONDITIONS = Object.keys(CONDITION_LABELS) as ItemCondition[];

const FOCUS_CLASS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const CHIP_CLASS = `min-h-11 rounded-full border-[1.5px] px-3.5 text-sm font-bold ${FOCUS_CLASS}`;
const TILE_CLASS = `flex h-14 flex-none items-center rounded-2xl border-[1.5px] px-4 text-sm font-extrabold whitespace-nowrap ${FOCUS_CLASS}`;
const SECTION_TITLE_CLASS = "text-[13px] font-extrabold uppercase tracking-wide text-ink-soft";
const chipTone = (set: boolean) => (set ? "border-primary bg-primary-soft text-ink" : "border-line bg-paper text-ink");

interface SearchFiltersProps {
  mode: SearchMode;
  filters: SearchFilterValues;
  /** „Do” is earlier than „Od”: an inline error at „Do”. */
  dateRangeInvalid: boolean;
  onChange: (patch: Partial<SearchFilterValues>) => void;
  /** `null` for a guest, who always searches everywhere and gets no control. */
  scope: SearchScope | null;
  onScopeChange: (scope: SearchScope) => void;
}

/** The searched mode's filters. Items: a row of main-category tiles, and a
 * „Filtry” sheet with the scope, a subcategory, Stan and Oddam/Zamienię.
 * Meetings: a „Filtry” sheet with the scope, Od (today when unset) and Do. */
export function SearchFilters({ mode, filters, dateRangeInvalid, onChange, scope, onScopeChange }: SearchFiltersProps) {
  return mode === "items" ? (
    <ItemFilters filters={filters} onChange={onChange} scope={scope} onScopeChange={onScopeChange} />
  ) : (
    <MeetingFilters
      filters={filters}
      dateRangeInvalid={dateRangeInvalid}
      onChange={onChange}
      scope={scope}
      onScopeChange={onScopeChange}
    />
  );
}

type ItemFiltersProps = Omit<SearchFiltersProps, "mode" | "dateRangeInvalid">;
type MeetingFiltersProps = Omit<SearchFiltersProps, "mode">;

/** „Filtry” with the count of set refinements, and their labels beside it. */
function FiltersButton({ refinements, onOpen }: { refinements: string[]; onOpen: () => void }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={onOpen}
        className={`${CHIP_CLASS} flex flex-none items-center gap-2 ${chipTone(refinements.length > 0)}`}
      >
        Filtry
        {refinements.length > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-on-primary">
            {refinements.length}
          </span>
        )}
      </button>
      <span aria-hidden="true" className="min-w-0 truncate text-sm text-ink-soft">
        {refinements.join(" · ")}
      </span>
    </div>
  );
}

function ScopeSection({ scope, onSelect }: { scope: SearchScope; onSelect: (scope: SearchScope) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className={SECTION_TITLE_CLASS}>Gdzie szukać</h4>
      <ScopeToggle scope={scope} onSelect={onSelect} />
    </div>
  );
}

function SheetActions({ onClear, onClose }: { onClear: () => void; onClose: () => void }) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={onClear}
        className={`min-h-11 flex-1 rounded-full border-[1.5px] border-line bg-paper text-[15px] font-extrabold text-ink ${FOCUS_CLASS}`}
      >
        Wyczyść
      </button>
      <button
        type="button"
        onClick={onClose}
        className={`min-h-11 flex-1 rounded-full bg-primary text-[15px] font-extrabold text-on-primary ${FOCUS_CLASS}`}
      >
        Pokaż wyniki
      </button>
    </div>
  );
}

/** The nodes from the root down to `id`, inclusive; empty for an unknown id. */
function categoryPath(index: CategoryIndex, id: string | null): Category[] {
  const path: Category[] = [];
  let node = id ? index.byId.get(id) : undefined;
  while (node) {
    path.unshift(node);
    node = node.parent_id ? index.byId.get(node.parent_id) : undefined;
  }
  return path;
}

function ItemFilters({ filters, onChange, scope, onScopeChange }: ItemFiltersProps) {
  const { data } = useCategories();
  const index = useMemo(() => buildCategoryIndex(data), [data]);
  const [open, setOpen] = useState(false);

  const path = categoryPath(index, filters.category);
  const root = path.at(0);
  const subcategory = path.length > 1 ? path[path.length - 1] : undefined;
  const offerMode = ITEM_MODES.find((itemMode) => ITEM_MODE_TO_RESERVATION_TYPE[itemMode] === filters.offer_type);
  const refinements = [
    scope === "mine" && "Moje grupy",
    subcategory?.name,
    filters.condition && CONDITION_LABELS[filters.condition],
    offerMode,
  ].filter((label): label is string => Boolean(label));

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div
        role="group"
        aria-label="Kategoria"
        className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          type="button"
          aria-pressed={!filters.category}
          onClick={() => onChange({ category: null })}
          className={`${TILE_CLASS} ${chipTone(!filters.category)}`}
        >
          Wszystkie
        </button>
        {index.childrenOf(null).map((category) => {
          const on = category.id === root?.id;
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ category: on ? null : category.id })}
              className={`${TILE_CLASS} ${chipTone(on)}`}
            >
              {category.name}
            </button>
          );
        })}
      </div>
      <FiltersButton refinements={refinements} onOpen={() => setOpen(true)} />
      {open && (
        <ItemFilterSheet
          index={index}
          path={path}
          filters={filters}
          onChange={onChange}
          scope={scope}
          onScopeChange={onScopeChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** The scope, then what narrows the picked main category: a drill-down
 * through its subcategories, Stan and Oddam/Zamienię. Every pick applies at once. */
function ItemFilterSheet({
  index,
  path,
  filters,
  onChange,
  scope,
  onScopeChange,
  onClose,
}: ItemFiltersProps & { index: CategoryIndex; path: Category[]; onClose: () => void }) {
  const subcategoriesRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  const root = path.at(0);
  const selected = path.at(-1);
  // The level shown: the picked category's children, or a leaf's siblings.
  const levelPath = selected && path.length > 1 && index.childrenOf(selected.id).length === 0 ? path.slice(0, -1) : path;
  const level = levelPath.at(-1);
  const options = level ? index.childrenOf(level.id) : [];

  // The pressed chip may leave the list; focus stays inside the sheet.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    subcategoriesRef.current?.focus();
  }, [filters.category]);

  function pickCategory(id: string) {
    refocus.current = true;
    onChange({ category: id });
  }

  return (
    <ModalSheet title="Filtry" onClose={onClose}>
      <div className="flex flex-col gap-5">
        {scope && <ScopeSection scope={scope} onSelect={onScopeChange} />}
        <div
          ref={subcategoriesRef}
          role="group"
          aria-label="Podkategoria"
          tabIndex={-1}
          className="flex flex-col gap-2 outline-none"
        >
          <h4 className={SECTION_TITLE_CLASS}>Podkategoria</h4>
          {!root && <p className="text-sm text-ink-soft">Najpierw wybierz kategorię z listy nad wynikami.</p>}
          {levelPath.length > 1 && (
            <nav aria-label="Ścieżka" className="flex flex-wrap items-center gap-1 text-[13px] text-ink-soft">
              {levelPath.map((node, depth) => (
                <span key={node.id} className="flex items-center gap-1">
                  {depth > 0 && <span aria-hidden="true">›</span>}
                  <button
                    type="button"
                    aria-current={node.id === selected?.id || undefined}
                    onClick={() => pickCategory(node.id)}
                    className={`rounded-md font-bold hover:text-ink aria-[current=true]:text-ink ${FOCUS_CLASS}`}
                  >
                    {node.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
          {level && options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {options.map((category) => {
                const on = category.id === selected?.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => pickCategory(on ? level.id : category.id)}
                    className={`${CHIP_CLASS} ${chipTone(on)}`}
                  >
                    {category.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div role="group" aria-label="Stan" className="flex flex-col gap-2">
          <h4 className={SECTION_TITLE_CLASS}>Stan</h4>
          <div className="flex flex-wrap gap-2">
            {CONDITIONS.map((condition) => {
              const on = filters.condition === condition;
              return (
                <button
                  key={condition}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ condition: on ? null : condition })}
                  className={`${CHIP_CLASS} ${chipTone(on)}`}
                >
                  {CONDITION_LABELS[condition]}
                </button>
              );
            })}
          </div>
        </div>

        <div role="group" aria-label="Tryb oferty" className="flex flex-col gap-2">
          <h4 className={SECTION_TITLE_CLASS}>Oddam / zamienię</h4>
          <div className="flex flex-wrap gap-2">
            {ITEM_MODES.map((itemMode) => {
              const offerType = ITEM_MODE_TO_RESERVATION_TYPE[itemMode];
              const on = filters.offer_type === offerType;
              return (
                <button
                  key={itemMode}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ offer_type: on ? null : offerType })}
                  className={`${CHIP_CLASS} capitalize ${chipTone(on)}`}
                >
                  {itemMode}
                </button>
              );
            })}
          </div>
        </div>

        <SheetActions
          onClear={() => {
            onChange({ category: root?.id ?? null, condition: null, offer_type: null });
            if (scope) onScopeChange("all");
          }}
          onClose={onClose}
        />
      </div>
    </ModalSheet>
  );
}

export function ScopeToggle({ scope, onSelect }: { scope: SearchScope; onSelect: (scope: SearchScope) => void }) {
  const radioRefs = useRef<Partial<Record<SearchScope, HTMLButtonElement | null>>>({});

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = nextIndex(event.key, SCOPES.findIndex((s) => s.id === scope), SCOPES.length);
    if (index === null) return;
    event.preventDefault();
    const target = SCOPES[index].id;
    onSelect(target);
    radioRefs.current[target]?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Zakres" className="grid grid-cols-2 gap-1 rounded-full bg-line p-1">
      {SCOPES.map((s) => {
        const on = s.id === scope;
        return (
          <button
            key={s.id}
            ref={(element) => {
              radioRefs.current[s.id] = element;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onSelect(s.id)}
            onKeyDown={handleKeyDown}
            className={`min-h-11 text-[13px] ${SEGMENT_CLASS} ${segmentTone(on)}`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function MeetingFilters({ filters, dateRangeInvalid, onChange, scope, onScopeChange }: MeetingFiltersProps) {
  const [open, setOpen] = useState(false);
  const refinements = [
    scope === "mine" && "Moje grupy",
    filters.date_from && `od ${dayjs(filters.date_from).format("D MMM")}`,
    filters.date_to && `do ${dayjs(filters.date_to).format("D MMM")}`,
  ].filter((label): label is string => Boolean(label));

  return (
    <div className="mb-3">
      <FiltersButton refinements={refinements} onOpen={() => setOpen(true)} />
      {open && (
        <MeetingFilterSheet
          filters={filters}
          dateRangeInvalid={dateRangeInvalid}
          onChange={onChange}
          scope={scope}
          onScopeChange={onScopeChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** The scope, then Od (today when unset) and Do. Every change applies at once. */
function MeetingFilterSheet({
  filters,
  dateRangeInvalid,
  onChange,
  scope,
  onScopeChange,
  onClose,
}: MeetingFiltersProps & { onClose: () => void }) {
  const id = useId();
  const rangeErrorId = `${id}-range-error`;
  const today = useClientValue(() => dayjs().format("YYYY-MM-DD"), "");
  const from = filters.date_from ?? today;

  return (
    <ModalSheet title="Filtry" onClose={onClose}>
      <div className="flex flex-col gap-5">
        {scope && <ScopeSection scope={scope} onSelect={onScopeChange} />}
        <div role="group" aria-label="Kiedy" className="flex flex-col gap-2">
          <h4 className={SECTION_TITLE_CLASS}>Kiedy</h4>
          <div className="flex flex-wrap gap-2">
            <label className={`${CHIP_CLASS} ${chipTone(true)} flex items-center gap-1.5`} htmlFor={`${id}-from`}>
              Od:
              <input
                id={`${id}-from`}
                type="date"
                value={from}
                min={today || undefined}
                onChange={(event) =>
                  onChange({ date_from: event.target.value && event.target.value !== today ? event.target.value : null })
                }
                className="bg-transparent text-sm text-ink outline-none"
              />
            </label>
            <label
              className={`${CHIP_CLASS} ${chipTone(filters.date_to !== null)} flex items-center gap-1.5`}
              htmlFor={`${id}-to`}
            >
              Do:
              <input
                id={`${id}-to`}
                type="date"
                value={filters.date_to ?? ""}
                min={from || undefined}
                aria-invalid={dateRangeInvalid || undefined}
                aria-describedby={dateRangeInvalid ? rangeErrorId : undefined}
                onChange={(event) => onChange({ date_to: event.target.value || null })}
                className="bg-transparent text-sm text-ink outline-none"
              />
            </label>
          </div>
          {dateRangeInvalid && (
            <p id={rangeErrorId} role="alert" className="text-sm text-danger">
              Data „Do” nie może być wcześniejsza niż „Od”.
            </p>
          )}
        </div>
        <SheetActions
          onClear={() => {
            onChange({ date_from: null, date_to: null });
            if (scope) onScopeChange("all");
          }}
          onClose={onClose}
        />
      </div>
    </ModalSheet>
  );
}
