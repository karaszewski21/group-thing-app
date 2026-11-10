import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as mediaApi from "../api/media";
import type { MediaOwner, OwnerMedia } from "../api/media";
import * as organizationsApi from "../api/organizations";
import type { MyOrganizationResponse } from "../api/organizations";
import { useMediaActions } from "../hooks/useMediaActions";
import { MY_ORGANIZATION_KEY, useMyOrganization } from "../hooks/useMyOrganization";
import { MY_PROFILE_KEY } from "../hooks/useMyProfile";
import { OWNER_ITEMS_KEY } from "../hooks/useOwnerItems";
import { PUBLIC_ORGANIZATION_KEY } from "../hooks/usePublicOrganization";
import { useUpdateOrganization } from "../hooks/useUpdateOrganization";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getMyOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock("../api/media", () => ({
  uploadMedia: vi.fn(),
  deleteMedia: vi.fn(),
  reorderGallery: vi.fn(),
}));

const ORGANIZATION: MyOrganizationResponse = {
  id: "7",
  party_id: "11",
  name: "Muzyczne Skrzaty",
  slug: "muzyczne-skrzaty",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
  description: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  media: [],
};

function media(id: string, status: OwnerMedia["status"]): OwnerMedia {
  return { id, kind: "GALLERY", status, url: `https://cdn/${id}`, thumb_url: `https://cdn/${id}-t`, sort_order: 0 };
}

function withMedia(...rows: OwnerMedia[]): MyOrganizationResponse {
  return { ...ORGANIZATION, media: rows };
}

const CONFLICT_MESSAGE =
  "Ktoś zmienił tę stronę w międzyczasie. Pobraliśmy aktualną wersję — sprawdź swoje zmiany i zapisz ponownie.";

function invalidatedPrefixes(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useMyOrganization", () => {
  it("returns the caller's organization, idles without a token and maps a 404 to no data", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(ORGANIZATION);
    const loaded = renderHook(() => useMyOrganization(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(loaded.result.current.loading).toBe(false));
    expect(loaded.result.current.data).toEqual(ORGANIZATION);
    expect(loaded.result.current.error).toBeNull();

    mockAuth = { token: null };
    const anonymous = renderHook(() => useMyOrganization(), { wrapper: createQueryWrapper() });
    expect(anonymous.result.current.loading).toBe(false);
    expect(anonymous.result.current.data).toBeNull();

    mockAuth = { token: "token-b" };
    vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new ApiError(404, "Not Found", null));
    const missing = renderHook(() => useMyOrganization(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(missing.result.current.loading).toBe(false));
    expect(missing.result.current.data).toBeNull();
    expect(missing.result.current.error).toBeNull();
  });
});

describe("useUpdateOrganization", () => {
  it("sends the request and invalidates both organization prefixes", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockResolvedValue(ORGANIZATION);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateOrganization(), { wrapper: createQueryWrapper(client) });

    await act(() => result.current.update("7", { page_layout: "LINKS", palette_preset: null }));

    expect(organizationsApi.updateOrganization).toHaveBeenCalledWith("7", {
      page_layout: "LINKS",
      palette_preset: null,
    });
    expect(invalidatedPrefixes(invalidate)).toEqual(
      expect.arrayContaining([PUBLIC_ORGANIZATION_KEY, MY_ORGANIZATION_KEY]),
    );
  });

  it("rejects a 409 with the Polish conflict copy after invalidating both prefixes", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, message: "Dane zostały w międzyczasie zmienione" }),
    );
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useUpdateOrganization(), { wrapper: createQueryWrapper(client) });

    let prefixesAtRejection: unknown[] = [];
    let message = "";
    await act(async () => {
      await result.current.update("7", { page_layout: "LINKS" }).catch((err: Error) => {
        prefixesAtRejection = invalidatedPrefixes(invalidate);
        message = err.message;
      });
    });

    expect(message).toBe(CONFLICT_MESSAGE);
    expect(prefixesAtRejection).toEqual(expect.arrayContaining([PUBLIC_ORGANIZATION_KEY, MY_ORGANIZATION_KEY]));
  });

  it("maps a 400 with field errors to the appearance fallback copy", async () => {
    vi.mocked(organizationsApi.updateOrganization).mockRejectedValue(
      new ApiError(400, "Bad Request", {
        status: 400,
        error: "Bad Request",
        message: "Validation failed",
        fieldErrors: { page_layout: "Value error, unknown page layout" },
      }),
    );
    const { result } = renderHook(() => useUpdateOrganization(), { wrapper: createQueryWrapper() });

    await expect(result.current.update("7", { page_layout: "GRID" })).rejects.toThrow(
      "Nie udało się zapisać wyglądu. Wybierz układ i kolory jeszcze raz.",
    );
  });
});

describe("useMyOrganization media polling", () => {
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("polls every 10 s while a row is PENDING or NEEDS_REVIEW and stops once all are approved", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(organizationsApi.getMyOrganization)
      .mockResolvedValueOnce(withMedia(media("a", "PENDING")))
      .mockResolvedValueOnce(withMedia(media("a", "NEEDS_REVIEW")))
      .mockResolvedValue(withMedia(media("a", "APPROVED")));
    const { result } = renderHook(() => useMyOrganization({ pollPendingMedia: true }), {
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(result.current.data?.media[0].status).toBe("PENDING"));

    await tick(10_000);
    await waitFor(() => expect(result.current.data?.media[0].status).toBe("NEEDS_REVIEW"));
    await tick(10_000);
    await waitFor(() => expect(result.current.data?.media[0].status).toBe("APPROVED"));
    expect(organizationsApi.getMyOrganization).toHaveBeenCalledTimes(3);

    await tick(30_000);
    expect(organizationsApi.getMyOrganization).toHaveBeenCalledTimes(3);
  });

  it("never polls without the option, even with pending media (L7)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(withMedia(media("a", "PENDING")));
    const { result } = renderHook(() => useMyOrganization(), { wrapper: createQueryWrapper() });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await tick(30_000);
    expect(organizationsApi.getMyOrganization).toHaveBeenCalledTimes(1);
  });

  it("invalidates the public organization when a poll changes a status or drops a row, not otherwise (M4)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(organizationsApi.getMyOrganization)
      .mockResolvedValueOnce(withMedia(media("a", "PENDING"), media("b", "PENDING")))
      .mockResolvedValueOnce(withMedia(media("a", "PENDING"), media("b", "PENDING")))
      .mockResolvedValueOnce(withMedia(media("a", "APPROVED"), media("b", "PENDING")))
      .mockResolvedValue(withMedia(media("a", "APPROVED")));
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMyOrganization({ pollPendingMedia: true }), {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() => expect(result.current.data?.media).toHaveLength(2));
    expect(invalidate).not.toHaveBeenCalled();

    await tick(10_000);
    await waitFor(() => expect(organizationsApi.getMyOrganization).toHaveBeenCalledTimes(2));
    expect(invalidate).not.toHaveBeenCalled();

    await tick(10_000);
    await waitFor(() => expect(result.current.data?.media[0].status).toBe("APPROVED"));
    await waitFor(() => expect(invalidatedPrefixes(invalidate)).toEqual([PUBLIC_ORGANIZATION_KEY]));

    await tick(10_000);
    await waitFor(() => expect(result.current.data?.media).toHaveLength(1));
    await waitFor(() =>
      expect(invalidatedPrefixes(invalidate)).toEqual([PUBLIC_ORGANIZATION_KEY, PUBLIC_ORGANIZATION_KEY]),
    );
  });
});

const ORGANIZATION_OWNER: MediaOwner = { kind: "organization", organizationId: "7" };
const ME: MediaOwner = { kind: "me" };

describe("useMediaActions", () => {
  it.each<{ name: string; owner: MediaOwner; keys: string[]; others: string[] }>([
    {
      name: "an Organization",
      owner: ORGANIZATION_OWNER,
      keys: [PUBLIC_ORGANIZATION_KEY, MY_ORGANIZATION_KEY],
      others: [MY_PROFILE_KEY, OWNER_ITEMS_KEY],
    },
    {
      name: "the caller's profile",
      owner: ME,
      keys: [MY_PROFILE_KEY, OWNER_ITEMS_KEY],
      others: [PUBLIC_ORGANIZATION_KEY, MY_ORGANIZATION_KEY],
    },
  ])("uploads, removes and reorders for $name, invalidating its own reads after each call", async ({ owner, keys, others }) => {
    vi.mocked(mediaApi.uploadMedia).mockResolvedValue(media("a", "PENDING"));
    vi.mocked(mediaApi.deleteMedia).mockResolvedValue(undefined);
    vi.mocked(mediaApi.reorderGallery).mockResolvedValue([]);
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMediaActions(owner), { wrapper: createQueryWrapper(client) });
    const file = new File(["x"], "logo.png", { type: "image/png" });

    await act(() => result.current.upload("AVATAR", file));
    expect(mediaApi.uploadMedia).toHaveBeenCalledWith(owner, "AVATAR", file);
    expect(invalidatedPrefixes(invalidate)).toEqual(expect.arrayContaining(keys));

    invalidate.mockClear();
    await act(() => result.current.remove("m1"));
    expect(mediaApi.deleteMedia).toHaveBeenCalledWith(owner, "m1");
    expect(invalidatedPrefixes(invalidate)).toEqual(expect.arrayContaining(keys));

    invalidate.mockClear();
    await act(() => result.current.reorder(["m2", "m1"]));
    expect(mediaApi.reorderGallery).toHaveBeenCalledWith(owner, ["m2", "m1"]);
    expect(invalidatedPrefixes(invalidate)).toEqual(expect.arrayContaining(keys));
    for (const other of others) expect(invalidatedPrefixes(invalidate)).not.toContain(other);
  });

  it("rethrows the server message verbatim after invalidating the owner's reads", async () => {
    vi.mocked(mediaApi.uploadMedia).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, message: "Galeria może mieć najwyżej 3 zdjęcia." }),
    );
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMediaActions(ORGANIZATION_OWNER), { wrapper: createQueryWrapper(client) });

    let prefixesAtRejection: unknown[] = [];
    let message = "";
    await act(async () => {
      await result.current
        .upload("GALLERY", new File(["x"], "g.png", { type: "image/png" }))
        .catch((err: Error) => {
          prefixesAtRejection = invalidatedPrefixes(invalidate);
          message = err.message;
        });
    });

    expect(message).toBe("Galeria może mieć najwyżej 3 zdjęcia.");
    expect(prefixesAtRejection).toEqual(expect.arrayContaining([PUBLIC_ORGANIZATION_KEY, MY_ORGANIZATION_KEY]));
  });

  it("falls back to Polish copy per action when the server gives no message", async () => {
    vi.mocked(mediaApi.uploadMedia).mockRejectedValue(new TypeError("Failed to fetch"));
    vi.mocked(mediaApi.deleteMedia).mockRejectedValue(new ApiError(500, "Server Error", null));
    vi.mocked(mediaApi.reorderGallery).mockRejectedValue(new ApiError(500, "Server Error", null));
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useMediaActions(ME), { wrapper: createQueryWrapper(client) });

    await expect(result.current.upload("COVER", new File(["x"], "c.png"))).rejects.toThrow(
      "Nie udało się wysłać zdjęcia. Spróbuj ponownie.",
    );
    await expect(result.current.remove("m1")).rejects.toThrow("Nie udało się usunąć zdjęcia. Spróbuj ponownie.");
    await expect(result.current.reorder(["m1"])).rejects.toThrow(
      "Nie udało się zmienić kolejności. Spróbuj ponownie.",
    );
    expect(invalidatedPrefixes(invalidate).filter((p) => p === MY_PROFILE_KEY)).toHaveLength(3);
  });
});
