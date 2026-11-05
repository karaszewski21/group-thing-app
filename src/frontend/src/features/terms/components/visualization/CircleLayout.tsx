import { getCirclePosition } from "../../../../utils/layoutPositions";
import { FamilySlot } from "./FamilySlot";
import { GhostSeat } from "./GhostSeat";
import { OrganizerAvatar } from "./OrganizerAvatar";
import type { LayoutProps } from "./visualizationTypes";

const GHOST_SEATS = 8;

/**
 * CIRCLE layout — people evenly spaced around the organizer
 * (`getCirclePosition`), each joined to the center by a line.
 */
export function CircleLayout({ families, organizerName, activeFamilyId, onSelectFamily }: LayoutProps) {
  const slots = families.length;

  return (
    <div className="px-4.5 pt-5 pb-1.5">
      <div className="relative mx-auto aspect-square w-full max-w-90">
        <div className="absolute inset-0">
          <svg className="absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="38" fill="none" className="stroke-primary/35" strokeWidth="0.6" strokeDasharray="2 2" />
            {families.map((f, i) => {
              const { x, y } = getCirclePosition(i, slots);
              const on = activeFamilyId === f.familyId;
              return (
                <line
                  key={f.familyId}
                  x1="50"
                  y1="50"
                  x2={x}
                  y2={y}
                  className={on ? "stroke-primary" : "stroke-line-strong"}
                  strokeWidth={on ? "1" : "0.45"}
                />
              );
            })}
          </svg>

          {families.map((f, i) => {
            const { x, y } = getCirclePosition(i, slots);
            return (
              <FamilySlot
                key={f.familyId}
                family={f}
                active={activeFamilyId === f.familyId}
                style={{ left: `${x}%`, top: `${y}%` }}
                onSelectFamily={onSelectFamily}
              />
            );
          })}
          {slots === 0 &&
            Array.from({ length: GHOST_SEATS }, (_, i) => {
              const { x, y } = getCirclePosition(i, GHOST_SEATS);
              return <GhostSeat key={i} style={{ left: `${x}%`, top: `${y}%` }} />;
            })}

          <div className="absolute top-1/2 left-1/2 w-[48%] -translate-x-1/2 -translate-y-1/2 text-center">
            <OrganizerAvatar name={organizerName} />
            <strong className="mt-2.5 block font-serif text-[15px] font-bold">
              {organizerName || "Brak organizatora"}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}
