import { Outlet, useParams } from "react-router-dom";
import { PhoneFrame } from "../../components/shared/PhoneFrame";
import { useItemPagePrefetch } from "../../hooks/useItemDetail";
import { usePublicOrganization } from "../../hooks/usePublicOrganization";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { ItemBackButton } from "./ItemBackButton";
import { ItemLoadStates } from "./ItemLoadStates";

/** `/:organizationSlug/produkt/:id[/edit]`: the item pages in the organizer's
 * palette, without the panel nav. The item reads start right away, in
 * parallel with the organization; until the organization settles a neutral
 * loader shows in the default palette, so content never paints in the wrong
 * colors. An unknown organization or a failed read gives the default palette. */
export function OrganizerItemLayout() {
  const { organizationSlug = "", id = "" } = useParams();
  const organization = usePublicOrganization(organizationSlug);
  useItemPagePrefetch(id);

  if (organization.loading) {
    return (
      <PhoneFrame>
        <div className="flex-1 overflow-y-auto px-[18px] pb-6 pt-[18px]">
          <ItemBackButton />
          <ItemLoadStates notFound={false} error={null} loading />
        </div>
      </PhoneFrame>
    );
  }

  return (
    <OrganizerThemeScope theme={organization.data}>
      <PhoneFrame>
        <Outlet />
      </PhoneFrame>
    </OrganizerThemeScope>
  );
}
