import { api } from "./client";

export type NotificationKind =
  | "PLEDGE_CREATED"
  | "PLEDGE_WITHDRAWN"
  | "PLEDGE_ITEM_REGISTERED"
  | "NEEDED_ITEM_REMOVED";

export interface NotificationResponse {
  id: number;
  kind: NotificationKind;
  message: string;
  /** In-app route to open when the entry is clicked (or `null`). */
  link_path: string | null;
  /** `null` = unread. */
  read_at: string | null;
  created_at: string;
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
