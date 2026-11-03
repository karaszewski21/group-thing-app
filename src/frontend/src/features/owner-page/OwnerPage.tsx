"use client";

import { useAppParams } from "../../routing/navigation";
import { isPartyId } from "../../routing/paths";
import { PublicOrganizationPage } from "./PublicOrganizationPage";
import { PartyProfilePage } from "./PartyProfilePage";

/** `/:slug`: a party id opens the person's profile, anything
 * else the Organization's page. Keyed on the segment, so moving between two
 * profiles starts afresh. */
export function OwnerPage() {
  const { slug = "" } = useAppParams<{ slug: string }>();
  return isPartyId(slug) ? (
    <PartyProfilePage key={slug} />
  ) : (
    <PublicOrganizationPage />
  );
}
