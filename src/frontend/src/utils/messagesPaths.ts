/** The messages inbox route. */
export const INBOX_PATH = "/wiadomosci";

/** The route of one conversation's thread. */
export function threadPath(conversationId: string): string {
  return `${INBOX_PATH}/${conversationId}`;
}
