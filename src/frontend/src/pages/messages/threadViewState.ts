import type { ConversationResponse, ReadOnlyReason } from "../../api/conversations";
import type { useConversation } from "../../hooks/useConversation";
import type { useThread } from "../../hooks/useThread";

export type ConversationState = Omit<ReturnType<typeof useConversation>, "refetch">;
export type ThreadState = Pick<ReturnType<typeof useThread>, "items" | "loading" | "error">;

/** The one screen the thread page shows:
 * - `loading`: the header or the first page of messages is still loading.
 * - `notFound`: no such conversation (404, or 400 for a malformed id).
 * - `denied`: the caller is not a participant (403).
 * - `error`: anything else, while nothing can be shown. A failed poll with
 *   messages already held keeps the thread on screen; the next poll retries.
 * - `readOnly`: the group was deleted or switched to PUBLIC.
 * - `ready`: a writable thread. */
export type ThreadViewState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "denied" }
  | { kind: "error"; message: string }
  | { kind: "readOnly"; conversation: ConversationResponse; reason: NonNullable<ReadOnlyReason> }
  | { kind: "ready"; conversation: ConversationResponse };

export type ThreadContentView = Extract<ThreadViewState, { kind: "ready" | "readOnly" }>;

export function resolveThreadView({
  conversation,
  thread,
}: {
  conversation: ConversationState;
  thread: ThreadState;
}): ThreadViewState {
  if (conversation.notFound) return { kind: "notFound" };
  if (conversation.denied) return { kind: "denied" };
  if (conversation.error !== null) return { kind: "error", message: conversation.error };
  if (conversation.loading || conversation.conversation === null || thread.loading) return { kind: "loading" };
  if (thread.error !== null && thread.items.length === 0) return { kind: "error", message: thread.error };

  const current = conversation.conversation;
  if (current.read_only_reason !== null) {
    return { kind: "readOnly", conversation: current, reason: current.read_only_reason };
  }
  return { kind: "ready", conversation: current };
}
