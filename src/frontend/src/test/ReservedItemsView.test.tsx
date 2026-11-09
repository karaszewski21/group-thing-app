import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getMyReservations, type MyReservationResponse } from "../api/reservations";
import { ReservedItemsView } from "../features/items/ReservedItemsView";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "t", username: null, permissions: [] }) }));
vi.mock("../api/reservations", () => ({ getMyReservations: vi.fn() }));

function reservation(overrides: Partial<MyReservationResponse> = {}): MyReservationResponse {
  return {
    item_id: "item-1",
    product_name: "Rowerek biegowy",
    thumb_url: null,
    item_path: "/ola/product/item-1",
    owner_name: "Ola",
    mode: "GIFT",
    status: "PENDING",
    reservation_id: "res-1",
    context_kind: "PERSONAL",
    context_name: null,
    occurs_at: null,
    reserved_at: "2026-11-08T10:00:00",
    ...overrides,
  };
}

function renderView() {
  return renderWithRoute(<ReservedItemsView />, { url: "/items/reserved", wrapper: createQueryWrapper() });
}

describe("ReservedItemsView", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("lists each reserved item linking to its page with pickup and status", async () => {
    vi.mocked(getMyReservations).mockResolvedValue([
      reservation(),
      reservation({
        item_id: "item-2",
        product_name: "Sanki",
        item_path: "/klub/product/item-2",
        mode: "SWAP",
        status: "PROPOSED",
        reservation_id: null,
        context_kind: "EVENT",
        context_name: "Piknik wymiany",
        occurs_at: "2026-11-14T11:00:00",
      }),
    ]);

    renderView();

    const bike = await screen.findByRole("link", { name: /^Rowerek biegowy od Ola Odbiór osobisty/ });
    expect(bike).toHaveAttribute("href", "/ola/product/item-1");
    expect(bike).toHaveTextContent("Czeka na potwierdzenie");
    const sled = screen.getByRole("link", { name: /^Sanki/ });
    expect(sled).toHaveAttribute("href", "/klub/product/item-2");
    expect(sled).toHaveTextContent("Piknik wymiany · sob 14 lis, 11:00");
    expect(sled).toHaveTextContent("Propozycja zamiany czeka na odpowiedź");
  });

  it("shows the empty state without reservations", async () => {
    vi.mocked(getMyReservations).mockResolvedValue([]);

    renderView();

    expect(await screen.findByText("Nic nie rezerwujesz")).toBeInTheDocument();
  });

  it("shows the server error", async () => {
    vi.mocked(getMyReservations).mockRejectedValue(
      new ApiError(500, "Internal Server Error", { message: "Serwer nie odpowiada" }),
    );

    renderView();

    expect(await screen.findByRole("alert")).toHaveTextContent("Serwer nie odpowiada");
  });
});
