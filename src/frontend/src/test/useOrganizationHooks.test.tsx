import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as organizationsApi from "../api/organizations";
import type { OrganizationResponse } from "../api/organizations";
import { MY_ORGANIZATION_KEY, useMyOrganization } from "../hooks/useMyOrganization";
import { useMyOrganizationSlug } from "../hooks/useMyOrganizationSlug";
import { PUBLIC_ORGANIZATION_KEY } from "../hooks/usePublicOrganization";
import { useUpdateOrganization } from "../hooks/useUpdateOrganization";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";

let mockAuth: { token: string | null };
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

vi.mock("../api/organizations", () => ({
  getMyOrganization: vi.fn(),
  updateOrganization: vi.fn(),
}));

const ORGANIZATION: OrganizationResponse = {
  id: "7",
  party_id: "11",
  name: "Muzyczne Skrzaty",
  slug: "muzyczne-skrzaty",
  primary_color: null,
  accent_color: null,
  page_layout: "CLASSIC",
  palette_preset: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

const CONFLICT_MESSAGE =
  "Ktoś zmienił tę stronę w międzyczasie. Pobraliśmy aktualną wersję — sprawdź swoje zmiany i zapisz ponownie.";

function invalidatedPrefixes(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth = { token: "token-a" };
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

describe("useMyOrganizationSlug", () => {
  it("reads the slug through the shared myOrganization key", async () => {
    vi.mocked(organizationsApi.getMyOrganization).mockResolvedValue(ORGANIZATION);
    const client = createTestQueryClient();

    const { result } = renderHook(() => ({ slug: useMyOrganizationSlug(), org: useMyOrganization() }), {
      wrapper: createQueryWrapper(client),
    });

    await waitFor(() => expect(result.current.slug).toBe("muzyczne-skrzaty"));
    expect(result.current.org.data).toEqual(ORGANIZATION);
    expect(organizationsApi.getMyOrganization).toHaveBeenCalledTimes(1);
    expect(client.getQueryData([MY_ORGANIZATION_KEY, "token-a"])).toEqual(ORGANIZATION);
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
