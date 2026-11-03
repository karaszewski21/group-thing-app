import { SubPageHeader } from "../../components/shared/appComponents";
import { viewPath } from "../../routing/paths";

/** The back link above each Konto sub-page (profile, settings, places,
 * family, wanted, organization). */
export function AccountSubPageHeader() {
  return <SubPageHeader backTo={viewPath("account")} backLabel="Wróć do konta" />;
}
