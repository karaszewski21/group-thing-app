import { useId } from "react";
import type { ItemCondition } from "../../api/inventories";
import type { SearchFilters as SearchFilterValues, SearchMode } from "../../api/search";
import { CategoryTreePicker } from "../../components/shared/CategoryTreePicker";
import { CloseIcon } from "../../components/shared/appIcons";
import { useClientValue } from "../../lib/useClientValue";
import { ITEM_MODE_TO_RESERVATION_TYPE, ITEM_MODES } from "../../utils/appHelpers";
import dayjs from "../../utils/dayjs";
import { CONDITION_LABELS } from "../../utils/productCategory";

const CONDITIONS = Object.keys(CONDITION_LABELS) as ItemCondition[];

const CHIP_CLASS =
  "min-h-11 rounded-full border-[1.5px] px-3.5 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const chipTone = (set: boolean) => (set ? "border-primary bg-primary-soft text-ink" : "border-line bg-paper text-ink");

interface SearchFiltersProps {
  mode: SearchMode;
  filters: SearchFilterValues;
  /** „Do” is earlier than „Od”: an inline error at „Do”. */
  dateRangeInvalid: boolean;
  onChange: (patch: Partial<SearchFilterValues>) => void;
}

/** The searched mode's filters: Kategoria, Stan and Oddam/Zamienię for
 * items, Od (today when unset) and Do for meetings. */
export function SearchFilters({ mode, filters, dateRangeInvalid, onChange }: SearchFiltersProps) {
  return mode === "items" ? (
    <ItemFilters filters={filters} onChange={onChange} />
  ) : (
    <MeetingFilters filters={filters} dateRangeInvalid={dateRangeInvalid} onChange={onChange} />
  );
}

function ItemFilters({ filters, onChange }: Omit<SearchFiltersProps, "mode" | "dateRangeInvalid">) {
  const id = useId();
  const categoryLabelId = `${id}-category`;
  const conditionId = `${id}-condition`;

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* The trigger reads this label, then its own text: the placeholder
            already says „Kategoria”, so the label is only added to a picked one. */}
        <span id={categoryLabelId} className="sr-only">
          {filters.category ? "Kategoria" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <CategoryTreePicker
            labelledBy={categoryLabelId}
            value={filters.category}
            onChange={(category) => onChange({ category })}
            mode="any"
            placeholder="Kategoria"
          />
        </div>
        {filters.category && (
          <button
            type="button"
            onClick={() => onChange({ category: null })}
            aria-label="Wyczyść kategorię"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-cream text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <CloseIcon />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <label htmlFor={conditionId} className="sr-only">
          Stan
        </label>
        <select
          id={conditionId}
          value={filters.condition ?? ""}
          onChange={(event) => onChange({ condition: (event.target.value || null) as ItemCondition | null })}
          className={`${CHIP_CLASS} ${chipTone(filters.condition !== null)}`}
        >
          <option value="">Stan: każdy</option>
          {CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              Stan: {CONDITION_LABELS[condition]}
            </option>
          ))}
        </select>
        <div role="group" aria-label="Tryb oferty" className="flex gap-2">
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
    </div>
  );
}

function MeetingFilters({ filters, dateRangeInvalid, onChange }: Omit<SearchFiltersProps, "mode">) {
  const id = useId();
  const rangeErrorId = `${id}-range-error`;
  const today = useClientValue(() => dayjs().format("YYYY-MM-DD"), "");
  const from = filters.date_from ?? today;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <label className={`${CHIP_CLASS} ${chipTone(true)} flex items-center gap-1.5`} htmlFor={`${id}-from`}>
        Od:
        <input
          id={`${id}-from`}
          type="date"
          value={from}
          min={today || undefined}
          onChange={(event) => onChange({ date_from: event.target.value && event.target.value !== today ? event.target.value : null })}
          className="bg-transparent text-sm text-ink outline-none"
        />
      </label>
      <label className={`${CHIP_CLASS} ${chipTone(filters.date_to !== null)} flex items-center gap-1.5`} htmlFor={`${id}-to`}>
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
      {dateRangeInvalid && (
        <p id={rangeErrorId} role="alert" className="w-full text-sm text-danger">
          Data „Do” nie może być wcześniejsza niż „Od”.
        </p>
      )}
    </div>
  );
}
