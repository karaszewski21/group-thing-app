"use client";

import { ItemCard } from "../../../components/shared/ItemCard";
import { Link } from "../../../routing/navigation";
import { itemPagePath } from "../../product/useItemRoutes";
import { usePartyProfilePage } from "../PartyProfileContext";

const SECTION_HEADING = "text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase";
const ALL_ITEMS_LINK =
  "inline-flex min-h-11 items-center text-[14px] font-extrabold text-primary-fg no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** The person's newest listed items, with a link to all of them when there
 * are more. */
export function ProfileItems() {
  const { profile } = usePartyProfilePage();
  const total = profile.counts.GIFT + profile.counts.SWAP;
  const { owner } = profile;
  return (
    <section aria-labelledby="profile-items-heading" className="flex flex-col gap-3">
      <h2 id="profile-items-heading" className={SECTION_HEADING}>
        Rzeczy do oddania lub zamiany
      </h2>
      {total === 0 ? (
        <p className="text-[13px] text-ink-soft">Nie ma teraz rzeczy do oddania ani zamiany.</p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-2.5">
            {profile.recent_items.map((item) => (
              <li key={item.item_id}>
                <ItemCard
                  href={itemPagePath(owner.slug ?? owner.party_id, item.item_id)}
                  name={item.product_name}
                  condition={item.condition}
                  thumbUrl={item.thumb_url}
                  mode={item.mode}
                  reservation={item.reservation}
                />
              </li>
            ))}
          </ul>
          {total > profile.recent_items.length && (
            <Link to={`/${owner.party_id}/items`} className={ALL_ITEMS_LINK}>
              {`Zobacz wszystkie (${total})`}
              <span aria-hidden="true">{" ›"}</span>
            </Link>
          )}
        </>
      )}
    </section>
  );
}
