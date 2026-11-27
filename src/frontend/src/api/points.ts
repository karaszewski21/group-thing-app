import { api } from "./client";
import type { ItemCondition } from "./inventories";
import { pageParams, type Page } from "./pagination";

/** The admin-tunable point thresholds (`points_config`), as the backend's
 * `PointsConfigResponse` has them; multipliers and price ratios are plain
 * numbers. */
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
  /** A POINTS price's lower bound as a share of the item's value, 0.01–1.00. */
  price_min_ratio: number;
  /** A POINTS price's upper bound as a multiple of the item's value, 1.00–3.00. */
  price_max_ratio: number;
  /** No POINTS price above this; a multiple of `price_step`. */
  price_cap: number;
  price_step: number;
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

/** The caller's own points, all 0 before the first award. `balance` is
 * what they can spend; `held` is blocked by their open POINTS reservations. */
export interface PointsSummary {
  balance: number;
  held: number;
  reputation: number;
}

export type PointTransactionType =
  | "GIVE_FREE"
  | "WISHLIST_MATCH"
  | "EXCHANGE"
  | "ATTENDANCE"
  | "HOLD"
  | "SALE"
  | "RELEASE";

/** The caller's part in one point transaction. `amount` changes the
 * balance, `held_amount` the held points (a buyer's SALE: 0 and −p);
 * `reputation` is non-zero only for GIVE_FREE; `counterparty_name` is null
 * for ATTENDANCE. `occurred_at` is naive UTC. */
export interface PointHistoryEntry {
  id: string;
  type: PointTransactionType;
  amount: number;
  held_amount: number;
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

/** An item's value and the POINTS price bounds around it. */
export interface ItemPointsValue {
  points_value: number;
  price_min: number;
  price_max: number;
  price_step: number;
}

/** What an item in this category and condition is worth if saved now. */
export function getItemPointsValue(categoryId: string, condition: ItemCondition): Promise<ItemPointsValue> {
  const params = new URLSearchParams({ category_id: categoryId, condition });
  return api.get(`/points/item-value?${params}`);
}

/** The stored value of one of the caller's items; all four fields are
 * `null` for an item not valued yet. */
export interface OwnedItemPointsValue {
  points_value: number | null;
  price_min: number | null;
  price_max: number | null;
  price_step: number | null;
}

export function getOwnedItemPointsValue(itemId: string): Promise<OwnedItemPointsValue> {
  const params = new URLSearchParams({ item_id: itemId });
  return api.get(`/points/item-value?${params}`);
}
