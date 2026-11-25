import { api } from "./client";
import type { ItemCondition } from "./inventories";
import { pageParams, type Page } from "./pagination";

/** The admin-tunable point thresholds (`points_config`), as the backend's
 * `PointsConfigResponse` has them; multipliers are plain numbers. */
export interface PointsConfigValues {
  base_small: number;
  base_medium: number;
  base_large: number;
  multiplier_new: number;
  multiplier_like_new: number;
  multiplier_good: number;
  multiplier_fair: number;
  multiplier_poor: number;
  swap_award: number;
  wants_bonus: number;
  /** 1–5 distinct values, ascending. */
  attendance_levels: number[];
  attendance_monthly_cap: number;
  attendance_min_present: number;
  attendance_auto_close_days: number;
  pair_reward_limit: number;
  pair_window_days: number;
  max_points_offers: number;
}

/** `updated_at` is the token the PUT sends back; a stale one is a 409. */
export interface PointsConfig extends PointsConfigValues {
  updated_at: string;
}

export function getPointsConfig(): Promise<PointsConfig> {
  return api.get("/points/config");
}

/** A full replace; the body carries the `updated_at` the client read. */
export function updatePointsConfig(request: PointsConfig): Promise<PointsConfig> {
  return api.put("/points/config", request);
}

/** The caller's own points; 0 and 0 before the first award. */
export interface PointsSummary {
  balance: number;
  reputation: number;
}

export type PointTransactionType = "GIVE_FREE" | "WISHLIST_MATCH" | "EXCHANGE" | "ATTENDANCE";

/** The caller's entry in one point transaction. `reputation` is non-zero
 * only for GIVE_FREE; `counterparty_name` is null for ATTENDANCE.
 * `occurred_at` is naive UTC. */
export interface PointHistoryEntry {
  id: string;
  type: PointTransactionType;
  amount: number;
  reputation: number;
  description: string;
  counterparty_name: string | null;
  occurred_at: string;
}

export function getMyPoints(): Promise<PointsSummary> {
  return api.get("/points/me");
}

/** One page of the caller's history, newest first. */
export function getMyPointsHistory(page: number, size?: number): Promise<Page<PointHistoryEntry>> {
  const params = new URLSearchParams(pageParams(page, size));
  return api.get(`/points/me/history?${params}`);
}

/** What the add-term form needs: the allowed levels (ascending) and the
 * minimum number of present people. */
export interface AttendanceRules {
  levels: number[];
  min_present: number;
  auto_close_days: number;
}

export function getAttendanceRules(): Promise<AttendanceRules> {
  return api.get("/points/attendance-rules");
}

/** What an item in this category and condition is worth if saved now. */
export interface ItemPointsValue {
  points_value: number;
}

export function getItemPointsValue(categoryId: string, condition: ItemCondition): Promise<ItemPointsValue> {
  const params = new URLSearchParams({ category_id: categoryId, condition });
  return api.get(`/points/item-value?${params}`);
}
