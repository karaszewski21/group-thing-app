"use client";

import { usePartyProfile } from "../../hooks/usePartyProfile";
import { notFound } from "../../routing/navigation";
import { OrganizerThemeScope } from "../../theme/OrganizerThemeScope";
import { ProfileLayoutRenderer } from "./layouts/ProfileLayoutRenderer";
import { PartyProfileLoadError, PartyProfilePageContext } from "./PartyProfileContext";
import { PartyProfileColumn, PartyProfileSkeleton } from "./PartyProfileSkeleton";
import { resolvePartyProfileView } from "./partyProfileViewState";

/** `/:partyId`: a person's public profile in the layout and colors they
 * chose. Shows exactly one screen per `resolvePartyProfileView` state and
 * gives the layout's blocks their data through `PartyProfilePageContext`.
 * It stays the person's page when they also own an Organization. */
export function PartyProfilePage({ partyId }: { partyId: string }) {
  const profile = usePartyProfile(partyId);
  const view = resolvePartyProfileView(profile);
  switch (view.kind) {
    case "loading":
      return <PartyProfileSkeleton />;
    case "notFound":
      return notFound();
    case "error":
      throw new PartyProfileLoadError(view.message);
    case "content":
      return (
        <PartyProfilePageContext.Provider
          value={{ profile: view.profile, hasTerms: view.hasTerms, hasItems: view.hasItems }}
        >
          <OrganizerThemeScope theme={view.profile}>
            <PartyProfileColumn>
              <ProfileLayoutRenderer layoutKey={view.profile.page_layout} />
            </PartyProfileColumn>
          </OrganizerThemeScope>
        </PartyProfilePageContext.Provider>
      );
  }
}
