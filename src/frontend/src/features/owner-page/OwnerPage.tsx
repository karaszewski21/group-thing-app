import { useParams } from "react-router-dom";
import { isPartyId } from "../../utils/appHelpers";
import { PublicOrganizationPage } from "./PublicOrganizationPage";
import { PartyProfilePage } from "./PartyProfilePage";

/** `/:organizationSlug`: a party id opens the person's profile, anything
 * else the Organization's page. Keyed on the segment, so moving between two
 * profiles starts afresh. */
export function OwnerPage() {
  const { organizationSlug = "" } = useParams<{ organizationSlug: string }>();
  return isPartyId(organizationSlug) ? (
    <PartyProfilePage key={organizationSlug} />
  ) : (
    <PublicOrganizationPage />
  );
}
