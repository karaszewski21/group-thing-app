"use client";

import { OrganizerHeaderBar } from "../../../components/shared/OrganizerHeaderBar";
import { useGroupTermsPage } from "../GroupTermsContext";

/** The chip back to the Organization's page and the tab title. */
export function GroupTermsHeader() {
  const { owner, group } = useGroupTermsPage();
  return (
    <header className="px-5 pt-3">
      <title>{`${group.name} · ${owner.display_name}`}</title>
      <OrganizerHeaderBar organizerName={owner.display_name} organizerSlug={owner.slug ?? owner.party_id} />
    </header>
  );
}
