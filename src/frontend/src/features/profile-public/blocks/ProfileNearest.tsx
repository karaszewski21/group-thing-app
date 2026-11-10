"use client";

import { NearestSection } from "../../../components/shared/NearestSection";
import { usePartyProfilePage } from "../PartyProfileContext";
import { ProfileEmptyBox } from "./ProfileEmptyBox";

/** The person's nearest public date and where to pick things up; without
 * any, an empty box (with "+" for the owner, unless `ProfileStartHere`
 * already covers both sections). */
export function ProfileNearest() {
  const { profile, hasTerms, hasItems } = usePartyProfilePage();
  const { owner, nearest, is_me } = profile;
  if (!hasTerms) {
    if (!is_me) return <ProfileEmptyBox title="Ten użytkownik nie dodał jeszcze żadnych terminów." />;
    return hasItems ? <ProfileEmptyBox title="Nie masz jeszcze terminów" addLabel="Dodaj termin" /> : null;
  }
  return (
    <div className="px-6">
      <NearestSection
        ownerRef={{ kind: "party", partyId: owner.party_id }}
        nearest={nearest}
        name={owner.display_name}
        meetingsHref={`/${owner.party_id}/meetings`}
      />
    </div>
  );
}
