import { api } from "./client";

export type NotificationKind =
  | "PLEDGE_CREATED"
  | "PLEDGE_WITHDRAWN"
  | "PLEDGE_ITEM_REGISTERED"
  | "NEEDED_ITEM_REMOVED"
  | "TERM_ITEM_LISTING_TAKEN"
  | "SWAP_PROPOSED"
  | "SWAP_ACCEPTED"
  | "SWAP_REJECTED"
  | "TERM_CONFIRMATION_NEEDED"
  | "TERM_ALREADY_RESOLVED"
  | "GROUP_JOIN_REQUESTED"
  | "GROUP_JOIN_APPROVED"
  | "GROUP_JOIN_REJECTED";

export interface NotificationResponse {
  id: number;
  kind: NotificationKind;
  message: string;
  /** In-app route to open when the entry is clicked (or `null`). */
  link_path: string | null;
  /** `null` = unread. */
  read_at: string | null;
  created_at: string;
  /** Loose pointer at `SwapProposal.id`, populated only for
   * `SWAP_PROPOSED` — lets the global pending-actions modal call
   * `acceptSwapProposal`/`rejectSwapProposal` directly. `null`/absent for
   * every other kind. */
  proposal_id?: number | null;
  /** Loose pointer at `GroupJoinRequest.id`, populated for the
   * `GROUP_JOIN_*` kinds — lets the pending-actions modal approve/reject a
   * `GROUP_JOIN_REQUESTED` request directly. `null`/absent for every other
   * kind. */
  join_request_id?: number | null;
}

export function getMyNotifications(): Promise<NotificationResponse[]> {
  return api.get("/notifications/mine");
}

export function getUnreadCount(): Promise<{ count: number }> {
  return api.get("/notifications/unread-count");
}

export function markNotificationRead(id: number): Promise<void> {
  return api.post(`/notifications/${id}/read`, undefined);
}

export function markAllNotificationsRead(): Promise<void> {
  return api.post("/notifications/read-all", undefined);
}
