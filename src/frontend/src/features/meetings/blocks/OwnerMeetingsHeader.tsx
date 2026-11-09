"use client";

import { OrganizerHeaderBar } from "../../../components/shared/OrganizerHeaderBar";
import { useOwnerMeetingsPage } from "../OwnerMeetingsContext";

/** The chip to the owner's page; the page heading is for screen readers. */
export function OwnerMeetingsHeader() {
  const { owner } = useOwnerMeetingsPage();
  return (
    <header className="px-5 pt-3">
      <title>{`Spotkania · ${owner.display_name}`}</title>
      <h1 className="sr-only">Spotkania: {owner.display_name}</h1>
      <OrganizerHeaderBar organizerName={owner.display_name} organizerSlug={owner.slug ?? owner.party_id} />
    </header>
  );
}
