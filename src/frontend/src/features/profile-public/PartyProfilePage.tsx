"use client";

import type { ReactNode } from "react";
import { usePartyProfile } from "../../hooks/usePartyProfile";
import { Navigate, notFound } from "../../routing/navigation";
import { PartyProfileLoadError, PartyProfilePageContext } from "./PartyProfileContext";
import { PartyProfileFrame, PartyProfileSkeleton } from "./PartyProfileSkeleton";
import { resolvePartyProfileView } from "./partyProfileViewState";

/** `/:partyId`: a person's public profile with a fixed layout. Shows exactly
 * one screen per `resolvePartyProfileView` state and gives the blocks passed
 * as `children` (composed in the route's `page.tsx`) their data through
 * `PartyProfilePageContext`. A person who owns an Organization is redirected
 * to its page. */
export function PartyProfilePage({ partyId, children }: { partyId: string; children: ReactNode }) {
  const profile = usePartyProfile(partyId);
  const view = resolvePartyProfileView(profile);
  switch (view.kind) {
    case "loading":
      return <PartyProfileSkeleton />;
    case "redirect":
      return <Navigate to={view.to} replace />;
    case "notFound":
      return notFound();
    case "error":
      throw new PartyProfileLoadError(view.message);
    case "content":
      return (
        <PartyProfilePageContext.Provider value={{ profile: view.profile }}>
          <PartyProfileFrame>{children}</PartyProfileFrame>
        </PartyProfilePageContext.Provider>
      );
  }
}
