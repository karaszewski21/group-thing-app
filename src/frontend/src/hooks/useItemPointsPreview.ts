import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ItemCondition } from "../api/inventories";
import { getItemPointsValue } from "../api/points";
import { extractProblemMessage } from "../api/problem";
import { POINTS_KEY } from "./usePointsConfig";

interface UseItemPointsPreviewResult {
  /** `null` until a category is picked and the value loaded. */
  data: number | null;
  loading: boolean;
  error: string | null;
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
    loading: enabled && query.isPending,
    error: query.error ? extractProblemMessage(query.error) : null,
  };
}
