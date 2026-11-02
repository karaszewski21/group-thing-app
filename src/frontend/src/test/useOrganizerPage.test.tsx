import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as groupsApi from "../api/groups";
import type { OrganizerPageResponse } from "../api/groups";
import { useOrganizerPage } from "../hooks/useOrganizerPage";
import { createQueryWrapper } from "./queryClient";

const mockAuth: { token: string | null; username: string | null } = { token: null, username: null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/groups", () => ({
  getOrganizerPage: vi.fn(),
}));

const DIRECTORY: OrganizerPageResponse = {
  circles: [
    {
      id: "c1",
      name: "Maluchy",
      layout_mode: "CIRCLE",
      next_term: { id: "t1", occurs_on: "2026-10-12T10:00:00Z", attendee_count: 4 },
      upcoming_term_count: 3,
    },
  ],
  upcoming_terms: [],
  exchange: { counts: { GIFT: 0, SWAP: 0, RESERVED: 0 }, items: [] },
  needed_items: [],
  recent_items: [],
  owner_nearest: null,
  stats: { circle_count: 1, upcoming_term_count: 3, family_count: null },
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.token = null;
  mockAuth.username = null;
});

describe("useOrganizerPage", () => {
  it("returns the directory once loaded", async () => {
    vi.mocked(groupsApi.getOrganizerPage).mockResolvedValue(DIRECTORY);

    const { result } = renderHook(() => useOrganizerPage("studio-ania"), { wrapper: createQueryWrapper() });

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(DIRECTORY);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    expect(groupsApi.getOrganizerPage).toHaveBeenCalledWith("studio-ania");
  });

  it("reports a 404 as notFound without an error message", async () => {
    vi.mocked(groupsApi.getOrganizerPage).mockRejectedValue(new ApiError(404, "Not Found", null));

    const { result } = renderHook(() => useOrganizerPage("nope"), { wrapper: createQueryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("refetches the personalised directory under a new key after a login or account switch", async () => {
    vi.mocked(groupsApi.getOrganizerPage).mockResolvedValue(DIRECTORY);
    const { result, rerender } = renderHook(() => useOrganizerPage("studio-ania"), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(groupsApi.getOrganizerPage).toHaveBeenCalledTimes(1);

    mockAuth.token = "jwt-a";
    mockAuth.username = "user-a";
    rerender();
    await waitFor(() => expect(groupsApi.getOrganizerPage).toHaveBeenCalledTimes(2));

    mockAuth.token = "jwt-b";
    mockAuth.username = "user-b";
    rerender();
    await waitFor(() => expect(groupsApi.getOrganizerPage).toHaveBeenCalledTimes(3));

    mockAuth.token = "jwt-b-refreshed";
    rerender();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(groupsApi.getOrganizerPage).toHaveBeenCalledTimes(3);
  });
});
