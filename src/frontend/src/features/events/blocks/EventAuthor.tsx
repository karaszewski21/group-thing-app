"use client";

import { useAppNavigate } from "../../../routing/navigation";
import { viewPath } from "../../../routing/paths";
import { EventAuthorCard } from "../components/EventAuthorCard";
import { useEventPage } from "../EventPageContext";

/** The author's edit and delete card; nothing for anyone else. */
export function EventAuthor() {
  const { view, actions } = useEventPage();
  const navigate = useAppNavigate();
  if (view.kind !== "author") return null;
  return (
    <EventAuthorCard
      event={view.event}
      onDelete={async () => {
        await actions.remove();
        navigate(viewPath("meetings"));
      }}
    />
  );
}
