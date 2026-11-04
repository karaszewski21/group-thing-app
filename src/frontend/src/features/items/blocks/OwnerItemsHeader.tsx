"use client";

import { OrganizerHeaderBar } from "../../../components/shared/OrganizerHeaderBar";
import { useOwnerItemsPage } from "../OwnerItemsContext";

/** The chip to the owner's page; the page heading is for screen readers. */
export function OwnerItemsHeader() {
  const { owner } = useOwnerItemsPage();
  return (
    <header className="px-5 pt-3">
      <title>{`Rzeczy · ${owner.display_name}`}</title>
      <h1 className="sr-only">Rzeczy: {owner.display_name}</h1>
      <OrganizerHeaderBar organizerName={owner.display_name} organizerSlug={owner.slug ?? owner.party_id} />
    </header>
  );
}
