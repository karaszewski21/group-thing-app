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

// Families alternate between the palette's two colors, like the term page's circle.
const SEAT_TONES = ["bg-primary", "bg-accent"];

interface CircleVisualMiniProps {
  layoutMode: GroupLayoutMode;
  attendeeCount: number;
  /** Background of the map; the cards draw it on their own colored band. */
  className?: string;
}

/** Anonymous seat map of a circle's next term: dots only, never names. */
export function CircleVisualMini({ layoutMode, attendeeCount, className = "bg-cream" }: CircleVisualMiniProps) {
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
    <div role="img" aria-label={label} className={`relative mx-auto aspect-[4/3] max-h-48 w-full rounded-xl ${className}`}>
      <Ground layoutMode={layoutMode} />
      {Array.from({ length: seats }, (_, index) => {
        const { x, y } = position(index, seats);
        return (
          <span
            key={index}
            data-seat
            aria-hidden="true"
            className={`absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-paper ${SEAT_TONES[index % SEAT_TONES.length]}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          />
        );
      })}
      {overflow > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-2 bottom-2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-extrabold text-on-primary"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

/** The shape the families gather around: a dashed ring with the organizer in
 * the middle, a pitch with its halfway line, or a table. */
function Ground({ layoutMode }: { layoutMode: GroupLayoutMode }) {
  if (layoutMode === "TABLE") {
    return (
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 h-2/5 w-3/5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-line-strong bg-paper"
      />
    );
  }
  if (layoutMode === "PITCH") {
    return (
      <span
        aria-hidden="true"
        className="absolute inset-x-[8%] top-[14%] bottom-[6%] rounded-lg border-2 border-paper/80"
      >
        <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-paper/80" />
        <span className="absolute top-1/2 left-1/2 h-1/3 w-1/4 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-paper/80" />
      </span>
    );
  }
  return (
    <>
      <span
        aria-hidden="true"
        className="absolute inset-[12%] rounded-[50%] border-2 border-dashed border-primary/35"
      />
      <span
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-paper bg-primary"
      />
    </>
  );
}
