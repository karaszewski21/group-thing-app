import { useState } from "react";
import { Link } from "react-router-dom";
import type { EventParticipant, EventParticipantItem } from "../../../api/events";
import type { ListingMode } from "../../../api/itemListingPreferences";
import { Avatar } from "../../../components/shared/Avatar";
import { PhotoPlaceholder } from "../../../components/shared/Icons";
import { SafeImage } from "../../product/ItemGallery";
import { organizerItemPath } from "../../product/useItemRoutes";

/** Items shown per participant before "Pokaż wszystkie". */
const VISIBLE_ITEMS = 3;

const MODE_LABELS: Record<ListingMode, string> = {
  GIFT: "Weź na stałe",
  SWAP: "Zamiana",
};

const PILL = "ml-auto shrink-0 rounded-full px-2.25 py-0.75 text-[11px] font-extrabold";

/** One shared item, read-only: a link to its product page. */
function ItemRow({ item, authorSlug }: { item: EventParticipantItem; authorSlug: string }) {
  return (
    <Link
      to={organizerItemPath(authorSlug, item.item_id)}
      className="flex items-center gap-3 py-3 text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-cream">
        {item.thumb_url === null ? (
          <PhotoPlaceholder size={20} />
        ) : (
          <SafeImage src={item.thumb_url} alt="" className="size-full" placeholderSize={20} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-snug wrap-break-word">{item.product_name}</span>{" "}
        <small className="block text-xs text-ink-soft">{MODE_LABELS[item.mode]}</small>
      </span>
    </Link>
  );
}

/** A participant's items: the first `VISIBLE_ITEMS`, then a toggle for the rest. */
function ParticipantItems({ items, authorSlug }: { items: EventParticipantItem[]; authorSlug: string }) {
  const [expanded, setExpanded] = useState(false);
  const hidden = items.length - VISIBLE_ITEMS;
  const shown = expanded || hidden <= 0 ? items : items.slice(0, VISIBLE_ITEMS);

  return (
    <div className="mt-1 ml-13">
      <div className="divide-y divide-line">
        {shown.map((item) => (
          <ItemRow key={item.item_id} item={item} authorSlug={authorSlug} />
        ))}
      </div>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="mt-1 min-h-11 text-sm font-extrabold text-primary-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          {expanded ? "Zwiń" : `Pokaż wszystkie (${items.length})`}
        </button>
      )}
    </div>
  );
}

/** "Zapisani na wydarzenie": the author (always first, "Organizator") and the
 * attendees with the items they share; the viewer's own row says "To Ty".
 * Item links use the author's slug, the event page's URL prefix. The empty
 * copy nudges to sign up only a viewer who can. */
export function EventAttendeeList({
  participants,
  authorSlug,
  canSignUp,
}: {
  participants: EventParticipant[];
  authorSlug: string;
  canSignUp: boolean;
}) {
  const nobodySignedUp = participants.every((p) => p.is_author);

  return (
    <section className="mx-5 mt-6" aria-label="Zapisani na wydarzenie">
      <h2 className="font-serif text-[22px] font-bold text-ink">Zapisani i ich rzeczy</h2>
      <ul className="mt-3 divide-y divide-line rounded-3xl border border-line bg-paper px-3.5 empty:hidden">
        {participants.map((p) => (
          <li key={p.party_id} className="py-3">
            <div className="flex items-center gap-3">
              <Avatar name={p.display_name} size="md" showsSharesIcon={p.items.length > 0} />
              <strong className="min-w-0 text-base wrap-break-word">{p.display_name}</strong>
              {p.is_author ? (
                <span className={`${PILL} bg-accent-soft tracking-[.08em] text-accent-fg uppercase`}>Organizator</span>
              ) : (
                p.is_me && <span className={`${PILL} bg-primary-soft text-primary-fg`}>To Ty</span>
              )}
            </div>
            {p.items.length > 0 && <ParticipantItems items={p.items} authorSlug={authorSlug} />}
          </li>
        ))}
      </ul>
      {nobodySignedUp && (
        <p className="mt-3 rounded-[20px] border-2 border-dashed border-line-strong px-4 py-3.5 text-[15px] leading-snug text-ink-soft">
          Nikt jeszcze się nie zapisał.
          {canSignUp && " Zapisz się jako pierwsza osoba i pokaż, co przyniesiesz do wymiany."}
        </p>
      )}
    </section>
  );
}
