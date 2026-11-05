"use client";

import type { PublicCircleResponse } from "../../../api/groups";
import { GroupHeader } from "../components/GroupHeader";
import { useTermPage } from "../TermPageContext";

/** The header chip's target: the Organization's page, else, for a PUBLIC
 * circle, the organizer's person profile (a `k-…` slug has no page). */
function organizerPageSegment(group: PublicCircleResponse): string | null {
  if (group.organization !== null) return group.organizer_slug;
  return group.visibility === "PUBLIC" ? group.organizer_party_id : null;
}

/** The chip to the organizer's page and the group's name. */
export function TermHeader() {
  const { group } = useTermPage().view;
  return (
    <GroupHeader
      title={group.name}
      organizerName={group.organizer_display_name}
      organizerSlug={organizerPageSegment(group)}
    />
  );
}
