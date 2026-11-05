import { BringsIcon, SharesIcon } from "../../../../components/shared/Icons";
import { CircleLayout } from "./CircleLayout";
import { PitchLayout } from "./PitchLayout";
import { TableLayout } from "./TableLayout";
import type { GroupLayoutMode, LayoutProps } from "./visualizationTypes";

export interface GroupVisualizationProps extends LayoutProps {
  layoutMode: GroupLayoutMode;
  /** Seeds the deterministic PITCH/TABLE family→slot shuffle
   * (`getStableSlotOrder`); CIRCLE keeps `families`' natural order. */
  groupId: string;
}

/** Two-entry exchange-status legend, rendered once beneath the visualization
 * regardless of `layoutMode` — identical content/markup in all 3 layouts
 * (Core Requirement 8 / `component:exchange-legend`). */
function ExchangeLegend() {
  return (
    <div className="flex gap-3.5 justify-center text-[11px] text-ink-soft mt-2.5 mx-5 mb-1" data-testid="exchange-legend">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-accent text-ink">
          <SharesIcon size={8} strokeWidth={3} />
        </span>
        udostępnia rzecz
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-full bg-teal inline-flex items-center justify-center text-ink">
          <BringsIcon size={8} strokeWidth={3} />
        </span>
        przynosi na zajęcia
      </span>
    </div>
  );
}

/**
 * Container for the group's participant visualization — renders exactly one
 * of `CircleLayout`/`PitchLayout`/`TableLayout` based on `layoutMode`, plus
 * the shared `ExchangeLegend` beneath it. See spec.md Section 4 (Architektura
 * komponentów) for the full contract.
 */
export function GroupVisualization({ layoutMode, groupId, ...layout }: GroupVisualizationProps) {
  return (
    <>
      {layoutMode === "CIRCLE" && <CircleLayout {...layout} />}
      {layoutMode === "PITCH" && <PitchLayout {...layout} groupId={groupId} />}
      {layoutMode === "TABLE" && <TableLayout {...layout} groupId={groupId} />}
      {layout.families.length === 0 && (
        <p className="mx-auto mt-1 w-max rounded-full bg-paper px-3.5 py-1.5 text-[13px] font-bold text-primary-fg">
          Nikt się jeszcze nie zapisał
        </p>
      )}
      <ExchangeLegend />
    </>
  );
}
