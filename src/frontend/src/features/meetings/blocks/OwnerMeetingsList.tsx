"use client";

import type { OwnerNearestDate } from "../../../api/ownerItems";
import { Link } from "../../../routing/navigation";
import dayjs from "../../../utils/dayjs";
import { pluralPl } from "../../../utils/plural";
import { DateTile } from "../../owner-page/blocks/DateTile";
import { useOwnerMeetingsPage } from "../OwnerMeetingsContext";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

function MeetingCard({ meeting }: { meeting: OwnerNearestDate }) {
  const attendees = `${meeting.attendee_count} ${pluralPl(meeting.attendee_count, "zapisany", "zapisanych", "zapisanych")}`;
  return (
    <Link
      to={meeting.path}
      className={`flex items-center gap-3 rounded-3xl border border-line bg-paper p-3 no-underline ${FOCUS_RING}`}
    >
      <DateTile occursOn={meeting.starts_at} className="bg-primary text-on-primary" weekday />
      <span className="flex min-w-0 flex-col">
        <span className="text-[11px] font-extrabold tracking-wide text-accent-fg uppercase">
          {meeting.kind === "EVENT" ? "Wydarzenie" : "Termin"}
        </span>
        <span className="truncate text-[15px] font-bold text-ink">{meeting.name}</span>
        <span className="text-[12.5px] text-ink">{dayjs(meeting.starts_at).format("dddd, D MMMM · HH:mm")}</span>
        <span className="text-[12.5px] text-ink-soft">
          {meeting.location_name ? `${meeting.location_name} · ${attendees}` : attendees}
        </span>
      </span>
    </Link>
  );
}

/** The count and the cards of the owner's upcoming terms and events, each
 * linking to its page, or the empty notice. */
export function OwnerMeetingsList() {
  const { owner, meetings } = useOwnerMeetingsPage();
  if (meetings.length === 0) {
    return (
      <div className="px-6 pt-4">
        <div className="rounded-3xl border border-line bg-paper p-4">
          <p className="text-[14px] font-bold text-ink">{owner.display_name} nie ma teraz zaplanowanych spotkań</p>
        </div>
      </div>
    );
  }
  return (
    <section aria-label="Zaplanowane spotkania" className="flex flex-col gap-3 px-6 pt-4">
      <p className="text-[13px] text-ink-soft">
        {meetings.length}{" "}
        {pluralPl(meetings.length, "zaplanowane spotkanie", "zaplanowane spotkania", "zaplanowanych spotkań")}
      </p>
      <ul className="flex flex-col gap-2.5">
        {meetings.map((meeting) => (
          <li key={`${meeting.kind}-${meeting.id}`}>
            <MeetingCard meeting={meeting} />
          </li>
        ))}
      </ul>
    </section>
  );
}
