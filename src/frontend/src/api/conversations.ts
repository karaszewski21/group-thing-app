import { api } from "./client";
import { hasStatus, serverMessageOr } from "./problem";

export type ConversationKind = "ITEM" | "GROUP" | "TERM";

export type ReadOnlyReason = "GROUP_DELETED" | "GROUP_PUBLIC" | null;

export interface ConversationItemRef {
  id: string;
  name: string;
  deleted: boolean;
}

interface ConversationBase {
  id: string;
  kind: ConversationKind;
  /** Built by the server (item name, group name, or "Termin: śr 29.10 17:00"). */
  title: string;
  /** ITEM only. */
  item: ConversationItemRef | null;
  /** ITEM only: the other side of the conversation. */
  counterpart_name: string | null;
  /** GROUP and TERM only. */
  group_name: string | null;
  /** TERM only: naive Warsaw wall-clock time, never converted. */
  term_occurs_on: string | null;
  unread_count: number;
  read_only_reason: ReadOnlyReason;
}

export interface LastMessage {
  body: string;
  sender_name: string;
  is_mine: boolean;
  sender_is_organizer: boolean;
  /** Naive UTC. */
  created_at: string;
}

export interface InboxRow extends ConversationBase {
  last_message: LastMessage;
}

export interface ConversationResponse extends ConversationBase {
  /** GROUP and TERM only. */
  participant_count: number | null;
}

export interface MessageResponse {
  id: string;
  body: string;
  /** Naive UTC. */
  created_at: string;
  is_mine: boolean;
  sender_name: string;
  sender_is_organizer: boolean;
}

/** Ascending by `(created_at, id)`. Without a cursor or with `before`,
 * `has_more` means older messages exist; with `after`, newer ones do. */
export interface MessagePage {
  items: MessageResponse[];
  has_more: boolean;
}

export type MessageCursor = { before: string } | { after: string };

export function getConversations(): Promise<InboxRow[]> {
  return api.get("/conversations");
}

export function getUnreadMessageCount(): Promise<{ count: number }> {
  return api.get("/conversations/unread-count");
}

export function getOrCreateItemConversation(itemId: string): Promise<ConversationResponse> {
  return api.post("/conversations/item", { item_id: itemId });
}

export function getOrCreateGroupConversation(groupId: string): Promise<ConversationResponse> {
  return api.post("/conversations/group", { group_id: groupId });
}

export function getOrCreateTermConversation(termId: string): Promise<ConversationResponse> {
  return api.post("/conversations/term", { term_id: termId });
}

export function getConversation(id: string): Promise<ConversationResponse> {
  return api.get(`/conversations/${id}`);
}

export function getMessages(id: string, cursor?: MessageCursor): Promise<MessagePage> {
  const query = cursor ? `?${new URLSearchParams(cursor).toString()}` : "";
  return api.get(`/conversations/${id}/messages${query}`);
}

export function postMessage(id: string, body: string): Promise<MessageResponse> {
  return api.post(`/conversations/${id}/messages`, { body });
}

export function markConversationRead(id: string, messageId: string): Promise<void> {
  return api.post(`/conversations/${id}/read`, { message_id: messageId });
}

/** Polish copy for every messaging error: fixed text for 403/404, the
 * server's own Polish message for 400/409/429/503, otherwise `fallback`. */
export function chatErrorMessage(err: unknown, fallback: string): string {
  if (hasStatus(err, 403)) return "Nie masz dostępu do tego czatu.";
  if (hasStatus(err, 404)) return "Nie znaleziono — mogło zostać usunięte.";
  return serverMessageOr(err, fallback);
}
