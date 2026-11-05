import { getStableSlotOrder, getTablePosition } from "../../../../utils/layoutPositions";
import { FamilySlot } from "./FamilySlot";
import { GhostSeat } from "./GhostSeat";
import { OrganizerAvatar } from "./OrganizerAvatar";
import type { LayoutProps } from "./visualizationTypes";

const GHOST_SEATS = 8;

/**
 * TABLE layout — families distributed around an ellipse's perimeter
 * (`getTablePosition`), any family count without avatar overlap, same
 * deterministic slot shuffle as PITCH. The organizer sits at the head of the
 * table (the first seat of `slots + 1`); families take the seats after it.
 */
export function TableLayout({
  families,
  organizerName,
  activeFamilyId,
  onSelectFamily,
  groupId,
}: LayoutProps & { groupId: string }) {
  const slots = families.length;
  const order = getStableSlotOrder(groupId, families.map((f) => f.familyId));
  const byId = new Map(families.map((f) => [f.familyId, f]));

  const seats = (slots === 0 ? GHOST_SEATS : slots) + 1;
  const head = getTablePosition(0, seats);

  return (
    <div className="px-4.5 pt-12 pb-1.5">
      <div className="relative mx-auto aspect-square w-full max-w-90">
        {/* Avatar centered on the head seat, the name above it. */}
        <div
          className="absolute flex -translate-x-1/2 -translate-y-[calc(100%-26px)] flex-col items-center gap-2"
          style={{ left: `${head.x}%`, top: `${head.y}%` }}
        >
          <strong className="rounded-full bg-paper px-3 py-1 font-serif text-[14px] font-bold whitespace-nowrap text-ink">
            {organizerName || "Brak organizatora"}
          </strong>
          <OrganizerAvatar name={organizerName} small />
        </div>

        <div
          className="absolute left-1/2 top-1/2 h-[46%] w-[64%] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "#e7cfa8", border: "6px solid var(--color-ink)" }}
          data-testid="table-top"
        />

        {order.map((familyId, i) => {
          const family = byId.get(familyId);
          if (!family) return null;
          const { x, y } = getTablePosition(i + 1, seats);
          return (
            <FamilySlot
              key={family.familyId}
              family={family}
              active={activeFamilyId === family.familyId}
              style={{ left: `${x}%`, top: `${y}%` }}
              onSelectFamily={onSelectFamily}
            />
          );
        })}
        {slots === 0 &&
          Array.from({ length: GHOST_SEATS }, (_, i) => {
            const { x, y } = getTablePosition(i + 1, seats);
            return <GhostSeat key={i} style={{ left: `${x}%`, top: `${y}%` }} />;
          })}
      </div>
    </div>
  );
}
