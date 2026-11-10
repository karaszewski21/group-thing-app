"use client";

import { NearestSection } from "../../../components/shared/NearestSection";
import { usePartyProfilePage } from "../PartyProfileContext";

/** The person's nearest public date and where to pick things up. */
export function ProfileNearest() {
  const { owner, nearest } = usePartyProfilePage().profile;
  return (
    <NearestSection
      ownerRef={{ kind: "party", partyId: owner.party_id }}
      nearest={nearest}
      name={owner.display_name}
      meetingsHref={`/${owner.party_id}/meetings`}
    />
  );
}
