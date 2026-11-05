import { getPitchPosition, getStableSlotOrder } from "../../../../utils/layoutPositions";
import { FamilySlot } from "./FamilySlot";
import { GhostSeat } from "./GhostSeat";
import { OrganizerAvatar } from "./OrganizerAvatar";
import type { LayoutProps } from "./visualizationTypes";

const GHOST_SEATS = 6;

/**
 * PITCH layout — families laid out in evenly spaced rows
 * (`getPitchPosition`/`distributeEvenly`/`locateInRows`), any family count
 * without avatar overlap, deterministic slot shuffle via
 * `getStableSlotOrder` (seeded by `groupId`, per mockup's "rozkład rodzin na
 * boisku jest losowy — bez znaczenia taktycznego"). The organizer renders
 * above the pitch, separate from the family grid — per
 * `wizualizacja-grupy-boisko.html`.
 */
export function PitchLayout({
  families,
  organizerName,
  activeFamilyId,
  onSelectFamily,
  groupId,
}: LayoutProps & { groupId: string }) {
  const slots = families.length;
  const order = getStableSlotOrder(groupId, families.map((f) => f.familyId));
  const byId = new Map(families.map((f) => [f.familyId, f]));

  return (
    <div className="px-4.5 pt-5 pb-1.5">
      <div className="mb-3 text-center">
        <OrganizerAvatar name={organizerName} small />
        <strong className="mt-2.5 block font-serif text-[15px] font-bold text-ink">
          {organizerName || "Brak organizatora"}
        </strong>
      </div>

      <div
        className="relative mx-auto aspect-square w-full max-w-90 overflow-hidden rounded-[18px] border-2 border-white/50"
        style={{ background: "linear-gradient(160deg,#4E9A5F,#3E8A4E)" }}
        data-testid="pitch-field"
      >
        {order.map((familyId, i) => {
          const family = byId.get(familyId);
          if (!family) return null;
          const { x, y } = getPitchPosition(i, slots);
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
            const { x, y } = getPitchPosition(i, GHOST_SEATS);
            return <GhostSeat key={i} onPitch style={{ left: `${x}%`, top: `${y}%` }} />;
          })}
      </div>
    </div>
  );
}
