"use client";

import type { PublicOrganizationResponse } from "../../../../api/organizations";
import { familyInitials } from "../../../../components/shared/Avatar";
import { Link } from "../../../../routing/navigation";
import { ItemBackButton } from "../ItemBackButton";
import { ItemGallery } from "../ItemGallery";
import { useItemPage } from "../ItemPageContext";
import { useOrganizerItemOrganization } from "../OrganizerItemContext";

/** Full-bleed gallery with the back button (and organizer chip) over it. */
export function ItemHero() {
  const { item } = useItemPage();
  const deleted = item.deleted_at !== null;
  const organization = useOrganizerItemOrganization();
  return (
    <div className="relative">
      <ItemGallery
        name={item.name}
        photos={item.photos}
        productPhotoUrl={item.product_photo_url}
        faded={deleted}
        showOwnerHint={item.is_owner && !deleted}
      />
      <div className="pointer-events-none absolute inset-x-4 top-3.5 flex items-start justify-between gap-3 *:pointer-events-auto">
        <ItemBackButton overlay />
        {organization && <OrganizerChip organization={organization} />}
      </div>
    </div>
  );
}

/** A chip back to the owner's Organization page, laid over the item photo. */
function OrganizerChip({ organization }: { organization: PublicOrganizationResponse }) {
  return (
    <Link
      to={`/${organization.slug}`}
      className="flex min-h-10 max-w-[60%] items-center gap-2 rounded-full bg-paper py-1 pr-3.5 pl-1.5 text-[13px] font-bold text-ink shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
    >
      {organization.logo ? (
        <img src={organization.logo.thumb_url} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-[10px] bg-primary font-serif text-xs font-extrabold text-on-primary"
        >
          {familyInitials(organization.name)}
        </span>
      )}
      <span className="truncate">{organization.name}</span>
    </Link>
  );
}
