import type { PendingJoinRequestResponse } from "../../api/groups";
import type { NotificationResponse } from "../../api/notifications";
import { getReservation } from "../../api/reservations";
import { getMyTakenTermItemListings, getMyTermItemListings } from "../../api/termItemListings";

/** One actionable item surfaced by the app-wide pending-actions host —
 * derived client-side from `notifications`' `kind`/`link_path` rather than a
 * new backend endpoint. Only `TERM_CONFIRMATION_NEEDED` carries a
 * term-shaped `link_path`, and its `termId` is parsed out of it, since
 * that's the only structured data the feed carries. Item-related kinds,
 * `SWAP_PROPOSED` included, link to `/product/<itemId>`, so
 * `PendingSwapAction.linkPath` is not a term link.
 *
 * `SWAP_PROPOSED` carries no `proposalId`/accept-reject affordance here —
 * the host can only ever surface the FIRST pending action, which would
 * pre-empt the actual choice among possibly several competing offers. It
 * only links to "Moje rzeczy", where `RzeczyView` lists every pending offer
 * against the item together. */
export interface PendingSwapAction {
  kind: "SWAP_PROPOSED";
  notificationId: string;
  message: string;
  linkPath: string | null;
}

/** The post-term-end confirm-race prompt — fully wired to
 * `confirmTransaction`. `reservationId` is `Notification.reservation_id`
 * (set for GIFT/LEND prompts, incl. Pledge-LEND); when it is `null` (SWAP,
 * older notifications) the reservation is resolved client-side from the
 * term's `getMyTermItemListings`/`getMyTakenTermItemListings` (see
 * `resolvePendingReservationId`). `proposalId` is set for swap prompts. */
export interface PendingConfirmAction {
  kind: "TERM_CONFIRMATION_NEEDED";
  notificationId: string;
  message: string;
  linkPath: string | null;
  termId: string | null;
  reservationId: string | null;
  proposalId: string | null;
}

/** A PENDING request to join a group the caller organizes. Sourced from the
 * server's pending list rather than from notifications, so it stays until
 * decided even when its `GROUP_JOIN_REQUESTED` notification was read. */
export interface PendingJoinRequestAction {
  kind: "GROUP_JOIN_REQUESTED";
  joinRequestId: string;
  groupId: string;
  groupName: string;
  requesterName: string;
  createdAt: string;
}

export type PendingAction = PendingSwapAction | PendingConfirmAction | PendingJoinRequestAction;

export type JoinRequestDecision = "approve" | "reject";

const TERM_LINK_PATH_RE = /\/term\/([^/]+)$/;

export function parseTermIdFromLinkPath(linkPath: string | null): string | null {
  if (!linkPath) return null;
  const match = TERM_LINK_PATH_RE.exec(linkPath);
  return match ? match[1] : null;
}

/** Swap/confirm actions are derived from unread notifications; join-request
 * actions come from the server's pending list and follow them, oldest first. */
export function derivePendingActions(
  notifications: NotificationResponse[],
  joinRequests: PendingJoinRequestResponse[],
): PendingAction[] {
  return [
    ...notifications
      .filter((n) => n.read_at === null)
      .flatMap((n): PendingAction[] => {
        if (n.kind === "SWAP_PROPOSED") {
          return [{ kind: "SWAP_PROPOSED", notificationId: n.id, message: n.message, linkPath: n.link_path }];
        }
        if (n.kind === "TERM_CONFIRMATION_NEEDED") {
          return [
            {
              kind: "TERM_CONFIRMATION_NEEDED",
              notificationId: n.id,
              message: n.message,
              linkPath: n.link_path,
              termId: parseTermIdFromLinkPath(n.link_path),
              reservationId: n.reservation_id ?? null,
              proposalId: n.proposal_id ?? null,
            },
          ];
        }
        return [];
      }),
    ...joinRequests.map(
      (r): PendingJoinRequestAction => ({
        kind: "GROUP_JOIN_REQUESTED",
        joinRequestId: r.id,
        groupId: r.group_id,
        groupName: r.group_name,
        requesterName: r.requester_display_name,
        createdAt: r.created_at,
      }),
    ),
  ];
}

/** The snooze key of an action. */
export function pendingActionKey(action: PendingAction): string {
  return action.kind === "GROUP_JOIN_REQUESTED" ? `jr:${action.joinRequestId}` : `n:${action.notificationId}`;
}

export function confirmActionTitle(action: PendingConfirmAction): string {
  if (action.proposalId !== null) return "Potwierdź zamianę";
  // Legacy, remove after old prompts are resolved: swap prompts created before
  // proposal_id was set carry no ids and the old "potwierdź zamianę" message.
  if (action.reservationId === null && action.message.includes("zamian")) return "Potwierdź zamianę";
  return "Potwierdź przekazanie";
}

/** Resolves the `Reservation.id` the caller (`myPartyId`) needs to
 * `confirmTransaction` on `termId`, purely from existing term-item-listing
 * endpoints (no new backend surface) — mirrors `TermPage.tsx`'s own
 * `confirmActionFor`, generalized to run without that page's local
 * `reservationsById` cache since the host can render on any route.
 *
 * Checks the taker side first, via `getMyTakenTermItemListings` — unlike
 * `getBrowseTermItemListings` (which excludes RESERVED/taken items and
 * short-circuits to `[]` entirely once the Term has occurred, per
 * `list_browsable_term_item_listings`), this endpoint resolves the caller's
 * own active taken reservations independent of availability status, so it
 * still works for the post-term-end `TERM_CONFIRMATION_NEEDED` prompt.
 *
 * Then checks the lister/owner side of the caller's own listings: an
 * accepted SWAP resolves via its paired leg, while GIFT/LEND resolve
 * directly to the caller's own reservation id (symmetric to the SWAP
 * branch — the owner IS the party who must confirm handoff for those
 * types, there's no separate paired reservation to look up).
 *
 * `null` when neither side applies (nothing left to confirm, or it
 * doesn't belong to this caller). */
export async function resolvePendingReservationId(termId: string, myPartyId: string): Promise<string | null> {
  const [mine, taken] = await Promise.all([getMyTermItemListings(termId), getMyTakenTermItemListings(termId)]);
  const takenRow = taken.find((r) => r.taken_by_party_id === myPartyId && r.resolved_reservation_id != null);
  if (takenRow?.resolved_reservation_id != null) {
    const reservation = await getReservation(takenRow.resolved_reservation_id);
    if (reservation.status !== "FULFILLED" && reservation.status !== "CANCELLED") {
      return reservation.id;
    }
  }

  for (const row of mine) {
    if (row.resolved_reservation_id == null) continue;
    const primary = await getReservation(row.resolved_reservation_id);
    if (primary.reservation_type === "SWAP") {
      if (primary.paired_reservation_id == null) continue;
      const paired = await getReservation(primary.paired_reservation_id);
      if (paired.status !== "FULFILLED" && paired.status !== "CANCELLED") {
        return paired.id;
      }
    } else if (
      (primary.reservation_type === "GIFT" || primary.reservation_type === "LEND") &&
      primary.status !== "FULFILLED" &&
      primary.status !== "CANCELLED"
    ) {
      return primary.id;
    }
  }
  return null;
}
