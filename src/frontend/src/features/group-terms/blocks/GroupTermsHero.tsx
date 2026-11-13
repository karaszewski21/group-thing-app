"use client";

import { GroupCard, NextTermLink } from "../../organization-public/blocks/GroupCard";
import { useGroupTermsPage } from "../GroupTermsContext";

/** The big group tile, the page's `h1`, with the next term's call to action. */
export function GroupTermsHero() {
  const { owner, group, description } = useGroupTermsPage();
  return (
    <div className="px-6 pt-4">
      <GroupCard group={group} headingLevel={1} description={description}>
        <NextTermLink slug={owner.slug ?? owner.party_id} group={group} />
      </GroupCard>
    </div>
  );
}
