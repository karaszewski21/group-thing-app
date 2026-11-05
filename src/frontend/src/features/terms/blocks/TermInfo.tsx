"use client";

import { TermCard } from "../components/TermCard";
import { useTermPage } from "../TermPageContext";

/** When the term takes place, and whether it is full. */
export function TermInfo() {
  const { term } = useTermPage().view.group;
  return (
    <TermCard
      date={term?.occurs_on ?? ""}
      capacity={term?.capacity ?? null}
      attendeeCount={term?.attendee_count}
    />
  );
}
