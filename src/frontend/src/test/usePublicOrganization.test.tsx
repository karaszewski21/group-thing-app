import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import { usePublicOrganization } from "../hooks/usePublicOrganization";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/organizations", () => ({
  getPublicOrganization: vi.fn(),
}));

const ORGANIZATION = {
  slug: "studio-ania",
  name: "Studio Ania",
  primary_color: "#7a1f3d",
  accent_color: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("usePublicOrganization", () => {
  it("returns the organization once loaded", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);

    const { result } = renderHook(() => usePublicOrganization("studio-ania"), { wrapper: createQueryWrapper() });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(ORGANIZATION);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches by the given slug", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockResolvedValue(ORGANIZATION);

    const { result } = renderHook(() => usePublicOrganization("studio-ania"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(organizationsApi.getPublicOrganization).toHaveBeenCalledWith("studio-ania");
  });

  it("reports a 404 as notFound without an error message", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));

    const { result } = renderHook(() => usePublicOrganization("nope"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("reports other failures as an error message", async () => {
    vi.mocked(organizationsApi.getPublicOrganization).mockRejectedValue(
      new ApiError(500, "Internal Server Error", null),
    );

    const { result } = renderHook(() => usePublicOrganization("studio-ania"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(false);
    expect(typeof result.current.error).toBe("string");
    expect(result.current.error).not.toBe("");
  });
});
