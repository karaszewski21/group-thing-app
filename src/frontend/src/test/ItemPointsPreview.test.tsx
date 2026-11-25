import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as pointsApi from "../api/points";
import { ItemPointsPreview } from "../components/shared/ItemPointsPreview";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/points", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/points")>();
  return { ...actual, getItemPointsValue: vi.fn() };
});

describe("ItemPointsPreview", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("asks for a category and reads nothing until one is picked", () => {
    render(<ItemPointsPreview categoryId={null} condition="GOOD" />, { wrapper: createQueryWrapper() });

    expect(screen.getByText("wybierz kategorię")).toBeInTheDocument();
    expect(pointsApi.getItemPointsValue).not.toHaveBeenCalled();
  });

  it("shows the value and recomputes when the condition changes", async () => {
    vi.mocked(pointsApi.getItemPointsValue).mockImplementation(async (_category, condition) => ({
      points_value: condition === "NEW" ? 60 : 40,
    }));
    const { rerender } = render(<ItemPointsPreview categoryId="cat-1" condition="GOOD" />, {
      wrapper: createQueryWrapper(),
    });

    expect(await screen.findByText("40 pkt")).toBeInTheDocument();
    rerender(<ItemPointsPreview categoryId="cat-1" condition="NEW" />);

    expect(await screen.findByText("60 pkt")).toBeInTheDocument();
    expect(pointsApi.getItemPointsValue).toHaveBeenLastCalledWith("cat-1", "NEW");
  });

  it("says so when the value cannot be computed", async () => {
    vi.mocked(pointsApi.getItemPointsValue).mockRejectedValue(new Error("boom"));
    render(<ItemPointsPreview categoryId="cat-1" condition="GOOD" />, { wrapper: createQueryWrapper() });

    expect(await screen.findByText("nie udało się wyliczyć")).toBeInTheDocument();
  });
});
