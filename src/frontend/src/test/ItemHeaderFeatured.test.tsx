import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ItemActionsResponse } from "../api/itemActions";
import type { ItemDetailsResponse } from "../api/items";
import { ItemPageContext, type ItemPageValue } from "../features/product/ItemPageContext";
import type { ItemActionsView } from "../features/product/itemActionsViewState";
import { ItemHeader } from "../features/product/blocks/ItemHeader";
import { renderWithRoute } from "./renderWithRoute";

const ITEM: ItemDetailsResponse = {
  id: "item-1",
  product_id: "prod-1",
  name: "Rower dziecięcy 16”",
  category_id: "cat-1",
  category_name: "Rowery",
  condition: "GOOD",
  description: null,
  photos: [],
  product_photo_url: null,
  is_owner: false,
  deleted_at: null,
  listing_status: "ACTIVE",
  location_id: null,
  status: { code: "AVAILABLE", term_occurs_on: null, due_date: null, counterparty_label: null, personal_pickup: false },
};

const OWNER: ItemActionsResponse["owner"] = { party_id: "p-anna", display_name: "Anna K.", slug: "anna-k", items_total: 7 };

function actions(overrides: Partial<ItemActionsResponse> = {}): ItemActionsResponse {
  return {
    mode: "GIFT",
    points_price: null,
    visibility: null,
    available: true,
    reservation: null,
    party_reservation: null,
    owner: OWNER,
    viewer: "OTHER",
    location: null,
    contexts: [],
    personal_pickup_available: false,
    is_featured: true,
    ...overrides,
  };
}

const CHOOSE: ItemActionsView = {
  kind: "choose",
  owner: OWNER,
  mode: "GIFT",
  location: null,
  contexts: [],
  eligibleContexts: [],
  personalPickup: false,
  pointsPrice: null,
};

function renderHeader(view: ItemActionsView, data: ItemActionsResponse) {
  const value: ItemPageValue = {
    item: ITEM,
    actions: { data, loading: false, fetching: false, error: null, refetch: async () => {} },
    view,
    isLoggedIn: true,
    statusAsPill: false,
    chat: { open: async () => {}, busy: false, error: null },
  };
  return renderWithRoute(
    <ItemPageContext.Provider value={value}>
      <ItemHeader />
    </ItemPageContext.Provider>,
    { url: "/anna-k/product/item-1" },
  );
}

describe("ItemHeader — featured pill", () => {
  it("shows the md „⭐ Wyróżnione” pill before the mode pill for a featured item", () => {
    renderHeader(CHOOSE, actions());

    const star = screen.getByText("⭐");
    expect(star).toHaveAttribute("aria-hidden", "true");
    const pill = star.parentElement as HTMLElement;
    expect(pill).toHaveClass("bg-ink", "text-on-ink", "px-2.5", "text-xs");
    expect(pill.parentElement).toHaveTextContent(/^⭐ Wyróżnione Chcę oddać$/);
  });

  it.each<[string, ItemActionsView]>([
    ["loading", { kind: "loading" }],
    ["hidden", { kind: "hidden" }],
  ])("hides the pill while the view is %s", (_label, view) => {
    renderHeader(view, actions());

    expect(screen.queryByText(/Wyróżnione/)).not.toBeInTheDocument();
  });

  it("shows no pill for an item that is not featured", () => {
    renderHeader(CHOOSE, actions({ is_featured: false }));

    expect(screen.queryByText(/Wyróżnione/)).not.toBeInTheDocument();
    expect(screen.getByText("Chcę oddać")).toBeInTheDocument();
  });
});
