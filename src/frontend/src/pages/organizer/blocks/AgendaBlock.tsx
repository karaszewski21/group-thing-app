import { useState } from "react";
import { useOrganizerTerms } from "../../../hooks/useOrganizerTerms";
import type { BlockProps, OrganizerPageData } from "../layouts/types";
import { AgendaResults } from "./AgendaResults";
import { CircleFilterChips } from "./CircleFilterChips";

// eslint-disable-next-line react-refresh/only-export-components -- the renderer reads each block's isEmpty next to it
export function isAgendaEmpty(data: OrganizerPageData): boolean {
  return !data.directory || data.directory.circles.every((circle) => circle.next_term === null);
}

/** `by-day`: the organizer's full forward agenda, a page at a time, with a
 * circle filter when there are at least 2 circles. */
export function AgendaBlock({ data }: BlockProps) {
  const [groupId, setGroupId] = useState<string | undefined>();
  const agenda = useOrganizerTerms(data.organization.slug, groupId);
  const circles = data.directory?.circles ?? [];

  if (agenda.notFound) return null;

  return (
    <section>
      <div className="flex flex-col gap-3 px-6 pt-6">
        <h2 className="font-serif text-lg font-semibold text-ink">Plan zajęć</h2>
        <CircleFilterChips circles={circles} selected={groupId} onSelect={setGroupId} />
      </div>
      <AgendaResults
        key={groupId ?? ""}
        slug={data.organization.slug}
        agenda={agenda}
        moreLabel="Pokaż kolejne terminy"
        dayHeadingLevel={3}
        onShowAll={groupId === undefined ? undefined : () => setGroupId(undefined)}
      />
    </section>
  );
}
