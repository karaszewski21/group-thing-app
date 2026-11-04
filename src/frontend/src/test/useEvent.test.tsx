import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as eventsApi from "../api/events";
import type { EventAttendanceResponse, EventDetailResponse } from "../api/events";
import { ApiError } from "../api/client";
import { useEvent } from "../hooks/useEvent";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

vi.mock("../api/events", () => ({
  getEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  signUpForEvent: vi.fn(),
  withdrawFromEvent: vi.fn(),
}));

const mockAuth: { token: string | null } = { token: null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

const EVENT_ID = "ev-1";

function event(overrides: Partial<EventDetailResponse> = {}): EventDetailResponse {
  return {
    id: EVENT_ID,
    name: "Piknik w parku",
    description: null,
    starts_at: "2026-11-02T14:00:00",
    ends_at: null,
    location: null,
    created_at: "",
    updated_at: "",
    author_slug: "zielony-krag",
    banner_url: null,
    attendee_count: 0,
    is_author: false,
    author_display_name: "Fundacja Zielony Krąg",
    organization: null,
    participants: [],
    is_attending: false,
    has_ended: false,
    open_reservations: null,
    ...overrides,
  };
}

const ATTENDANCE: EventAttendanceResponse = {
  id: "att-1",
  event_id: EVENT_ID,
  user_profile_id: "prof-1",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function renderReady(initial: EventDetailResponse, client = createTestQueryClient()) {
  vi.mocked(eventsApi.getEvent).mockResolvedValueOnce(initial);
  const hook = renderHook(() => useEvent(EVENT_ID), { wrapper: createQueryWrapper(client) });
  await waitFor(() => expect(hook.result.current.data).not.toBeNull());
  return hook;
}

describe("useEvent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.token = null;
  });

  it("tokenChange_keepsDataFlaggedStaleUntilTheRefetchResolves", async () => {
    const { result, rerender } = await renderReady(event({ is_author: false }));
    expect(result.current.isStale).toBe(false);
    const next = deferred<EventDetailResponse>();
    vi.mocked(eventsApi.getEvent).mockReturnValueOnce(next.promise);

    mockAuth.token = "author-token";
    rerender();

    expect(result.current.data?.is_author).toBe(false);
    expect(result.current.isStale).toBe(true);
    await act(async () => {
      next.resolve(event({ is_author: true }));
      await next.promise;
    });
    await waitFor(() => expect(result.current.isStale).toBe(false));
    expect(result.current.data?.is_author).toBe(true);
  });

  it("refetch_error_keepsDataAndExposesRefreshError", async () => {
    const { result } = await renderReady(event());
    vi.mocked(eventsApi.getEvent).mockRejectedValueOnce(new ApiError(500, "Server Error", null));

    await act(() => result.current.refetch());

    expect(result.current.data).toEqual(event());
    expect(result.current.refreshError).toBe("Server Error (HTTP 500)");
    expect(result.current.notFound).toBe(false);
  });

  it("signUp_postsAndAwaitsEventListInvalidation", async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = await renderReady(event(), client);
    vi.mocked(eventsApi.signUpForEvent).mockResolvedValue(ATTENDANCE);
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event({ attendee_count: 1 }));

    let returned: EventAttendanceResponse | undefined;
    await act(async () => {
      returned = await result.current.signUp();
    });

    expect(eventsApi.signUpForEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(returned).toEqual(ATTENDANCE);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["myEvents"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["attendingEvents"] });
    expect(result.current.data?.attendee_count).toBe(1);
  });

  it("withdraw_invalidatesTheConversationsKeyToo", async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = await renderReady(event({ is_attending: true }), client);
    vi.mocked(eventsApi.withdrawFromEvent).mockResolvedValue(undefined);
    vi.mocked(eventsApi.getEvent).mockResolvedValue(event());

    await act(() => result.current.withdraw());

    expect(eventsApi.withdrawFromEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["attendingEvents"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] });
  });

  it("remove_dropsTheEventAndInvalidatesMyEventsAndConversations", async () => {
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = await renderReady(event({ is_author: true }), client);
    vi.mocked(eventsApi.deleteEvent).mockResolvedValue(undefined);

    await act(() => result.current.remove());

    expect(eventsApi.deleteEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(client.getQueryData(["event", EVENT_ID])).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["myEvents"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["conversations"] });
  });
});
