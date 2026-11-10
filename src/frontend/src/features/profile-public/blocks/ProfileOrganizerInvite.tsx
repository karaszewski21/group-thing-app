"use client";

import { CARD } from "../../../components/shared/uiStyles";
import { Link } from "../../../routing/navigation";
import { usePartyProfilePage } from "../PartyProfileContext";

const CTA_LINK =
  "mt-3 flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-[14px] font-extrabold text-on-primary no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring";

/** For the person themself only: an invite to set up an organizer page. */
export function ProfileOrganizerInvite() {
  if (!usePartyProfilePage().profile.is_me) return null;
  return (
    <section aria-labelledby="profile-organizer-heading" className={CARD}>
      <h2 id="profile-organizer-heading" className="text-[15px] font-extrabold text-ink">
        To Twój publiczny profil
      </h2>
      <p className="mt-1.5 text-[13px] text-ink-soft">
        Organizujesz zajęcia albo wymianki? Załóż stronę organizatora — z własną nazwą, kolorami i układem.
      </p>
      <Link to="/organization" className={CTA_LINK}>
        Załóż stronę organizatora
      </Link>
    </section>
  );
}
