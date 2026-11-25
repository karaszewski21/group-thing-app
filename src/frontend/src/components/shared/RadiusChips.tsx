import { RADII_KM } from "../../utils/appHelpers";
import { chipTone, FOCUS_CLASS } from "./chipStyles";

/** `CHIP_CLASS` with less side padding, so the chips fit narrow screens (they wrap below 390 px). */
const RADIUS_CHIP_CLASS = `min-h-11 whitespace-nowrap rounded-full border-[1.5px] px-2.5 text-sm font-bold ${FOCUS_CLASS}`;

/** How far around the picked locality: „Tylko tu” (`null`) or one of `RADII_KM`. */
export function RadiusChips({ value, onChange }: { value: number | null; onChange: (km: number | null) => void }) {
  return (
    <div role="group" aria-label="Odległość" className="flex flex-wrap gap-1.5">
      {[null, ...RADII_KM].map((km) => {
        const on = value === km;
        return (
          <button
            key={km ?? 0}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(km)}
            className={`${RADIUS_CHIP_CLASS} ${chipTone(on)}`}
          >
            {km === null ? "Tylko tu" : `+${km} km`}
          </button>
        );
      })}
    </div>
  );
}
