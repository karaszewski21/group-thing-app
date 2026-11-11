import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import { useOrganizationLayout } from "../hooks/useOrganizationLayout";
import { layoutStats, linksLayout, scheduleLayout } from "./organizationLayoutFixtures";
import { createQueryWrapper } from "./queryClient";

const mockAuth: { token: string | null; username: string | null } = { token: null, username: null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getOrganizationLayout: vi.fn(),
}));

const SCHEDULE = scheduleLayout({ stats: layoutStats({ group_count: 1, meeting_count: 3 }) });

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.token = null;
  mockAuth.username = null;
});

describe("useOrganizationLayout", () => {
  it("returns the requested layout's data once loaded", async () => {
    vi.mocked(organizationsApi.getOrganizationLayout).mockResolvedValue(SCHEDULE);

    const { result } = renderHook(() => useOrganizationLayout("studio-ania", "SCHEDULE"), {
      wrapper: createQueryWrapper(),
    });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(SCHEDULE);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    expect(organizationsApi.getOrganizationLayout).toHaveBeenCalledWith("studio-ania", "SCHEDULE");
  });

  it("reports a 404 as notFound without an error message", async () => {
    vi.mocked(organizationsApi.getOrganizationLayout).mockRejectedValue(new ApiError(404, "Not Found", null));

    const { result } = renderHook(() => useOrganizationLayout("nope", "LINKS"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("stays loading without a request while disabled, and reads each layout under its own key", async () => {
    vi.mocked(organizationsApi.getOrganizationLayout).mockImplementation(async (_slug, layout) =>
      layout === "LINKS" ? linksLayout() : SCHEDULE,
    );
    const { result, rerender } = renderHook(
      ({ layout, enabled }: { layout: "LINKS" | "SCHEDULE"; enabled: boolean }) =>
        useOrganizationLayout("studio-ania", layout, { enabled }),
      { wrapper: createQueryWrapper(), initialProps: { layout: "LINKS", enabled: false } },
    );

    expect(result.current.loading).toBe(true);
    expect(organizationsApi.getOrganizationLayout).not.toHaveBeenCalled();

    rerender({ layout: "LINKS", enabled: true });
    await waitFor(() => expect(result.current.data?.layout).toBe("LINKS"));
    rerender({ layout: "SCHEDULE", enabled: true });
    await waitFor(() => expect(result.current.data?.layout).toBe("SCHEDULE"));
    expect(organizationsApi.getOrganizationLayout).toHaveBeenCalledTimes(2);
  });

  it("refetches the personalised data under a new key after a login", async () => {
    vi.mocked(organizationsApi.getOrganizationLayout).mockResolvedValue(SCHEDULE);
    const { result, rerender } = renderHook(() => useOrganizationLayout("studio-ania", "SCHEDULE"), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    mockAuth.token = "jwt-a";
    mockAuth.username = "user-a";
    rerender();

    await waitFor(() => expect(organizationsApi.getOrganizationLayout).toHaveBeenCalledTimes(2));
  });
});
