"use client";

import { useOpenAndNavigate } from "../../../hooks/useOpenAndNavigate";
import { useTermPage } from "../TermPageContext";

const CHAT_BUTTON =
  "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border-[1.5px] border-line bg-paper px-3 text-[13px] font-extrabold text-ink hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:opacity-60";

/** "Czat terminu" / "Czat grupy", gated on server flags only; opens (or
 * creates) the chat and goes to its thread, or shows the error inline. */
export function TermChats() {
  const { view, isLoggedIn } = useTermPage();
  const { open, busy, error } = useOpenAndNavigate();
  const { group, isActiveAttendee, isMember, isOrganizer } = view;
  const termId = group.term?.id ?? null;
  const showTermChat = termId !== null && isLoggedIn && (isActiveAttendee || isOrganizer);
  const showGroupChat = isLoggedIn && group.visibility === "PRIVATE" && (isMember || isOrganizer);
  if (!showTermChat && !showGroupChat) return null;

  return (
    <div className="mx-5 mt-3">
      <div className="flex gap-2">
        {showTermChat && (
          <button
            type="button"
            className={CHAT_BUTTON}
            disabled={busy}
            onClick={() => void open({ kind: "TERM", id: termId })}
          >
            <span aria-hidden="true">💬</span> Czat terminu
          </button>
        )}
        {showGroupChat && (
          <button
            type="button"
            className={CHAT_BUTTON}
            disabled={busy}
            onClick={() => void open({ kind: "GROUP", id: group.id })}
          >
            <span aria-hidden="true">👥</span> Czat grupy
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
