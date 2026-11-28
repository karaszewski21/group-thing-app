/** Where the confirm POST stands: `invalid` is a 404/410, `error` any other failure. */
export type VerifyConfirmState = "idle" | "pending" | "success" | "invalid" | "error";

export interface VerifyEmailInput {
  hasToken: boolean;
  lookup: { email: string | null; loading: boolean; invalid: boolean; error: string | null };
  confirm: VerifyConfirmState;
}

/** The one screen `/verify-email` shows:
 * - `loading`: the token lookup runs.
 * - `error`: the lookup or the confirm failed (network/5xx); `retry` names
 *   the call „Spróbuj ponownie” repeats.
 * - `confirm`: the token's address, confirmed only by the button.
 * - `success`: the address is confirmed.
 * - `invalid`: no token, or the lookup or confirm answered 404/410.
 * A finished confirm wins over the lookup (M-6), so a token the confirm used
 * up never turns the success screen into "invalid". */
export type VerifyEmailView =
  | { kind: "loading" }
  | { kind: "error"; retry: "lookup" | "confirm" }
  | { kind: "confirm"; email: string; confirming: boolean }
  | { kind: "success" }
  | { kind: "invalid" };

export function resolveVerifyEmailView({ hasToken, lookup, confirm }: VerifyEmailInput): VerifyEmailView {
  if (confirm === "success") return { kind: "success" };
  if (confirm === "invalid") return { kind: "invalid" };
  if (confirm === "error") return { kind: "error", retry: "confirm" };
  if (!hasToken || lookup.invalid) return { kind: "invalid" };
  if (lookup.error !== null) return { kind: "error", retry: "lookup" };
  if (lookup.loading || lookup.email === null) return { kind: "loading" };
  return { kind: "confirm", email: lookup.email, confirming: confirm === "pending" };
}
