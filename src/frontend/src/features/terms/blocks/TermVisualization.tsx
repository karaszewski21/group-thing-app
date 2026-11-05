"use client";

import { GroupVisualization } from "../components/visualization/GroupVisualization";
import { buildVisualizationFamilies } from "../termViewModel";
import { useTermPage } from "../TermPageContext";

/** The group as a circle, pitch or table; picking a family jumps to its
 * entry in the attendee list. */
export function TermVisualization() {
  const {
    view: { group },
    activePartyId,
    selectAttendee,
  } = useTermPage();
  return (
    <section aria-label="Krąg zajęć" className="mx-5 rounded-[30px] bg-primary-soft pb-4">
      <GroupVisualization
        layoutMode={group.layout_mode}
        organizerName={group.organizer_display_name ?? ""}
        families={buildVisualizationFamilies(group)}
        activeFamilyId={activePartyId}
        onSelectFamily={selectAttendee}
        groupId={group.id}
      />
    </section>
  );
}
