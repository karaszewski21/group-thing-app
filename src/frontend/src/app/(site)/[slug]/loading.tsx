"use client";

import { OrganizerPageSkeleton } from "../../../features/organization-public/OrganizerPageSkeleton";
import { PartyProfileSkeleton } from "../../../features/profile-public/PartyProfileSkeleton";
import { useAppParams } from "../../../routing/navigation";
import { isPartyId } from "../../../routing/paths";

export default function Loading() {
  const { slug = "" } = useAppParams<{ slug: string }>();
  return isPartyId(slug) ? <PartyProfileSkeleton /> : <OrganizerPageSkeleton />;
}
