"use client";

import { familyInitials, familyTone } from "../../../components/shared/Avatar";
import { SettingsIcon } from "../../../components/shared/appIcons";
import { Link } from "../../../routing/navigation";
import { appearancePath } from "../../../routing/paths";
import { SafeImage } from "../../product/ItemGallery";
import { usePartyProfilePage } from "../PartyProfileContext";
import { BackButton } from "../PartyProfileSkeleton";

const FOCUS_RING = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";
const PILL = `flex min-h-11 items-center rounded-full bg-paper/90 px-3.5 text-[14px] font-bold text-ink shadow-md hover:bg-paper ${FOCUS_RING}`;

/** The banner (the cover photo, else a primary color band) with "Wróć" and,
 * for the person themself, the settings gear over it, and the avatar (else
 * initials) centered across its lower edge. */
export function ProfileHero() {
  const { profile } = usePartyProfilePage();
  const name = profile.owner.display_name;
  return (
    <div className="relative">
      {profile.cover ? (
        <SafeImage src={profile.cover.url} alt="" className="block h-36 w-full object-cover" placeholderSize={32} />
      ) : (
        <span aria-hidden="true" className="block h-36 w-full bg-primary" />
      )}
      <div className="absolute inset-x-4 top-3 flex items-start justify-between">
        <BackButton className={`gap-1.5 ${PILL}`} />
        {profile.is_me && (
          <Link
            to={appearancePath(profile.owner.party_id)}
            aria-label="Ustawienia"
            title="Ustawienia"
            className={`flex h-11 w-11 items-center justify-center rounded-full bg-paper/90 text-ink shadow-md hover:bg-paper ${FOCUS_RING}`}
          >
            <SettingsIcon c="currentColor" />
          </Link>
        )}
      </div>
      <div className="-mt-10 flex justify-center">
        {profile.avatar ? (
          <SafeImage
            src={profile.avatar.thumb_url}
            alt=""
            className="relative size-20 shrink-0 rounded-full border-[3px] border-paper object-cover"
            placeholderSize={24}
          />
        ) : (
          <span
            aria-hidden="true"
            className={`relative flex size-20 shrink-0 items-center justify-center rounded-full border-[3px] border-paper text-[24px] font-extrabold text-ink ${familyTone(name)}`}
          >
            {familyInitials(name)}
          </span>
        )}
      </div>
    </div>
  );
}
