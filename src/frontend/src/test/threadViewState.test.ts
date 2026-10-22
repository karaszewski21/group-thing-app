import { describe, expect, it } from "vitest";
import type { ConversationResponse, MessageResponse } from "../api/conversations";
import {
  resolveThreadView,
  type ConversationState,
  type ThreadState,
  type ThreadViewState,
} from "../pages/messages/threadViewState";

const conversation: ConversationResponse = {
  id: "c1",
  kind: "GROUP",
  title: "Joga w parku",
  item: null,
  counterpart_name: null,
  group_name: "Joga w parku",
  term_occurs_on: null,
  unread_count: 0,
  read_only_reason: null,
  participant_count: 12,
};

const message: MessageResponse = {
  id: "m1",
  body: "Cześć",
  created_at: "2026-10-22T10:00:00",
  is_mine: false,
  sender_name: "Marta Nowak",
  sender_is_organizer: true,
};

function conv(partial: Partial<ConversationState> = {}): ConversationState {
  return { conversation, notFound: false, denied: false, loading: false, error: null, ...partial };
}

function thread(partial: Partial<ThreadState> = {}): ThreadState {
  return { items: [message], loading: false, error: null, ...partial };
}

const deleted = { ...conversation, read_only_reason: "GROUP_DELETED" as const };
const publicGroup = { ...conversation, read_only_reason: "GROUP_PUBLIC" as const };

describe("resolveThreadView", () => {
  it.each<[string, ConversationState, ThreadState, ThreadViewState]>([
    ["conversation loading", conv({ conversation: null, loading: true }), thread(), { kind: "loading" }],
    ["messages loading", conv(), thread({ items: [], loading: true }), { kind: "loading" }],
    ["404", conv({ conversation: null, notFound: true }), thread({ error: "x" }), { kind: "notFound" }],
    ["400 malformed id", conv({ conversation: null, notFound: true }), thread(), { kind: "notFound" }],
    ["403", conv({ conversation: null, denied: true }), thread({ error: "x" }), { kind: "denied" }],
    [
      "conversation error",
      conv({ conversation: null, error: "Nie udało się wczytać wiadomości" }),
      thread(),
      { kind: "error", message: "Nie udało się wczytać wiadomości" },
    ],
    [
      "messages error with nothing held",
      conv(),
      thread({ items: [], error: "Nie udało się wczytać wiadomości" }),
      { kind: "error", message: "Nie udało się wczytać wiadomości" },
    ],
    ["poll failure with messages held", conv(), thread({ error: "x" }), { kind: "ready", conversation }],
    [
      "deleted group",
      conv({ conversation: deleted }),
      thread(),
      { kind: "readOnly", conversation: deleted, reason: "GROUP_DELETED" },
    ],
    [
      "public group",
      conv({ conversation: publicGroup }),
      thread(),
      { kind: "readOnly", conversation: publicGroup, reason: "GROUP_PUBLIC" },
    ],
    ["writable", conv(), thread(), { kind: "ready", conversation }],
    ["empty writable thread", conv(), thread({ items: [] }), { kind: "ready", conversation }],
  ])("%s", (_label, conversationState, threadState, expected) => {
    expect(resolveThreadView({ conversation: conversationState, thread: threadState })).toEqual(expected);
  });
});
