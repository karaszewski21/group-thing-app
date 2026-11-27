import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pointsApi from "../api/points";
import type { PointsConfig } from "../api/points";
import { POINTS_KEY, usePointsConfig } from "../hooks/usePointsConfig";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/points", () => ({
  getPointsConfig: vi.fn(),
  updatePointsConfig: vi.fn(),
}));

const config: PointsConfig = {
  base_small: 20,
  base_medium: 40,
  base_large: 60,
  multiplier_new: 1.2,
  multiplier_like_new: 1.1,
  multiplier_good: 1,
  multiplier_fair: 0.8,
  multiplier_poor: 0.5,
  swap_award: 10,
  wants_bonus: 10,
  attendance_levels: [0, 10, 20],
  attendance_monthly_cap: 100,
  attendance_min_present: 3,
  attendance_auto_close_days: 7,
  pair_reward_limit: 3,
  pair_window_days: 30,
  max_points_offers: 5,
  price_min_ratio: 0.5,
  price_max_ratio: 1.5,
  price_cap: 100,
  price_step: 10,
  updated_at: "2026-11-19T10:00:00",
};

describe("usePointsConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pointsApi.getPointsConfig).mockResolvedValue(config);
  });

  it("update_invalidatesTheWholePointsPrefix", async () => {
    vi.mocked(pointsApi.updatePointsConfig).mockResolvedValue(config);
    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePointsConfig(), {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => expect(result.current.data).toEqual(config));

    await act(async () => {
      await result.current.update(config);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [POINTS_KEY] });
  });
});
