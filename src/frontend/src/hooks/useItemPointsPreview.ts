import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ItemCondition } from "../api/inventories";
import { getItemPointsValue, getOwnedItemPointsValue, type OwnedItemPointsValue } from "../api/points";
import { extractProblemMessage } from "../api/problem";
import type { PointsPriceBounds } from "../utils/appHelpers";
import { POINTS_KEY } from "./usePointsConfig";

interface UseItemPointsPreviewResult {
  /** `null` until a category is picked and the value loaded. */
  data: number | null;
  /** The POINTS price bounds around `data`; `null` while `data` is. */
  bounds: PointsPriceBounds | null;
  loading: boolean;
  error: string | null;
}

function toBounds({ price_min, price_max, price_step }: OwnedItemPointsValue): PointsPriceBounds | null {
  if (price_min === null || price_max === null || price_step === null) return null;
  return { min: price_min, max: price_max, step: price_step };
}

/** The value the item forms show while the owner picks the category and
 * condition: what the item gets when saved now. Idle without a category. */
export function useItemPointsPreview(categoryId: string | null, condition: ItemCondition): UseItemPointsPreviewResult {
  const enabled = Boolean(categoryId);
  const query = useQuery({
    queryKey: [POINTS_KEY, "item-value", { categoryId, condition }],
    queryFn: () => getItemPointsValue(categoryId ?? "", condition),
    enabled,
    placeholderData: keepPreviousData,
  });
  return {
    data: enabled ? (query.data?.points_value ?? null) : null,
    bounds: enabled && query.data ? toBounds(query.data) : null,
    loading: enabled && query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
  };
}

interface UseOwnedItemPointsValueResult {
  /** The item's stored value; `null` while loading or for an item not valued yet. */
  data: number | null;
  /** The POINTS price bounds around the stored value; `null` while `data` is. */
  bounds: PointsPriceBounds | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** The stored value of one of the caller's items and its POINTS price
 * bounds, which the server checks a price against. Idle without an id. */
export function useOwnedItemPointsValue(itemId: string | null): UseOwnedItemPointsValueResult {
  const enabled = itemId !== null;
  const query = useQuery({
    queryKey: [POINTS_KEY, "item-value", { itemId }],
    queryFn: () => getOwnedItemPointsValue(itemId ?? ""),
    enabled,
  });
  const { refetch: queryRefetch } = query;
  const refetch = useCallback(async () => {
    await queryRefetch();
  }, [queryRefetch]);
  return {
    data: enabled ? (query.data?.points_value ?? null) : null,
    bounds: enabled && query.data ? toBounds(query.data) : null,
    loading: enabled && query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
    refetch,
  };
}
