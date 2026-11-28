import type { EmailCategory, UnsubscribeScope } from "../../api/email";

/** Where the unsubscribe POST stands: `invalid` is the server's 404, `error`
 * any other failure (the choice stays, with an alert). */
export type UnsubscribeSubmitState =
  | { status: "idle" }
  | { status: "pending"; scope: UnsubscribeScope }
  | { status: "error" }
  | { status: "invalid" }
  | { status: "done"; category: EmailCategory; scope: UnsubscribeScope };

export interface UnsubscribeInput {
  /** The category parsed from the token, `null` when it cannot be read. */
  category: EmailCategory | null;
  submit: UnsubscribeSubmitState;
}

/** The one screen `/unsubscribe` shows:
 * - `invalid`: an unreadable token, or the server did not recognise it.
 * - `choice`: this category or every notification mail; `pending` is the
 *   scope being saved, `failed` shows the retry alert.
 * - `done`: the server turned the chosen scope off. */
export type UnsubscribeView =
  | { kind: "invalid" }
  | { kind: "choice"; category: EmailCategory; pending: UnsubscribeScope | null; failed: boolean }
  | { kind: "done"; category: EmailCategory; scope: UnsubscribeScope };

export function resolveUnsubscribeView({ category, submit }: UnsubscribeInput): UnsubscribeView {
  if (category === null) return { kind: "invalid" };
  switch (submit.status) {
    case "done":
      return { kind: "done", category: submit.category, scope: submit.scope };
    case "invalid":
      return { kind: "invalid" };
    case "pending":
      return { kind: "choice", category, pending: submit.scope, failed: false };
    case "error":
      return { kind: "choice", category, pending: null, failed: true };
    case "idle":
      return { kind: "choice", category, pending: null, failed: false };
  }
}
