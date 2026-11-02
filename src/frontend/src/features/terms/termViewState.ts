import type { PublicCircleResponse } from "../../api/groups";
import type { TermAccessState } from "../../hooks/useTermAccess";

/** The one screen the term page shows, derived from the `/access` state:
 * - `loading`: first load, or a private gate resolved for another token
 *   while the current token's answer is pending.
 * - `notFound`: no such circle / term (both are the same 404).
 * - `content`: the caller may see the term (PUBLIC group, member, organizer).
 * - `loginRequired`: PRIVATE group, anonymous visitor.
 * - `enterCode`: PRIVATE group, logged-in non-member.
 * - `refreshFailed`: the gate was resolved for another token and the fetch
 *   for the current one failed, so only a retry is offered.
 * The `content` flags come from the server only (never from the guest RSVP
 * in local storage): `isAttending` drives the sign-up footer, the others gate
 * the chat buttons. */
export type TermViewState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | {
      kind: "content";
      group: PublicCircleResponse;
      isAttending: boolean;
      isOrganizer: boolean;
      isMember: boolean;
      isActiveAttendee: boolean;
    }
  | { kind: "loginRequired"; group: PublicCircleResponse; refreshError: string | null }
  | { kind: "enterCode"; group: PublicCircleResponse; refreshError: string | null }
  | { kind: "refreshFailed"; group: PublicCircleResponse };

export type PrivateViewState = Extract<TermViewState, { kind: "loginRequired" | "enterCode" | "refreshFailed" }>;

/** `forToken` is the token the data was fetched with — not whether one exists
 * now — so data fetched anonymously never offers the code entry. */
export function resolveTermView(state: TermAccessState, isStale: boolean): TermViewState {
  if (state.status === "loading") return { kind: "loading" };
  if (state.status === "error") return { kind: "notFound" };

  const { group, access } = state.data;
  if (access.can_view_content) {
    return {
      kind: "content",
      group,
      isAttending: access.is_attending,
      isOrganizer: access.is_organizer,
      isMember: access.is_member,
      isActiveAttendee: access.is_active_attendee,
    };
  }
  if (isStale) return state.refreshError === null ? { kind: "loading" } : { kind: "refreshFailed", group };
  const refreshError = state.refreshError;
  return state.forToken === null
    ? { kind: "loginRequired", group, refreshError }
    : { kind: "enterCode", group, refreshError };
}
