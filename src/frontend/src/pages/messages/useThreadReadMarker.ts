import { useEffect, useRef } from "react";
import type { ThreadViewState } from "./threadViewState";

/** Marks the newest held message read when the thread opens and whenever a
 * newer one arrives, in the views that show messages. A failed mark is
 * retried with the next newer message. When the newest message is my own the
 * mark is skipped: sending already moved my read marker past it. */
export function useThreadReadMarker(
  kind: ThreadViewState["kind"],
  lastId: string | null,
  lastIsMine: boolean,
  markRead: (messageId: string) => Promise<void>,
) {
  const markedId = useRef<string | null>(null);

  useEffect(() => {
    if (kind !== "ready" && kind !== "readOnly") return;
    if (lastId === null || lastIsMine || markedId.current === lastId) return;
    markedId.current = lastId;
    markRead(lastId).catch(() => {
      if (markedId.current === lastId) markedId.current = null;
    });
  }, [kind, lastId, lastIsMine, markRead]);
}
