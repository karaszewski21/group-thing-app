import type { GroupLayoutMode } from "../../../api/groups";
import {
  getCirclePosition,
  getPitchPosition,
  getTablePosition,
  type LayoutPosition,
} from "../../../utils/layoutPositions";
import { pluralPl } from "../../../utils/plural";

const MAX_SEATS = 16;

const POSITION: Record<GroupLayoutMode, (index: number, total: number) => LayoutPosition> = {
  CIRCLE: getCirclePosition,
  PITCH: getPitchPosition,
  TABLE: getTablePosition,
};

interface CircleVisualMiniProps {
  layoutMode: GroupLayoutMode;
  attendeeCount: number;
}

/** Anonymous seat map of a circle's next term: dots only, never names. */
export function CircleVisualMini({ layoutMode, attendeeCount }: CircleVisualMiniProps) {
  if (attendeeCount <= 0) return null;

  const seats = Math.min(attendeeCount, MAX_SEATS);
  const overflow = attendeeCount - seats;
  const position = POSITION[layoutMode];
  const label = pluralPl(
    attendeeCount,
    `Zapisana ${attendeeCount} rodzina`,
    `Zapisane ${attendeeCount} rodziny`,
    `Zapisanych ${attendeeCount} rodzin`,
  );

  return (
    <div role="img" aria-label={label} className="relative mx-auto aspect-[4/3] max-h-48 w-full rounded-xl bg-cream">
      <CenterMarker layoutMode={layoutMode} />
      {Array.from({ length: seats }, (_, index) => {
        const { x, y } = position(index, seats);
        return (
          <span
            key={index}
            data-seat
            aria-hidden="true"
            className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary-soft"
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        );
      })}
      {overflow > 0 && (
        <span
          aria-hidden="true"
          className="absolute bottom-2 right-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-extrabold text-on-primary"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

function CenterMarker({ layoutMode }: { layoutMode: GroupLayoutMode }) {
  if (layoutMode === "TABLE") {
    return (
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-2/5 w-3/5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-line bg-paper"
      />
    );
  }
  return (
    <>
      {layoutMode === "PITCH" && (
        <span aria-hidden="true" className="absolute left-[8%] right-[8%] top-1/2 h-0.5 -translate-y-1/2 bg-line" />
      )}
      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
      />
    </>
  );
}
