import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  chatErrorMessage,
  getOrCreateGroupConversation,
  getOrCreateItemConversation,
  getOrCreateTermConversation,
  type ConversationKind,
  type ConversationResponse,
} from "../api/conversations";
import { CONVERSATIONS_KEY } from "./useConversations";

const OPEN_FALLBACK = "Nie udało się otworzyć rozmowy — spróbuj ponownie";

/** What to open a chat about: an item, a group or a term, by id. */
export interface ChatTarget {
  kind: ConversationKind;
  id: string;
}

const GET_OR_CREATE: Record<ConversationKind, (id: string) => Promise<ConversationResponse>> = {
  ITEM: getOrCreateItemConversation,
  GROUP: getOrCreateGroupConversation,
  TERM: getOrCreateTermConversation,
};

/** Get-or-create entry point: resolves to the conversation id to navigate
 * to, or rejects with an `Error` carrying Polish copy. */
export function useOpenConversation(): { openConversation: (target: ChatTarget) => Promise<string> } {
  const queryClient = useQueryClient();

  const openConversation = useCallback(
    async ({ kind, id }: ChatTarget) => {
      let conversation: ConversationResponse;
      try {
        conversation = await GET_OR_CREATE[kind](id);
      } catch (err) {
        throw new Error(chatErrorMessage(err, OPEN_FALLBACK));
      }
      await queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
      return conversation.id;
    },
    [queryClient],
  );

  return { openConversation };
}
