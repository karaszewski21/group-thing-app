export type ResetRequestStatus = "idle" | "sending" | "sent" | "unavailable" | "error";
export type ResetConfirmStatus = "idle" | "saving" | "success" | "invalid" | "error";

/** The one screen of `/reset-password`. Without a token: the request form,
 * its neutral sent screen, the form with the 503 alert. With `?token=`: the
 * lookup's busy state, the new-password form, an invalid link, success. */
export type ResetPasswordViewState =
  | { kind: "request"; sending: boolean }
  | { kind: "unavailable" }
  | { kind: "sent"; email: string }
  | { kind: "loading" }
  | { kind: "form"; email: string; saving: boolean; mismatch: boolean; canSave: boolean }
  | { kind: "invalid" }
  | { kind: "success" }
  | { kind: "error"; retry: "request" | "lookup" | "confirm"; email: string | null };

export interface ResetPasswordViewInput {
  token: string | null;
  request: { status: ResetRequestStatus; email: string };
  lookup: { loading: boolean; invalid: boolean; error: string | null; email: string | null };
  confirm: { status: ResetConfirmStatus; password: string; repeat: string };
}

/** With a token the confirm outcome wins over the lookup (success first), so
 * a lookup that turns 410 once the token is used never hides the success. */
export function resolveResetPasswordView({ token, request, lookup, confirm }: ResetPasswordViewInput): ResetPasswordViewState {
  if (token === null) {
    switch (request.status) {
      case "sent":
        return { kind: "sent", email: request.email };
      case "unavailable":
        return { kind: "unavailable" };
      case "error":
        return { kind: "error", retry: "request", email: null };
      default:
        return { kind: "request", sending: request.status === "sending" };
    }
  }

  if (confirm.status === "success") return { kind: "success" };
  if (confirm.status === "invalid") return { kind: "invalid" };
  if (confirm.status === "error") return { kind: "error", retry: "confirm", email: lookup.email };

  if (lookup.invalid) return { kind: "invalid" };
  if (lookup.error !== null) return { kind: "error", retry: "lookup", email: null };
  if (lookup.loading || lookup.email === null) return { kind: "loading" };

  const saving = confirm.status === "saving";
  const mismatch = confirm.repeat !== "" && confirm.repeat !== confirm.password;
  const complete = confirm.password !== "" && confirm.repeat !== "";
  return { kind: "form", email: lookup.email, saving, mismatch, canSave: complete && !mismatch && !saving };
}
