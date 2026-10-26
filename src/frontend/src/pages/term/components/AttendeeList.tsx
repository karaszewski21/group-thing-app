import { useState } from "react";
import type { ExchangeMode } from "../../../api/groups";
import { Avatar } from "../../../components/shared/Avatar";
import { PhotoPlaceholder } from "../../../components/shared/Icons";
import { SafeImage } from "../../product/ItemGallery";
import { EXCHANGE_MODE_TONE } from "./termLabels";
import { attendeeElementId, type ListingRowVM } from "./termSectionTypes";

/** Items shown per attendee before "Pokaż wszystkie". */
const VISIBLE_LISTINGS = 3;

export interface AttendeeVM {
  partyId: string;
  name: string;
  /** Items this person offers to swap / give away on this Term. */
  listings: ListingRowVM[];
}

/** A take action wears its exchange mode's tone (Zamień / Weź na stałe). */
function actionTone(key: string): string {
  return EXCHANGE_MODE_TONE[key as ExchangeMode] ?? EXCHANGE_MODE_TONE.GIFT;
}

/** One offered item: the photo tile, then the name with its take buttons
 * underneath, so a long name keeps the full width and wraps cleanly. */
function ListingRow({ row }: { row: ListingRowVM }) {
  return (
    <div data-listing-row className={`flex items-start py-3${row.thumbUrl !== undefined ? " gap-3" : ""}`}>
      {row.thumbUrl !== undefined && (
        <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cream">
          {row.thumbUrl === null ? (
            <PhotoPlaceholder size={20} />
          ) : (
            <SafeImage src={row.thumbUrl} alt="" className="size-full" placeholderSize={20} />
          )}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] leading-snug wrap-break-word">{row.title}</div>
        {row.subtitle != null && <small className="mt-0.5 block text-xs text-ink-soft">{row.subtitle}</small>}
        {row.actions.length > 0 && (
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {row.actions.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`min-h-9 rounded-full px-3.5 text-[13px] font-extrabold whitespace-nowrap disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${actionTone(a.key)}`}
                disabled={a.disabled}
                aria-label={a.ariaLabel}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
        {row.extra}
      </div>
    </div>
  );
}

/** An attendee's items: the first `VISIBLE_LISTINGS`, then a toggle for the rest. */
function AttendeeListings({ listings }: { listings: ListingRowVM[] }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = listings.length - VISIBLE_LISTINGS;
  const shown = expanded || hidden <= 0 ? listings : listings.slice(0, VISIBLE_LISTINGS);

  return (
    <div className="mt-1 ml-13">
      <div className="divide-y divide-line">
        {shown.map((row) => (
          <ListingRow key={row.key} row={row} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="mt-1 min-h-11 text-sm font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {expanded ? "Zwiń" : `Pokaż wszystkie (${listings.length})`}
        </button>
      )}
    </div>
  );
}

/** "Zapisani na zajęcia" — one entry per attendee with the items they offer
 * (and the take/swap buttons for each). `activePartyId` highlights the entry
 * picked from the visualization. */
export function AttendeeList({
  attendees,
  activePartyId,
}: {
  attendees: AttendeeVM[];
  activePartyId: string | null;
}) {
  return (
    <section className="mx-5 mt-6" aria-label="Zapisani na zajęcia">
      <h2 className="font-serif text-[22px] font-bold text-ink">Zapisani i ich rzeczy</h2>
      {attendees.length === 0 && (
        <p className="mt-3 rounded-[20px] border-2 border-dashed border-line-strong px-4 py-3.5 text-[15px] leading-snug text-ink-soft">Tu zobaczysz rodziny i rzeczy, które przyniosą do wymiany.</p>
      )}
      <ul className="mt-3 divide-y divide-line rounded-3xl border border-line bg-paper px-3.5 empty:hidden">
        {attendees.map((attendee) => {
          const active = attendee.partyId === activePartyId;
          return (
            <li
              key={attendee.partyId}
              id={attendeeElementId(attendee.partyId)}
              tabIndex={-1}
              data-active={active || undefined}
              className={`scroll-mt-30 py-3 transition-colors outline-none focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)] ${active ? "-mx-1.5 rounded-2xl bg-primary-soft px-1.5" : ""}`}
            >
              <div className="flex items-center gap-3">
                <Avatar name={attendee.name} size="md" showsSharesIcon={attendee.listings.length > 0} />
                <strong className="min-w-0 text-base wrap-break-word">{attendee.name}</strong>
              </div>
              {attendee.listings.length > 0 && <AttendeeListings listings={attendee.listings} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
