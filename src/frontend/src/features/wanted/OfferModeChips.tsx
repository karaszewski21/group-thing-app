import type { ExchangeMode } from "../../api/groups";
import { CHIP_CLASS, chipTone } from "../../components/shared/chipStyles";

const OPTIONS: readonly { value: ExchangeMode | null; label: string }[] = [
  { value: null, label: "Obojętnie" },
  { value: "GIFT", label: "Oddam" },
  { value: "SWAP", label: "Zamiana" },
  { value: "POINTS", label: "Za punkty" },
];

/** How the searcher wants to get the item; exactly one chip is pressed,
 * „Obojętnie” (`null`) for either way. */
export function OfferModeChips({
  value,
  onChange,
  labelledBy,
}: {
  value: ExchangeMode | null;
  onChange: (mode: ExchangeMode | null) => void;
  /** Id of the host's visible label. */
  labelledBy: string;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {OPTIONS.map((option) => {
        const on = value === option.value;
        return (
          <button
            key={option.label}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(option.value)}
            className={`${CHIP_CLASS} ${chipTone(on)}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
