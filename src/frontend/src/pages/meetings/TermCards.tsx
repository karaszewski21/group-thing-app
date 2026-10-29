import { Link } from "react-router-dom";
import type { GroupResponse } from "../../api/groups";
import type { NeededItemResponse, TermResponse } from "../../api/terms";
import { useAppData } from "../../app/appDataStore";
import { TermPlaceLine } from "../../components/shared/TermPlaceLine";
import { CopyIcon, FamilyIcon, PencilIcon } from "../../components/shared/appIcons";
import { dayMonth, termPublicPath, termTime, type GuestTermCard } from "../../utils/appHelpers";
import { pluralPl } from "../../utils/plural";

const ICON_BUTTON =
  "flex h-10 w-10 flex-none items-center justify-center rounded-full border-[1.5px] border-line bg-paper text-ink transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** Day number over the short month name, the date badge of both term cards. */
function DateBadge({ occursOn }: { occursOn: string }) {
  const { day, month } = dayMonth(occursOn);
  return (
    <div className="flex h-14.5 w-13 flex-none flex-col items-center justify-center rounded-2xl bg-primary-soft leading-none">
      <b className="font-serif text-[22px] font-extrabold text-ink">{day}</b>
      <small className="mt-0.5 text-[10px] font-extrabold tracking-wide text-primary-fg uppercase">{month}</small>
    </div>
  );
}

/** "godz. 17:00 · opis", or "Bez opisu" when there is neither. */
function TimeAndDescription({ occursOn, description }: { occursOn: string; description: string | null }) {
  const time = termTime(occursOn);
  return (
    <>
      {time && <span className="font-bold text-ink">godz. {time}</span>}
      {time && (description ? " · " : "")}
      {description || (time ? "" : "Bez opisu")}
    </>
  );
}

/** Sign-up summary pill linking to the organizer attendees page. Counts come
 * from the terms payload and are `null` for non-organizers — no chip then. */
function SignupSummaryChip({ term }: { term: TermResponse }) {
  const attendees = term.attendee_count;
  if (attendees === null) return null;
  const children = term.child_count ?? 0;
  const hasAttendees = attendees > 0;
  const attendeesText = `${attendees} ${pluralPl(attendees, "zapis", "zapisy", "zapisów")}`;
  const childrenText = `${children} ${pluralPl(children, "dziecko", "dzieci", "dzieci")}`;
  const capacity = term.capacity ?? null;
  const capacityLabel = capacity === null ? "" : `${attendees}/${capacity} miejsc`;

  return (
    <div className="mt-2">
      <Link
        to={`/terms/${term.id}`}
        aria-label={`Zapisani na termin: ${
          hasAttendees ? `${attendeesText}, ${childrenText}` : "brak zapisów"
        }${capacityLabel && `, ${capacityLabel}`}`}
        className="inline-flex min-h-8 items-center gap-1 rounded-full bg-cream px-3 text-[13px] font-bold text-ink transition-colors hover:bg-line"
      >
        {hasAttendees && (
          <span aria-hidden="true" className="flex [&>svg]:h-3.5 [&>svg]:w-3.5">
            <FamilyIcon />
          </span>
        )}
        {hasAttendees ? `${attendeesText} · ${childrenText}` : "Brak zapisów"}
        {capacityLabel && ` · ${capacityLabel}`}
        <span aria-hidden="true">›</span>
      </Link>
    </div>
  );
}

interface OrganizerTermCardProps {
  term: TermResponse;
  group: GroupResponse;
  neededItems: NeededItemResponse[];
}

/** Organizer term tile — a read-only compact card. The circle name links to
 * the public per-term page; a copy-link button and an edit pencil (opening
 * `EditTermDialog`) are the only controls. Date, description and needed-items
 * editing all live in that dialog. Guest terms use `SavedTermCard`. */
export function OrganizerTermCard({ term, group, neededItems }: OrganizerTermCardProps) {
  const { showToast, setEditTermId, setModal } = useAppData();

  return (
    <div className="rounded-[22px] border border-line bg-paper p-3.5">
      <div className="flex items-start gap-3">
        <DateBadge occursOn={term.occurs_on} />
        <div className="min-w-0 flex-1">
          <Link to={termPublicPath(group, term.id)} className="text-base font-bold text-ink hover:underline">
            {group.name}
          </Link>
          <p className="mt-0.5 text-sm text-ink-soft">
            <TimeAndDescription occursOn={term.occurs_on} description={term.description} />
          </p>
          <TermPlaceLine location={term.location ?? null} capacity={null} withMapLink className="mt-1.5" />
          {neededItems.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {neededItems.map((ni) => (
                <span
                  key={ni.id}
                  title={ni.claimed ? "Ktoś zadeklarował, że to przyniesie" : undefined}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                    ni.claimed
                      ? "bg-primary-soft text-primary-fg"
                      : "border-[1.5px] border-dashed border-accent text-accent-fg"
                  }`}
                >
                  {ni.claimed ? "✓ " : ""}
                  {ni.name}
                </span>
              ))}
            </div>
          )}
          <SignupSummaryChip term={term} />
        </div>
        <div className="flex flex-none flex-col gap-1">
          <button
            type="button"
            title="Kopiuj link do terminu"
            aria-label="Kopiuj link do terminu"
            onClick={() => {
              void navigator.clipboard.writeText(`${window.location.origin}${termPublicPath(group, term.id)}`);
              showToast("Skopiowano link");
            }}
            className={ICON_BUTTON}
          >
            <CopyIcon />
          </button>
          <button
            type="button"
            aria-label="Edytuj termin"
            onClick={() => {
              setEditTermId(term.id);
              setModal("edit-termin");
            }}
            className={ICON_BUTTON}
          >
            <PencilIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

/** A "Zapisane" card (an RSVP or a family circle's term) — the whole card
 * links to the public term page, so the place line carries no Maps link of
 * its own (no nested anchors). */
export function SavedTermCard({ card }: { card: GuestTermCard }) {
  return (
    <Link
      to={card.href}
      className="flex items-start gap-3 rounded-[22px] border border-line bg-paper p-3.5 transition-colors hover:border-line-strong"
    >
      <DateBadge occursOn={card.occursOn} />
      <div className="min-w-0 flex-1">
        <h4 className="text-base font-bold text-ink">{card.groupName}</h4>
        <small className="mt-0.5 block text-sm text-ink-soft">
          <TimeAndDescription occursOn={card.occursOn} description={card.description} />
        </small>
        <TermPlaceLine
          location={card.location}
          capacity={card.capacity}
          attendeeCount={card.attendeeCount}
          withMapLink={false}
          className="mt-1.5"
        />
        {card.neededItems.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.neededItems.map((ni) => (
              <span
                key={ni.id}
                className="rounded-full border-[1.5px] border-dashed border-accent px-2.5 py-0.5 text-xs font-extrabold text-accent-fg"
              >
                {ni.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
