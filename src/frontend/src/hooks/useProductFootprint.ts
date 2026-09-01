import { useCallback, useEffect, useState } from "react";
import { getProductFootprint } from "../api/footprints";
import type { FootprintQueryInput, FootprintResponse } from "../api/footprints";
import { extractProblemMessage } from "../api/problem";

interface UseProductFootprintResult {
  data: FootprintResponse | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  correlationId: string | null;
}

export function useProductFootprint(
  productId: string,
  query?: FootprintQueryInput,
): UseProductFootprintResult {
  const [data, setData] = useState<FootprintResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await getProductFootprint(productId, query);
      setData(response);
    } catch (err) {
      setError(extractProblemMessage(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [productId, query]);

  useEffect(() => {
    if (!productId) {
      setLoading(false);
      return;
    }
    void load();
  }, [load, productId]);

  return {
    data,
    loading,
    error,
    refetch: load,
    correlationId: data?.correlationId ?? null,
  };
}
