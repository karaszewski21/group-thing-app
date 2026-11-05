import type { CSSProperties } from "react";
import { Avatar } from "../../../../components/shared/Avatar";
import type { VisualizationFamily } from "./visualizationTypes";

/** One family's clickable avatar slot — shared markup across all 3 layouts. */
export function FamilySlot({
  family,
  active,
  style,
  onSelectFamily,
}: {
  family: VisualizationFamily;
  active: boolean;
  style: CSSProperties;
  onSelectFamily: (familyId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-200 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${active ? "scale-110 ring-4 ring-primary" : ""}`}
      style={style}
      onClick={() => onSelectFamily(family.familyId)}
      aria-pressed={active}
      aria-label={family.name}
    >
      <Avatar name={family.name} showsSharesIcon={family.sharesItem} showsBringsIcon={family.bringsItem} />
    </button>
  );
}
