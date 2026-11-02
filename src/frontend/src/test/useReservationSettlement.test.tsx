import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as reservationsApi from "../api/reservations";
import { isAlreadyResolved } from "../api/reservations";
import * as termItemListingsApi from "../api/termItemListings";
import { isPersonalSwapAccept, type AcceptedSwapProposalResponse } from "../api/termItemListings";
import { EVENT_KEY } from "../hooks/useEvent";
import { ITEM_ACTIONS_KEY } from "../hooks/useItemActions";
import { ITEM_DETAILS_KEY } from "../hooks/useItemDetail";
import { ORGANIZER_PAGE_KEY } from "../hooks/useOrganizerPage";
import { OWNER_ITEMS_KEY } from "../hooks/useOwnerItems";
import { useReservationSettlement } from "../hooks/useReservationSettlement";
import { GROUP_ACCESS_KEY } from "../hooks/useTermAccess";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/reservations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/reservations")>()),
  confirmTransaction: vi.fn(),
  cancelTransaction: vi.fn(),
}));

vi.mock("../api/termItemListings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/termItemListings")>()),
  acceptSwapProposal: vi.fn(),
  rejectSwapProposal: vi.fn(),
}));

function accepted(overrides: Partial<AcceptedSwapProposalResponse> = {}): AcceptedSwapProposalResponse {
  return {
    id: "s1",
    proposer_party_id: "p2",
    listing_item_id: "i1",
    offered_item_id: "m1",
    proposer_reservation_id: "r2",
    status: "ACCEPTED",
    created_at: "2026-10-01T10:00:00",
    updated_at: "2026-10-01T10:00:00",
    term_id: null,
    term_occurs_on: null,
    group_id: null,
    group_name: null,
    event_id: null,
    event_slug: null,
    ...overrides,
  };
}

const ALREADY_RESOLVED_409 = new ApiError(409, "Conflict", {
  reservation_id: "r1",
  status: "ALREADY_RESOLVED",
  already_resolved: true,
});

function renderSettlement(client = createTestQueryClient()) {
  const refetch = vi.fn().mockResolvedValue(undefined);
  const view = renderHook(() => useReservationSettlement(refetch), { wrapper: createQueryWrapper(client) });
  return { ...view, refetch };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("useReservationSettlement", () => {
  it("confirm awaits invalidation of every reservation-state prefix before refetching", async () => {
    vi.mocked(reservationsApi.confirmTransaction).mockResolvedValue({
      reservation_id: "r1",
      status: "CONFIRMED",
      already_resolved: false,
    });
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result, refetch } = renderSettlement(client);

    let failure: string | null = "unset";
    await act(async () => {
      failure = await result.current.confirm("r1");
    });

    expect(failure).toBeNull();
    expect(reservationsApi.confirmTransaction).toHaveBeenCalledWith("r1");
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        [ITEM_ACTIONS_KEY],
        [ITEM_DETAILS_KEY],
        [OWNER_ITEMS_KEY],
        [ORGANIZER_PAGE_KEY],
        [EVENT_KEY],
        [GROUP_ACCESS_KEY],
        ["notifications"],
      ]),
    );
    expect(Math.max(...invalidate.mock.invocationCallOrder)).toBeLessThan(refetch.mock.invocationCallOrder[0]);
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("an already-resolved 409 shows its own message and still refetches", async () => {
    vi.mocked(reservationsApi.cancelTransaction).mockRejectedValue(ALREADY_RESOLVED_409);
    const { result, refetch } = renderSettlement();

    let failure: string | null = null;
    await act(async () => {
      failure = await result.current.cancel("r1");
    });

    expect(failure).toBe("Transakcja została już rozstrzygnięta przez drugą stronę.");
    expect(result.current.error).toBe("Transakcja została już rozstrzygnięta przez drugą stronę.");
    expect(refetch).toHaveBeenCalled();
  });

  it("another error passes the server's message through and does not refetch", async () => {
    vi.mocked(termItemListingsApi.rejectSwapProposal).mockRejectedValue(
      new ApiError(409, "Conflict", { type: "about:blank", title: "Conflict", status: 409, detail: "Propozycja wygasła" }),
    );
    const { result, refetch } = renderSettlement();

    let failure: string | null = null;
    await act(async () => {
      failure = await result.current.reject("s1");
    });

    expect(failure).toBe("Propozycja wygasła");
    expect(result.current.error).toBe("Propozycja wygasła");
    expect(refetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a personal swap", accepted(), "Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie."],
    [
      "an event swap",
      accepted({ term_occurs_on: "2026-11-07T10:00:00", group_name: "Kiermasz zimowy", event_id: "ev-1" }),
      "Zamiana przyjęta — odbiór sob 07.11 o 10:00 · Kiermasz zimowy.",
    ],
  ])("accept of %s shows where and when", async (_name, response, copy) => {
    vi.mocked(termItemListingsApi.acceptSwapProposal).mockResolvedValue(response);
    const { result } = renderSettlement();

    await act(() => result.current.accept("s1"));

    expect(termItemListingsApi.acceptSwapProposal).toHaveBeenCalledWith("s1");
    expect(result.current.success).toBe(copy);
  });
});

describe("isPersonalSwapAccept", () => {
  it.each([
    ["all four context fields null", accepted(), true],
    ["an event swap: event start and name", accepted({ term_occurs_on: "2026-11-07T10:00:00", group_name: "Kiermasz" }), false],
    [
      "a term swap",
      accepted({ term_id: "t1", term_occurs_on: "2026-11-07T10:00:00", group_id: "g1", group_name: "Skrzaty" }),
      false,
    ],
  ])("%s → %s", (_name, response, expected) => {
    expect(isPersonalSwapAccept(response)).toBe(expected);
  });
});

describe("isAlreadyResolved", () => {
  it.each([
    ["the already-resolved 409", ALREADY_RESOLVED_409, true],
    ["a 409 without the flag", new ApiError(409, "Conflict", { already_resolved: false }), false],
    ["another status", new ApiError(500, "Server Error", { already_resolved: true }), false],
    ["a plain error", new Error("network"), false],
  ])("%s → %s", (_name, err, expected) => {
    expect(isAlreadyResolved(err)).toBe(expected);
  });
});
