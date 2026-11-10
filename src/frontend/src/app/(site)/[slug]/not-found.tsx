"use client";

import { OrganizationNotFound } from "../../../features/organization-public/OrganizationRouteStates";
import { PartyProfileNotFound } from "../../../features/profile-public/PartyProfileRouteStates";
import { useAppParams } from "../../../routing/navigation";
import { isPartyId } from "../../../routing/paths";

export default function NotFound() {
  const { slug = "" } = useAppParams<{ slug: string }>();
  return isPartyId(slug) ? <PartyProfileNotFound /> : <OrganizationNotFound />;
}
