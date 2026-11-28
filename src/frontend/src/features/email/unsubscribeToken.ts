import type { EmailCategory } from "../../api/email";

/** The Polish names of the mailed categories, as `/settings` shows them. */
export const EMAIL_CATEGORY_LABELS: Record<EmailCategory, string> = {
  RESERVATIONS: "Rezerwacje i wymiany",
  WANTS: "Szukam",
};

function isEmailCategory(value: string): value is EmailCategory {
  return Object.hasOwn(EMAIL_CATEGORY_LABELS, value);
}

/** The category an unsubscribe token `1.<CATEGORY>.<party_id>.<sig>` names,
 * or `null` when the token does not have that shape. Only the server checks
 * the signature; this just lets the page name the category before the POST. */
export function parseUnsubscribeCategory(token: string | null): EmailCategory | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "1" || parts.some((part) => part === "")) return null;
  return isEmailCategory(parts[1]) ? parts[1] : null;
}
