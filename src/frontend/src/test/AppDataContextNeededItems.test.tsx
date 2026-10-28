import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as familiesApi from "../api/families";
import * as groupsApi from "../api/groups";
import * as inventoriesApi from "../api/inventories";
import * as organizationsApi from "../api/organizations";
import * as peopleApi from "../api/people";
import * as pledgesApi from "../api/pledges";
import * as termsApi from "../api/terms";
import { AppDataProvider } from "../app/AppDataContext";
import { useAppData } from "../app/appDataStore";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "./queryClient";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "tok", username: "anna", logout: vi.fn() }),
}));
vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
  getLeadershipsForPerson: vi.fn(),
  updateMyProfile: vi.fn(),
  uploadMyAvatar: vi.fn(),
  deleteMyAvatar: vi.fn(),
}));
vi.mock("../api/families", () => ({
  getMyFamilies: vi.fn(),
  getGuardians: vi.fn(),
  getMembershipsForFamily: vi.fn(),
  createLightweightMembers: vi.fn(),
  removeFamilyMember: vi.fn(),
  renameFamily: vi.fn(),
  updateChildBirthYear: vi.fn(),
}));
vi.mock("../api/groups", () => ({
  getGroup: vi.fn(),
  getMyAttendances: vi.fn(),
  createAdditionalMyCircle: vi.fn(),
  deleteGroup: vi.fn(),
  updateGroup: vi.fn(),
}));
vi.mock("../api/inventories", () => ({
  ACTIVE_LOCK_BALANCE_STATUSES: [],
  getMyInventoryItems: vi.fn(),
  getInventoryItemBalance: vi.fn(),
  deleteInventoryItem: vi.fn(),
}));
vi.mock("../api/organizations", () => ({ getMyOrganization: vi.fn() }));
vi.mock("../api/pledges", () => ({ getMyPledges: vi.fn(), withdrawPledge: vi.fn() }));
vi.mock("../api/itemListingPreferences", () => ({ setItemListingPreference: vi.fn() }));
vi.mock("../api/terms", () => ({
  createTerm: vi.fn(),
  createNeededItem: vi.fn(),
  getTerms: vi.fn(),
  getNeededItems: vi.fn(),
}));

const term = { id: "t1", circle_group_id: "g1", occurs_on: "2026-11-05T17:00:00" } as termsApi.TermResponse;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={["/"]}>
        <AppDataProvider>{children}</AppDataProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Opens "Dodaj termin" with a group, a date and the given needed-item drafts. */
async function renderFilledTermForm(names: string[]) {
  const hook = renderHook(() => useAppData(), { wrapper });
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  act(() => {
    hook.result.current.setModal("termin");
    hook.result.current.selectTermGroup("g1");
    hook.result.current.setTermDate("2026-11-05T17:00");
  });
  for (const name of names) {
    act(() => hook.result.current.setDraftNeededItem({ name, description: "" }));
    act(() => hook.result.current.addDraftNeededItem());
  }
  return hook;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue({ id: "p1", display_name: "Anna", bio: null } as peopleApi.UserProfileResponse);
  vi.mocked(peopleApi.getLeadershipsForPerson).mockResolvedValue([]);
  vi.mocked(inventoriesApi.getMyInventoryItems).mockResolvedValue([]);
  vi.mocked(familiesApi.getMyFamilies).mockResolvedValue([]);
  vi.mocked(organizationsApi.getMyOrganization).mockRejectedValue(new Error("404"));
  vi.mocked(groupsApi.getMyAttendances).mockResolvedValue([]);
  vi.mocked(pledgesApi.getMyPledges).mockResolvedValue([]);
  vi.mocked(termsApi.createTerm).mockResolvedValue(term);
});

describe("AppDataContext — handleAddTerm needed items", () => {
  it("handleAddTerm_rejectedNeededItem_continuesWithTheRemainingNames", async () => {
    vi.mocked(termsApi.createNeededItem)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: "Nazwa narusza zasady." }))
      .mockResolvedValue({} as termsApi.NeededItemResponse);
    const { result } = await renderFilledTermForm(["Zła nazwa", "Termos"]);

    await act(() => result.current.handleAddTerm());

    expect(termsApi.createNeededItem).toHaveBeenCalledTimes(2);
    expect(termsApi.createNeededItem).toHaveBeenNthCalledWith(1, { term_id: "t1", name: "Zła nazwa", description: undefined });
    expect(termsApi.createNeededItem).toHaveBeenNthCalledWith(2, { term_id: "t1", name: "Termos", description: undefined });
  });

  it("handleAddTerm_rejectedNeededItem_closesModalWithoutTermError", async () => {
    vi.mocked(termsApi.createNeededItem).mockRejectedValue(
      new ApiError(409, "Conflict", { message: "Nazwa narusza zasady." }),
    );
    const { result } = await renderFilledTermForm(["Zła nazwa"]);

    await act(() => result.current.handleAddTerm());

    expect(result.current.modal).toBeNull();
    expect(result.current.addTermError).toBeNull();
    expect(result.current.neededDraft).toEqual([]);
  });

  it("handleAddTerm_rejectedNeededItems_showsOneToastWithNamesAndFirstMessage", async () => {
    vi.mocked(termsApi.createNeededItem)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: "Pierwszy powód." }))
      .mockResolvedValueOnce({} as termsApi.NeededItemResponse)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: "Drugi powód." }));
    const { result } = await renderFilledTermForm(["Zła", "Termos", "Gorsza"]);

    await act(() => result.current.handleAddTerm());

    expect(result.current.toast).toBe("Termin dodany, ale nie dodano rzeczy: Zła, Gorsza — Pierwszy powód.");
  });
});
