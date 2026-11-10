"use client";

import { CARD } from "../../../components/shared/uiStyles";
import { Link } from "../../../routing/navigation";
import { usePartyProfilePage } from "../PartyProfileContext";

const CTA_LINK =
  "mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-extrabold text-on-primary no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** For the person themself only: a link to their Organization's page, or
 * without one an invite to found it. */
export function ProfileOrganizerInvite() {
  const { is_me, organization } = usePartyProfilePage().profile;
  if (!is_me) return null;
  if (organization) {
    return (
      <section aria-labelledby="profile-organizer-heading" className={`mx-6 ${CARD}`}>
        <h2 id="profile-organizer-heading" className="text-[15px] font-extrabold text-ink">
          To Twój publiczny profil
        </h2>
        <p className="mt-1.5 text-[13px] text-ink-soft">
          Masz też stronę organizacji — ze wszystkimi układami.
        </p>
        <Link to={`/${organization.slug}`} className={CTA_LINK}>
          Przejdź do strony organizacji „{organization.name}”
        </Link>
      </section>
    );
  }
  return (
    <section aria-labelledby="profile-organizer-heading" className={`mx-6 ${CARD}`}>
      <h2 id="profile-organizer-heading" className="text-[15px] font-extrabold text-ink">
        To Twój publiczny profil
      </h2>
      <p className="mt-1.5 text-[13px] text-ink-soft">
        Organizujesz zajęcia albo wymianki? Załóż organizację — odblokujesz wszystkie układy, a Twoje zdjęcia przeniesiemy.
      </p>
      <Link to="/organization" className={CTA_LINK}>
        Załóż organizację
      </Link>
    </section>
  );
}
