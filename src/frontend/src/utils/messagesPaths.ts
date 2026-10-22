/** The messages inbox route. */
export const INBOX_PATH = "/panel/wiadomosci";

/** The route of one conversation's thread. */
export function threadPath(conversationId: string): string {
  return `${INBOX_PATH}/${conversationId}`;
}
