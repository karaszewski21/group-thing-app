import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyItemsView } from "../features/items/MyItemsView";
import * as appDataStore from "../features/panel/appDataStore";
import type { AppDataContextValue } from "../features/panel/AppDataContext";
import * as authContext from "../auth/AuthContext";
import * as inventoriesApi from "../api/inventories";
import type { MyInventoryItemResponse } from "../api/inventories";
import * as reservationsApi from "../api/reservations";
import type { ReservationDetailResponse, ReservationType } from "../api/reservations";
import * as termItemListingsApi from "../api/termItemListings";
import type { AcceptedSwapProposalResponse, SwapProposalOfferResponse } from "../api/termItemListings";
import { api } from "../api/client";
import { setItemListingPreference } from "../api/itemListingPreferences";
import { createQueryWrapper } from "./queryClient";

vi.mock("../features/panel/appDataStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/panel/appDataStore")>();
  return { ...actual, useAppData: vi.fn() };
});

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return { ...actual, useAuth: vi.fn() };
});

vi.mock("../api/inventories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/inventories")>();
  return {
    ...actual,
    getInventoryItemBalances: vi.fn(),
  };
});

vi.mock("../api/reservations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/reservations")>();
  return { ...actual, getReservation: vi.fn(), confirmTransaction: vi.fn(), cancelTransaction: vi.fn() };
});

vi.mock("../api/termItemListings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/termItemListings")>();
  return { ...actual, getSwapProposalsForItem: vi.fn(), acceptSwapProposal: vi.fn() };
});

const item: MyInventoryItemResponse = {
  id: "item-1",
  inventory_id: "inv-1",
  home_inventory_id: null,
  product_id: "prod-1",
  product_name: "Rowerek",
  condition: "GOOD",
  added_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  listing_mode: null,
  listing_visibility: null,
  listing_status: "ACTIVE",
  photos_moderation_pending: false,
  location_id: "loc-1",
};

/** A future-dated term reservation would hide the buttons; `personal_pickup`
 * alone must make them show. */
function personalReservation(
  type: ReservationType,
  over: Partial<ReservationDetailResponse> = {},
): ReservationDetailResponse {
  return {
    id: "res-1",
    item_id: item.id,
    reservation_type: type,
    reserved_by_user_id: "other-user",
    term_id: null,
    event_id: null,
    paired_reservation_id: type === "SWAP" ? "res-2" : null,
    reserved_at: "2026-10-30T10:00:00Z",
    expires_at: null,
    status: "CONFIRMED",
    notes: null,
    term_occurs_on: null,
    personal_pickup: true,
    ...over,
  };
}

function setup({
  itemModes = {},
  items = [item],
  reservation = null,
}: {
  itemModes?: AppDataContextValue["itemModes"];
  items?: MyInventoryItemResponse[];
  reservation?: ReservationDetailResponse | null;
} = {}) {
  vi.mocked(authContext.useAuth).mockReturnValue({
    token: "test-token",
    username: "me",
  } as ReturnType<typeof authContext.useAuth>);
  vi.mocked(appDataStore.useAppData).mockReturnValue({
    items,
    itemModes,
    itemError: null,
    setItemMode: vi.fn(),
    setItemVisibility: vi.fn().mockResolvedValue(undefined),
    handleDeleteItem: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppDataContextValue);
  vi.mocked(inventoriesApi.getInventoryItemBalances).mockResolvedValue({
    [item.id]: reservation
      ? { status: "RESERVED", reservationId: reservation.id }
      : { status: "AVAILABLE", reservationId: null },
  });
  if (reservation) vi.mocked(reservationsApi.getReservation).mockResolvedValue(reservation);
  vi.mocked(termItemListingsApi.getSwapProposalsForItem).mockResolvedValue([]);
}

function renderWithProviders() {
  return renderWithRoute(<MyItemsView />, { url: "/", wrapper: createQueryWrapper() });
}

describe("MyItemsView — no inventory location card", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists the items without the removed pickup-place card", async () => {
    setup();
    renderWithProviders();

    expect(await screen.findByText(item.product_name)).toBeInTheDocument();
    expect(screen.queryByText("Gdzie są moje rzeczy?")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("MyItemsView — personal reservations confirm/cancel immediately", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("offers the giver of a personal GIFT only 'Anuluj wymianę' right away", async () => {
    setup({ itemModes: { [item.id]: "oddam" }, reservation: personalReservation("GIFT") });
    renderWithProviders();

    expect(await screen.findByRole("button", { name: "Anuluj wymianę" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
  });

  it("offers both buttons on a paired personal SWAP right away", async () => {
    setup({ reservation: personalReservation("SWAP") });
    renderWithProviders();

    expect(await screen.findByRole("button", { name: "Odebrał" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anuluj wymianę" })).toBeInTheDocument();
  });

  it("offers neither button on an unpaired SWAP leg", async () => {
    setup({ reservation: personalReservation("SWAP", { paired_reservation_id: null }) });
    renderWithProviders();

    await waitFor(() => expect(reservationsApi.getReservation).toHaveBeenCalledWith("res-1"));
    expect(await screen.findByRole("status")).toHaveTextContent("czeka na potwierdzenie");
    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anuluj wymianę" })).not.toBeInTheDocument();
  });
});

describe("MyItemsView — accepting a personal swap", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the personal-pickup copy when the accept has no term date or group", async () => {
    setup({ itemModes: { [item.id]: "zamienię" } });
    const proposal: SwapProposalOfferResponse = {
      id: "prop-1",
      proposer_party_id: "party-2",
      proposer_display_name: "Ola",
      offered_item_id: "item-2",
      offered_product_name: "Hulajnoga",
      created_at: "2026-10-30T10:00:00Z",
    };
    const accepted: AcceptedSwapProposalResponse = {
      id: "prop-1",
      proposer_party_id: "party-2",
      listing_item_id: item.id,
      offered_item_id: "item-2",
      proposer_reservation_id: "res-9",
      status: "ACCEPTED",
      created_at: "2026-10-30T10:00:00Z",
      updated_at: "2026-10-30T11:00:00Z",
      term_id: null,
      term_occurs_on: null,
      group_id: null,
      group_name: null,
      event_id: null,
      event_slug: null,
    };
    vi.mocked(termItemListingsApi.getSwapProposalsForItem).mockResolvedValue([proposal]);
    vi.mocked(termItemListingsApi.acceptSwapProposal).mockResolvedValue(accepted);
    renderWithProviders();

    fireEvent.click(await screen.findByRole("button", { name: "Wybierz" }));

    expect(
      await screen.findByText("Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/na tym terminie/)).not.toBeInTheDocument();
  });

  it("an event swap (no term or group id, but the event start and name) opens the success sheet, not the personal copy", async () => {
    setup({ itemModes: { [item.id]: "zamienię" } });
    vi.mocked(termItemListingsApi.getSwapProposalsForItem).mockResolvedValue([
      {
        id: "prop-1",
        proposer_party_id: "party-2",
        proposer_display_name: "Ola",
        offered_item_id: "item-2",
        offered_product_name: "Hulajnoga",
        created_at: "2026-10-30T10:00:00Z",
      },
    ]);
    vi.mocked(termItemListingsApi.acceptSwapProposal).mockResolvedValue({
      id: "prop-1",
      proposer_party_id: "party-2",
      listing_item_id: item.id,
      offered_item_id: "item-2",
      proposer_reservation_id: "res-9",
      status: "ACCEPTED",
      created_at: "2026-10-30T10:00:00Z",
      updated_at: "2026-10-30T11:00:00Z",
      term_id: null,
      term_occurs_on: "2026-11-07T10:00:00",
      group_id: null,
      group_name: "Kiermasz zimowy",
      event_id: "ev-1",
      event_slug: "ania",
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole("button", { name: "Wybierz" }));

    expect(await screen.findByRole("dialog", { name: "Zamiana zaakceptowana" })).toHaveTextContent("Kiermasz zimowy");
    expect(screen.queryByText("Zamiana przyjęta — odbiór osobisty, ustalcie szczegóły na czacie.")).not.toBeInTheDocument();
  });
});

describe("MyItemsView — item visibility", () => {
  const PRIVATE_HINT = "Prywatna: widoczna tylko w Twoich prywatnych grupach.";
  const NO_MODE_HINT = "Ustaw tryb, żeby wybrać widoczność.";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("the toggle saves the visibility together with the item's current mode", async () => {
    setup({
      itemModes: { [item.id]: "zamienię" },
      items: [{ ...item, listing_mode: "SWAP", listing_visibility: "PUBLIC" }],
    });
    renderWithProviders();

    const group = await screen.findByRole("group", { name: `Widoczność: ${item.product_name}` });
    expect(within(group).getByRole("button", { name: "Publiczna" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "Prywatna" }));

    const { setItemVisibility, setItemMode } = vi.mocked(appDataStore.useAppData)();
    expect(setItemVisibility).toHaveBeenCalledWith(item.id, "zamienię", "PRIVATE");
    expect(setItemMode).not.toHaveBeenCalled();
  });

  it("the mode selector changes only the mode", async () => {
    setup({
      itemModes: { [item.id]: "zamienię" },
      items: [{ ...item, listing_mode: "SWAP", listing_visibility: "PRIVATE" }],
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole("button", { name: "Oddam" }));

    const { setItemVisibility, setItemMode } = vi.mocked(appDataStore.useAppData)();
    expect(setItemMode).toHaveBeenCalledWith(item.id, "oddam");
    expect(setItemVisibility).not.toHaveBeenCalled();
  });

  it("without a mode the row shows the hint and no toggle", async () => {
    setup();
    renderWithProviders();

    expect(await screen.findByText(NO_MODE_HINT)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: `Widoczność: ${item.product_name}` })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Prywatna" })).not.toBeInTheDocument();
  });

  it("a private item shows its hint", async () => {
    setup({
      itemModes: { [item.id]: "oddam" },
      items: [{ ...item, listing_mode: "GIFT", listing_visibility: "PRIVATE" }],
    });
    renderWithProviders();

    expect(await screen.findByText(PRIVATE_HINT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prywatna" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(NO_MODE_HINT)).not.toBeInTheDocument();
  });

  it("the request body carries visibility only together with a mode", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue(null);

    await setItemListingPreference(item.id, "SWAP");
    expect(put).toHaveBeenLastCalledWith(`/item-listing-preferences/${item.id}`, { mode: "SWAP" });

    await setItemListingPreference(item.id, "SWAP", "PRIVATE");
    expect(put).toHaveBeenLastCalledWith(`/item-listing-preferences/${item.id}`, {
      mode: "SWAP",
      visibility: "PRIVATE",
    });
    put.mockRestore();
  });
});

describe("MyItemsView — cancelling a personal reservation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("'Anuluj wymianę' on a personal GIFT cancels its reservation and silently reloads", async () => {
    setup({ itemModes: { [item.id]: "oddam" }, reservation: personalReservation("GIFT") });
    vi.mocked(reservationsApi.cancelTransaction).mockResolvedValue({
      reservation_id: "res-1",
      status: "CANCELLED",
      already_resolved: false,
    });
    renderWithProviders();

    fireEvent.click(await screen.findByRole("button", { name: "Anuluj wymianę" }));

    await waitFor(() => expect(reservationsApi.cancelTransaction).toHaveBeenCalledWith("res-1"));
    const { load } = vi.mocked(appDataStore.useAppData).mock.results[0].value as AppDataContextValue;
    await waitFor(() => expect(load).toHaveBeenCalledWith({ silent: true }));
  });
});
