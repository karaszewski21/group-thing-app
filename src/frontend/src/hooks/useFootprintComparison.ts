import { useCallback, useEffect, useRef, useState } from "react";
import { getProductFootprint } from "../api/footprints";
import type { FootprintQueryInput, FootprintResponse } from "../api/footprints";
import { extractProblemMessage } from "../api/problem";

export interface ScenarioState {
  id: string;
  input: FootprintQueryInput;
  data: FootprintResponse | null;
  loading: boolean;
  error: string | null;
}

export interface UseFootprintComparisonResult {
  scenarios: ScenarioState[];
  addScenario: (input: FootprintQueryInput) => void;
  updateScenario: (id: string, input: FootprintQueryInput) => void;
  removeScenario: (id: string) => void;
}

function newScenario(input: FootprintQueryInput): ScenarioState {
  return {
    id: crypto.randomUUID(),
    input,
    data: null,
    loading: true,
    error: null,
  };
}

export function useFootprintComparison(
  productId: string,
  comparisonGroupId: string,
  initialScenarios: FootprintQueryInput[],
): UseFootprintComparisonResult {
  const [scenarios, setScenarios] = useState<ScenarioState[]>(() =>
    initialScenarios.map(newScenario),
  );

  const fetchScenario = useCallback(
    async (id: string, input: FootprintQueryInput) => {
      try {
        const response = await getProductFootprint(productId, input, {
          comparisonGroupId,
        });
        setScenarios((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, data: response, loading: false, error: null } : s,
          ),
        );
      } catch (err) {
        const message = extractProblemMessage(err);
        setScenarios((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, data: null, loading: false, error: message } : s,
          ),
        );
      }
    },
    [productId, comparisonGroupId],
  );

  // Fire fetches for the initial scenarios once. Subsequent fetches are
  // triggered explicitly by add/update.
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    if (!productId) return; // wait for SKU to resolve before initial fetches
    didMountRef.current = true;
    for (const s of scenarios) {
      void fetchScenario(s.id, s.input);
    }
  }, [scenarios, fetchScenario, productId]);

  const addScenario = useCallback(
    (input: FootprintQueryInput) => {
      const scenario = newScenario(input);
      setScenarios((prev) => [...prev, scenario]);
      void fetchScenario(scenario.id, input);
    },
    [fetchScenario],
  );

  const updateScenario = useCallback(
    (id: string, input: FootprintQueryInput) => {
      setScenarios((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, input, loading: true, error: null } : s,
        ),
      );
      void fetchScenario(id, input);
    },
    [fetchScenario],
  );

  const removeScenario = useCallback((id: string) => {
    setScenarios((prev) => {
      if (prev.length === 0 || prev[0].id === id) return prev;
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  return { scenarios, addScenario, updateScenario, removeScenario };
}
