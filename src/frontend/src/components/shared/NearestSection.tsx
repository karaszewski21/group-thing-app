import type { OwnerNearestDate } from "../../api/ownerItems";
import { PickupPlacesBox } from "./PickupPlacesBox";
import type { OwnerRef } from "../../hooks/useOwnerItems";
import { useOwnerMeetings } from "../../hooks/useOwnerMeetings";

/** Where the owner's things can be picked up — their upcoming terms and
 * events, nearest first, in the item page's box with a select — or a
 * chat-only notice; with dates, a link to all meetings at `meetingsHref`.
 * Until the meetings load, the box shows the owner's `nearest` date alone. */
export function NearestSection({
  ownerRef,
  nearest,
  name,
}: {
  ownerRef: OwnerRef;
  nearest: OwnerNearestDate | null;
  name: string;
  meetingsHref: string;
}) {
  const { meetings } = useOwnerMeetings(ownerRef);
  if (!nearest) {
    return (
      <div className="rounded-3xl border border-line bg-paper p-4">
        <p className="text-[14px] font-bold text-ink">{name} nie ma teraz zaplanowanych spotkań</p>
        <p className="mt-2 text-[13px] text-ink-soft">Napisz w sprawie konkretnej rzeczy — umówicie się na czacie.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <PickupPlacesBox
        heading="Najbliższa okazja do odbioru"
        headingLevel="h2"
        options={meetings.length > 0 ? meetings : [nearest]}
      />
    </div>
  );
}
