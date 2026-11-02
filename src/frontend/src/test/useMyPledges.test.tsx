import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as pledgesApi from "../api/pledges";
import type { MyPledgeResponse } from "../api/pledges";
import { useMyPledges } from "../hooks/useMyPledges";
import { createQueryWrapper } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/pledges", () => ({
  getMyPledges: vi.fn(),
  withdrawPledge: vi.fn(),
}));

const PLEDGE: MyPledgeResponse = {
  pledge_id: "p-1",
  status: "OPEN",
  item_name: "Bębenek",
  item_description: null,
  term_id: "t-1",
  group_id: "g-1",
  group_name: "Rytmika",
  occurs_on: "2026-11-02T17:00:00",
  organizer_slug: "ania",
};

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a" };
});

describe("useMyPledges", () => {
  it("fetches nothing without a token and keeps a stable empty fallback", () => {
    mockAuth = { token: null };
    const { result, rerender } = renderHook(() => useMyPledges(), { wrapper: createQueryWrapper() });
    const firstEmpty = result.current.data;
    rerender();

    expect(result.current.data).toEqual([]);
    expect(result.current.data).toBe(firstEmpty);
    expect(result.current.loading).toBe(false);
    expect(pledgesApi.getMyPledges).not.toHaveBeenCalled();
  });

  it("withdraw re-reads the list once the pledge is withdrawn", async () => {
    vi.mocked(pledgesApi.getMyPledges)
      .mockResolvedValueOnce([PLEDGE])
      .mockResolvedValue([{ ...PLEDGE, status: "WITHDRAWN" }]);
    vi.mocked(pledgesApi.withdrawPledge).mockResolvedValue({} as pledgesApi.PledgeResponse);
    const { result } = renderHook(() => useMyPledges(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual([PLEDGE]));

    await act(() => result.current.withdraw("p-1"));

    expect(pledgesApi.withdrawPledge).toHaveBeenCalledWith("p-1");
    expect(result.current.data[0].status).toBe("WITHDRAWN");
  });

  it("withdraw rethrows the server's message verbatim and keeps the list", async () => {
    vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([PLEDGE]);
    vi.mocked(pledgesApi.withdrawPledge).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Termin już się odbył." }),
    );
    const { result } = renderHook(() => useMyPledges(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.data).toEqual([PLEDGE]));

    await expect(result.current.withdraw("p-1")).rejects.toThrow("Termin już się odbył.");
    expect(pledgesApi.getMyPledges).toHaveBeenCalledTimes(1);
  });
});
