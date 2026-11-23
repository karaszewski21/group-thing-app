"use client";

import { OrganizationPageError } from "../../../features/organization-public/OrganizationRouteStates";
import { PartyProfileError } from "../../../features/profile-public/PartyProfileRouteStates";
import { useAppParams } from "../../../routing/navigation";
import { isPartyId } from "../../../routing/paths";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { slug = "" } = useAppParams<{ slug: string }>();
  return isPartyId(slug) ? (
    <PartyProfileError error={error} reset={reset} />
  ) : (
    <OrganizationPageError error={error} reset={reset} />
  );
}
