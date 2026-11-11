"use client";

import { useCallback } from "react";
import { ItemCard } from "../../../components/shared/ItemCard";
import { useLoadMoreOnScroll } from "../../../hooks/useLoadMoreOnScroll";
import { useOwnerItems } from "../../../hooks/useOwnerItems";
import { itemPagePath } from "../../product/useItemRoutes";
import { usePartyProfilePage } from "../PartyProfileContext";
import { ProfileEmptyBox } from "./ProfileEmptyBox";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const SECTION_HEADING = "text-xs font-extrabold tracking-[.12em] text-ink-soft uppercase";
const RETRY_BUTTON = `min-h-[44px] font-bold text-primary-fg underline ${FOCUS_RING}`;
const MORE_BUTTON = `flex min-h-11 w-full items-center justify-center rounded-full border border-line bg-paper px-5 text-[14px] font-bold text-ink disabled:opacity-60 ${FOCUS_RING}`;

/** "Rzeczy użytkownika": with nothing listed an empty box (with "+" for the
 * owner, unless `ProfileStartHere` covers both sections), else every listed item of the person, 20 at a time,
 * the next page loading as the list's end scrolls into view ("Pokaż więcej"
 * without IntersectionObserver). */
export function ProfileItems() {
  const { profile, hasTerms, hasItems } = usePartyProfilePage();
  if (!hasItems) {
    if (!profile.is_me) return <ProfileEmptyBox title="Ten użytkownik nie dodał jeszcze żadnych rzeczy." />;
    return hasTerms ? <ProfileEmptyBox title="Nie masz jeszcze rzeczy" addLabel="Dodaj rzecz" /> : null;
  }
  return <ProfileItemsList />;
}

function ProfileItemsList() {
  const { owner } = usePartyProfilePage().profile;
  const items = useOwnerItems({ kind: "party", partyId: owner.party_id });
  const { fetchNextPage } = items;
  const canLoadMore = items.hasNextPage && !items.fetchingNextPage && items.nextPageError === null;
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);
  const sentinel = useLoadMoreOnScroll(loadMore, canLoadMore);

  return (
    <section aria-labelledby="profile-items-heading" aria-busy={items.loading || items.fetchingNextPage} className="flex flex-col gap-3 px-6">
      <h2 id="profile-items-heading" className={SECTION_HEADING}>
        Rzeczy użytkownika
      </h2>
      {items.loading ? (
        <p className="text-[13px] text-ink-soft">Wczytywanie…</p>
      ) : items.error ? (
        <p className="text-[13px] text-ink-soft">
          Nie udało się wczytać rzeczy.{" "}
          <button type="button" onClick={() => void items.refetch()} className={RETRY_BUTTON}>
            Spróbuj ponownie
          </button>
        </p>
      ) : items.items.length === 0 ? (
        <p className="text-[13px] text-ink-soft">Nie ma teraz rzeczy do oddania ani zamiany.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5">
          {items.items.map((item) => (
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
      )}
      {items.nextPageError ? (
        <p className="text-[13px] text-ink-soft">
          Nie udało się wczytać kolejnych rzeczy.{" "}
          <button type="button" onClick={() => void fetchNextPage()} className={RETRY_BUTTON}>
            Spróbuj ponownie
          </button>
        </p>
      ) : (
        items.hasNextPage && (
          <>
            <div ref={sentinel} aria-hidden="true" />
            <button type="button" onClick={() => void fetchNextPage()} disabled={items.fetchingNextPage} className={MORE_BUTTON}>
              {items.fetchingNextPage ? "Wczytywanie…" : "Pokaż więcej"}
            </button>
          </>
        )
      )}
    </section>
  );
}
