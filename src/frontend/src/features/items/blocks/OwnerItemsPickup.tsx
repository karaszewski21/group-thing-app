"use client";

import { NearestSection } from "../../../components/shared/NearestSection";
import { useOwnerItemsPage } from "../OwnerItemsContext";

/** The owner's nearest pickup dates, or the chat-only notice. */
export function OwnerItemsPickup() {
  const { ownerRef, owner, items } = useOwnerItemsPage();
  return (
    <div className="px-6 pt-4">
      <NearestSection
        ownerRef={ownerRef}
        nearest={items.nearest}
        name={owner.display_name}
        meetingsHref={`/${owner.slug ?? owner.party_id}/meetings`}
      />
    </div>
  );
}
