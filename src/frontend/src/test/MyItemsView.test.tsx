import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyItemsView } from "../features/items/MyItemsView";
import * as appDataStore from "../features/panel/appDataStore";
import type { AppDataContextValue } from "../features/panel/AppDataContext";
import * as authContext from "../auth/AuthContext";
import type { MyInventoryItemResponse } from "../api/inventories";
import * as reservationsApi from "../api/reservations";
import type { ReservationDetailResponse, ReservationType } from "../api/reservations";
import * as termItemListingsApi from "../api/termItemListings";
import type { AcceptedSwapProposalResponse, SwapProposalOfferResponse } from "../api/termItemListings";
import { api } from "../api/client";
import { setItemListingPreference } from "../api/itemListingPreferences";
import { POINTS_KEY } from "../hooks/usePointsConfig";
import { createQueryWrapper, createTestQueryClient } from "./queryClient";
import { myItemsPageMock, pageResult, resetMyItemsPageMock } from "./myItemsPageMock";

vi.mock("../hooks/useMyItemsPage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useMyItemsPage")>();
  const { useFakeMyItemsPage } = await import("./myItemsPageMock");
  return { ...actual, useMyItemsPage: useFakeMyItemsPage };
});

vi.mock("../features/panel/appDataStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/panel/appDataStore")>();
  return { ...actual, useAppData: vi.fn() };
});

vi.mock("../auth/AuthContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/AuthContext")>();
  return { ...actual, useAuth: vi.fn() };
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
  owner_inventory_id: "inv-1",
  product_id: "prod-1",
  product_name: "Rowerek",
  condition: "GOOD",
  added_at: "2026-01-01T00:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  listing_mode: null,
  listing_visibility: null,
  points_price: null,
  listing_status: "ACTIVE",
  photos_moderation_pending: false,
  location_id: "loc-1",
  points_value: null,
  balance_status: "AVAILABLE",
  reservation_id: null,
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
  // A reservation locks the first fixture item, as the server reports it.
  const shownItems = items.map((it) =>
    reservation && it.id === item.id
      ? { ...it, balance_status: "RESERVED" as const, reservation_id: reservation.id }
      : it,
  );
  vi.mocked(appDataStore.useAppData).mockReturnValue({
    items: shownItems,
    itemModes,
    itemError: null,
    setItemMode: vi.fn(),
    setItemVisibility: vi.fn().mockResolvedValue(undefined),
    handleDeleteItem: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppDataContextValue);
  if (reservation) vi.mocked(reservationsApi.getReservation).mockResolvedValue(reservation);
  vi.mocked(termItemListingsApi.getSwapProposalsForItem).mockResolvedValue([]);
}

function renderWithProviders(client = createTestQueryClient()) {
  return renderWithRoute(<MyItemsView />, { url: "/", wrapper: createQueryWrapper(client) });
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
    expect(screen.getAllByRole("combobox")).toEqual([screen.getByRole("combobox", { name: "Tryb" })]);
  });
});

describe("MyItemsView — points value", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the stored value next to the condition, and nothing for an item not valued yet", async () => {
    const valued: MyInventoryItemResponse = { ...item, id: "item-2", product_name: "Komoda", points_value: 60 };
    setup({ items: [item, valued] });
    renderWithProviders();

    expect(await screen.findByText("60 pkt")).toBeInTheDocument();
    expect(screen.getAllByText(/pkt$/)).toHaveLength(1);
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

describe("MyItemsView — POINTS listings", () => {
  const bike: MyInventoryItemResponse = { ...item, listing_mode: "POINTS", points_price: 40, points_value: 40 };

  beforeEach(() => {
    vi.resetAllMocks();
    resetMyItemsPageMock();
  });

  it("offers the seller of a POINTS reservation only 'Anuluj wymianę' — the buyer confirms", async () => {
    setup({ items: [bike], itemModes: { [item.id]: "za punkty" }, reservation: personalReservation("POINTS") });
    renderWithProviders();

    expect(await screen.findByRole("button", { name: "Anuluj wymianę" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odebrał" })).not.toBeInTheDocument();
  });

  it("shows the price chip, read as „Za punkty: N pkt”, beside the system value", async () => {
    setup({ items: [bike], itemModes: { [item.id]: "za punkty" } });
    renderWithProviders();

    const hidden = await screen.findByText("Za punkty:");
    expect(hidden).toHaveClass("sr-only");
    expect(hidden.parentElement).toHaveClass("bg-orange", "text-ink");
    expect(hidden.parentElement).toHaveTextContent(/^Za punkty: 40 pkt$/);
  });

  it("filters by „Za punkty” with its count", async () => {
    setup({ items: [bike], itemModes: { [item.id]: "za punkty" } });
    myItemsPageMock.result = pageResult([bike], { counts: { ALL: 5, GIFT: 1, SWAP: 1, POINTS: 3 } });
    renderWithProviders();

    const select = await screen.findByRole("combobox", { name: "Tryb" });
    expect(within(select).getByRole("option", { name: "Za punkty (3)" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "za punkty" } });

    expect(myItemsPageMock.calls.at(-1)).toEqual(["POINTS", ""]);
  });

  it("the „Za punkty” mode option saves the mode alone, without a price", async () => {
    setup();
    renderWithProviders();

    fireEvent.click(await screen.findByRole("button", { name: "Za punkty" }));
    const { setItemMode } = vi.mocked(appDataStore.useAppData)();
    expect(setItemMode).toHaveBeenCalledWith(item.id, "za punkty");

    const put = vi.spyOn(api, "put").mockResolvedValue(null);
    await setItemListingPreference(item.id, "POINTS");
    expect(put).toHaveBeenLastCalledWith(`/item-listing-preferences/${item.id}`, { mode: "POINTS" });
    put.mockRestore();
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
  const PRIVATE_HINT = "Widzą ją tylko osoby z Twoich prywatnych grup.";
  const NO_MODE_HINT = "Wybierz, czy oddajesz, czy zamieniasz — wtedy inni zobaczą rzecz.";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("the toggle saves the visibility together with the item's current mode", async () => {
    setup({
      itemModes: { [item.id]: "zamienię" },
      items: [{ ...item, listing_mode: "SWAP", listing_visibility: "PUBLIC" }],
    });
    renderWithProviders();

    const priv = await screen.findByRole("radio", { name: `Prywatna: ${item.product_name}` });
    expect(priv).toHaveAttribute("aria-checked", "false");
    fireEvent.click(priv);

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
    expect(screen.queryByRole("radio", { name: `Prywatna: ${item.product_name}` })).not.toBeInTheDocument();
  });

  it("a private item shows its hint", async () => {
    setup({
      itemModes: { [item.id]: "oddam" },
      items: [{ ...item, listing_mode: "GIFT", listing_visibility: "PRIVATE" }],
    });
    renderWithProviders();

    expect(await screen.findByText(PRIVATE_HINT)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: `Prywatna: ${item.product_name}` })).toHaveAttribute("aria-checked", "true");
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

  it("'Anuluj wymianę' on a personal POINTS sale also refreshes the points queries", async () => {
    setup({ itemModes: { [item.id]: "za punkty" }, reservation: personalReservation("POINTS") });
    vi.mocked(reservationsApi.cancelTransaction).mockResolvedValue({
      reservation_id: "res-1",
      status: "CANCELLED",
      already_resolved: false,
    });
    const client = createTestQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderWithProviders(client);

    fireEvent.click(await screen.findByRole("button", { name: "Anuluj wymianę" }));

    await waitFor(() => expect(reservationsApi.cancelTransaction).toHaveBeenCalledWith("res-1"));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [POINTS_KEY] }));
  });
});

describe("MyItemsView — filter bar", () => {
  const scooter: MyInventoryItemResponse = { ...item, id: "item-2", product_name: "Hulajnoga", listing_mode: "SWAP" };

  beforeEach(() => {
    vi.resetAllMocks();
    resetMyItemsPageMock();
  });

  it("the select shows the server counts and asks for one mode", async () => {
    setup({ items: [item, scooter], itemModes: { [scooter.id]: "zamienię" } });
    myItemsPageMock.result = pageResult([item, scooter], { counts: { ALL: 12, GIFT: 4, SWAP: 7, POINTS: 0 } });
    renderWithProviders();

    const select = await screen.findByRole("combobox", { name: "Tryb" });
    expect(within(select).getByRole("option", { name: "Wszystkie (12)" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Oddam (4)" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Zamienię (7)" })).toBeInTheDocument();
    expect(myItemsPageMock.calls.at(-1)).toEqual([null, ""]);

    fireEvent.change(select, { target: { value: "zamienię" } });

    expect(myItemsPageMock.calls.at(-1)).toEqual(["SWAP", ""]);
  });

  it("the search passes the typed name together with the mode and clears it", async () => {
    setup();
    renderWithProviders();

    fireEvent.change(await screen.findByRole("combobox", { name: "Tryb" }), { target: { value: "oddam" } });
    fireEvent.change(screen.getByRole("searchbox", { name: "Szukaj po nazwie" }), {
      target: { value: "Rower" },
    });
    expect(myItemsPageMock.calls.at(-1)).toEqual(["GIFT", "Rower"]);

    fireEvent.click(screen.getByRole("button", { name: "Wyczyść wyszukiwanie" }));
    expect(myItemsPageMock.calls.at(-1)).toEqual(["GIFT", ""]);
  });

  it("an empty filtered page keeps the bar and says nothing matches", async () => {
    setup();
    myItemsPageMock.result = pageResult([], { counts: { ALL: 3, GIFT: 0, SWAP: 3, POINTS: 0 } });
    renderWithProviders();

    expect(await screen.findByText("Brak rzeczy pasujących do filtra.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Szukaj po nazwie" })).toBeInTheDocument();
    expect(screen.queryByText("Nie masz jeszcze żadnej rzeczy")).not.toBeInTheDocument();
  });

  it("without any item shows the empty state and no filter bar", async () => {
    setup({ items: [] });
    renderWithProviders();

    expect(await screen.findByText("Nie masz jeszcze żadnej rzeczy")).toBeInTheDocument();
    expect(screen.queryByRole("search", { name: "Filtruj rzeczy" })).not.toBeInTheDocument();
  });

  it("a failed next page offers a retry", async () => {
    setup();
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    myItemsPageMock.result = pageResult([item], {
      hasNextPage: true,
      nextPageError: "Błąd serwera",
      fetchNextPage,
    });
    renderWithProviders();

    expect(await screen.findByText("Nie udało się wczytać kolejnych rzeczy")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
