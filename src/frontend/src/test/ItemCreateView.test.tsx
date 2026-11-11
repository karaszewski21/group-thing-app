import { Activity } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ItemCreateView } from "../features/items/ItemCreateView";
import { FailedPhotosNotice } from "../features/product/blocks/ItemHeader";
import * as inventoriesApi from "../api/inventories";
import * as peopleApi from "../api/people";
import * as productsApi from "../api/products";
import * as categoriesApi from "../api/categories";
import * as locationsApi from "../api/locations";
import { ApiError } from "../api/client";
import type { Category } from "../api/categories";
import type { InventoryItemResponse, InventoryResponse, MyInventoryItemResponse } from "../api/inventories";
import type { UserProfileResponse } from "../api/people";
import type { ProductResponse } from "../api/products";
import { useAppParams } from "../routing/navigation";
import { createEmptyItemQuickAddValue, type ItemQuickAddValue } from "../utils/itemQuickAdd";
import { makeLocality, makeLocationResponse } from "./fixtures/locations";
import { createQueryWrapper } from "./queryClient";
import { renderWithRoute } from "./renderWithRoute";

/** A stand-in for the panel's AppDataContext: the item draft slices live
 * outside the page, so they survive its unmount as they do in the panel. */
const panel = vi.hoisted(() => {
  let state: Record<string, unknown> = {};
  const listeners = new Set<() => void>();
  function set(key: string, next: unknown) {
    const value = typeof next === "function" ? (next as (prev: unknown) => unknown)(state[key]) : next;
    state = { ...state, [key]: value };
    listeners.forEach((listener) => listener());
  }
  return {
    reset(initial: Record<string, unknown>) {
      state = initial;
    },
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setters: {
      setItemDraft: (next: unknown) => set("itemDraft", next),
      setItemPhotos: (next: unknown) => set("itemPhotos", next),
    },
  };
});

vi.mock("../features/panel/appDataStore", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useAppData: () => ({ ...useSyncExternalStore(panel.subscribe, panel.get), ...panel.setters }),
  };
});

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/locations", () => ({
  getMyLocations: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}));

vi.mock("../api/inventories", () => ({
  getOrCreatePersonalInventory: vi.fn(),
  registerInventoryItem: vi.fn(),
}));

vi.mock("../api/people", () => ({
  getMyProfile: vi.fn(),
}));

vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
  addProductPhoto: vi.fn(),
  updateProductDescription: vi.fn(),
}));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));

// Ids are UUID strings at runtime; some API types still declare `number`.
const ACCOUNT_USER_ID = "0b1c2d3e-4f50-4617-8a29-3b4c5d6e7f80";
const INVENTORY_ID = "1c2d3e4f-5061-4728-9b3a-4c5d6e7f8091";
const PRODUCT_ID = "2d3e4f50-6172-4839-8c4b-5d6e7f8091a2";
const NEW_ITEM_ID = "3e4f5061-7283-494a-9d5c-6e7f8091a2b3";
const CAT_KIDS = "4f506172-8394-4a5b-8e6d-7f8091a2b3c4";
const CAT_STROLLERS = "50617283-94a5-4b6c-9f7e-8091a2b3c4d5";
const CAT_TOYS = "6172839a-a5b6-4c7d-8e8f-91a2b3c4d5e6";

const KETY = makeLocationResponse();
const POZNAN = makeLocationResponse({
  id: "loc-2",
  locality: makeLocality({ id: "0969400", name: "Poznań", gmina: "Poznań", powiat: "Poznań", voivodeship: "wielkopolskie" }),
  label: "Poznań, wielkopolskie",
});
const MISSING_HINT = "Podaj nazwę, wybierz kategorię i lokalizację, aby zapisać.";

const CONFLICT_MESSAGE = "Ustaw lokalizację przedmiotu, aby go wystawić";

function category(id: string, name: string, parent_id: string | null, sort_order: number): Category {
  return {
    id,
    name,
    description: null,
    parent_id,
    sort_order,
    product_count: 0,
    created_at: "",
    updated_at: "",
  };
}

function myItem(id: string, location_id: string | null, created_at: string): MyInventoryItemResponse {
  return {
    id,
    inventory_id: INVENTORY_ID,
    home_inventory_id: null,
    product_id: PRODUCT_ID,
    product_name: "Rowerek",
    condition: "GOOD",
    listing_status: "DRAFT",
    added_at: created_at,
    created_at,
    updated_at: created_at,
    listing_mode: null,
    listing_visibility: null,
    photos_moderation_pending: false,
    location_id,
    balance_status: "AVAILABLE",
    reservation_id: null,
  };
}

function storedDraft(): ItemQuickAddValue {
  return panel.get().itemDraft as ItemQuickAddValue;
}

function NewItemProbe() {
  const { id } = useAppParams();
  return (
    <>
      <p>ITEM PAGE {id}</p>
      <p>DRAFT NAME [{storedDraft().name}]</p>
      <FailedPhotosNotice />
    </>
  );
}

function renderPage() {
  return renderWithRoute(<ItemCreateView />, {
    url: "/add/product",
    pattern: "/add/product",
    routes: { "/ania/product/:id": <NewItemProbe /> },
    wrapper: createQueryWrapper(),
  });
}

function placeSelect() {
  return screen.getByRole("combobox", { name: "Lokalizacja" });
}

function categoryTrigger() {
  return screen.getByRole("button", { name: /^Kategoria/ });
}

function actionButtons() {
  return ["Oddam", "Zamienię", "Wersja robocza"].map((name) => screen.getByRole("button", { name }));
}

/** Picks Dzieci › Wózki through the tree picker sheet. */
async function chooseStrollers() {
  categoryTrigger().focus();
  fireEvent.click(categoryTrigger());
  fireEvent.click(await screen.findByRole("button", { name: "Dzieci" }));
  fireEvent.click(screen.getByRole("button", { name: "Wózki" }));
  await waitFor(() => expect(categoryTrigger()).toHaveTextContent("Wózki"));
}

/** Fills the name and category; the only saved place (Kęty) is prefilled. */
async function fillForm(name = "Rowerek") {
  const view = renderPage();
  await waitFor(() => expect(placeSelect()).toHaveValue(KETY.id));
  fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: name } });
  await chooseStrollers();
  return view;
}

function addPhoto(file: File) {
  fireEvent.change(screen.getByLabelText("Dodaj zdjęcia"), { target: { files: [file] } });
}

beforeEach(() => {
  vi.resetAllMocks();
  panel.reset({
    ownSlug: "ania",
    items: [],
    refreshItems: vi.fn(async () => {}),
    itemDraft: createEmptyItemQuickAddValue(),
    itemPhotos: [],
  });
  vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY]);
  vi.mocked(categoriesApi.getCategories).mockResolvedValue([
    category(CAT_KIDS, "Dzieci", null, 0),
    category(CAT_STROLLERS, "Wózki", CAT_KIDS, 0),
    category(CAT_TOYS, "Zabawki", CAT_KIDS, 1),
  ]);
  vi.mocked(peopleApi.getMyProfile).mockResolvedValue({
    account_user_id: ACCOUNT_USER_ID,
  } as unknown as UserProfileResponse);
  vi.mocked(inventoriesApi.getOrCreatePersonalInventory).mockResolvedValue({
    id: INVENTORY_ID,
  } as unknown as InventoryResponse);
  vi.mocked(productsApi.resolveProduct).mockResolvedValue({
    id: PRODUCT_ID,
  } as unknown as ProductResponse);
  vi.mocked(inventoriesApi.registerInventoryItem).mockResolvedValue({
    id: NEW_ITEM_ID,
  } as unknown as InventoryItemResponse);
  let preview = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${(preview += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

describe("ItemCreateView", () => {
  it("keeps Oddam, Zamienię and Wersja robocza aria-disabled until a name and a category are set", async () => {
    renderPage();

    expect(screen.getByRole("region", { name: "Dodaj rzecz" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Typ")).not.toBeInTheDocument();
    expect(screen.queryByText(/Moje rzeczy/)).not.toBeInTheDocument();
    for (const button of actionButtons()) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).toHaveAttribute("aria-disabled", "true");
      // Still focusable, so keyboard users reach the missing-fields hint.
      expect(button).toBeEnabled();
      button.focus();
      expect(button).toHaveFocus();
    }

    await waitFor(() => expect(placeSelect()).toHaveValue(KETY.id));
    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "   " } });
    await chooseStrollers();
    for (const button of actionButtons()) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button);
    }
    expect(productsApi.resolveProduct).not.toHaveBeenCalled();
    expect(inventoriesApi.registerInventoryItem).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    for (const button of actionButtons()) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute("aria-disabled");
    }
  });

  it("tells screen-reader users why the disabled actions are disabled", async () => {
    renderPage();
    await waitFor(() => expect(placeSelect()).toHaveValue(KETY.id));

    // Screen-reader only: the description stays, the visible hint is gone.
    expect(screen.getByText(MISSING_HINT)).toHaveClass("sr-only");
    for (const button of actionButtons()) expect(button).toHaveAccessibleDescription(MISSING_HINT);

    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    for (const button of actionButtons()) expect(button).toHaveAccessibleDescription(MISSING_HINT);

    await chooseStrollers();
    expect(screen.queryByText(MISSING_HINT)).not.toBeInTheDocument();
    for (const button of actionButtons()) {
      expect(button).not.toHaveAttribute("aria-disabled");
      expect(button).not.toHaveAttribute("aria-describedby");
    }
  });

  it("keeps the actions blocked without a place: empty picker, hint, and an error on a click", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(placeSelect()).toHaveTextContent("Nie masz jeszcze miejsc"));
    fireEvent.change(screen.getByLabelText("Nazwa"), { target: { value: "Rowerek" } });
    await chooseStrollers();

    expect(
      screen.getByText("Dodaj miejsce przyciskiem „+”. Wrócisz tu z zachowanymi danymi i zdjęciami."),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Dodaj nowe miejsce" })).toBeInTheDocument();
    for (const button of actionButtons()) {
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAccessibleDescription(MISSING_HINT);
    }
    expect(placeSelect()).not.toHaveAttribute("aria-invalid");

    fireEvent.click(screen.getByRole("button", { name: "Oddam" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz lokalizację");
    expect(placeSelect()).toHaveAttribute("aria-invalid", "true");
    expect(peopleApi.getMyProfile).not.toHaveBeenCalled();
    expect(inventoriesApi.registerInventoryItem).not.toHaveBeenCalled();
  });

  it("keeps the typed draft and photos in the panel across an unmount and remount", async () => {
    const view = await fillForm();
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Mało używany" } });
    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeInTheDocument();

    view.unmount();
    expect(screen.queryByLabelText("Nazwa")).not.toBeInTheDocument();
    renderPage();

    expect(screen.getByLabelText("Nazwa")).toHaveValue("Rowerek");
    expect(screen.getByLabelText("Opis")).toHaveValue("Mało używany");
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeInTheDocument();
    await waitFor(() => expect(categoryTrigger()).toHaveTextContent("Wózki"));
    await waitFor(() => expect(placeSelect()).toHaveValue(KETY.id));
  });

  it("gives a kept draft photo a fresh, unrevoked preview when the page's effects re-run (back from /places/new)", async () => {
    panel.reset({ ...panel.get(), itemPhotos: [new File(["a"], "a.jpg", { type: "image/jpeg" })] });
    const page = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <ItemCreateView />
      </Activity>
    );
    const view = renderWithRoute(page("visible"), {
      url: "/add/product",
      pattern: "/add/product",
      wrapper: createQueryWrapper(),
    });
    await waitFor(() => expect(view.container.querySelector("img")).not.toBeNull());

    // Hiding runs the effect cleanups (revoking the previews) but keeps the state, as a remount in dev does.
    view.rerender(page("hidden"));
    view.rerender(page("visible"));

    await waitFor(() => {
      const src = view.container.querySelector("img")?.getAttribute("src");
      expect(src).toMatch(/^blob:preview-/);
      expect(vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)).not.toContain(src);
    });
  });

  it("clears the draft and photos after a successful create, before the item page shows", async () => {
    vi.mocked(productsApi.addProductPhoto).mockResolvedValue(
      {} as Awaited<ReturnType<typeof productsApi.addProductPhoto>>,
    );
    await fillForm();
    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));

    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(screen.getByText("DRAFT NAME []")).toBeInTheDocument();
    expect(panel.get().itemDraft).toEqual(createEmptyItemQuickAddValue());
    expect(panel.get().itemPhotos).toEqual([]);
    expect(panel.get().refreshItems).toHaveBeenCalled();
  });

  it.each([
    [
      "the newest item's live place",
      [myItem("i1", KETY.id, "2026-10-01T10:00:00"), myItem("i2", POZNAN.id, "2026-10-02T10:00:00")],
      POZNAN.id,
    ],
    [
      "the newest live place, skipping a newer item whose place is gone",
      [myItem("i1", KETY.id, "2026-10-01T10:00:00"), myItem("i2", "loc-deleted", "2026-10-03T10:00:00")],
      KETY.id,
    ],
    ["nothing with several places and no located item", [myItem("i1", null, "2026-10-01T10:00:00")], ""],
  ])("prefills %s", async (_label, items, expected) => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, POZNAN]);
    panel.reset({ ...panel.get(), items });
    renderPage();

    await waitFor(() => expect(within(placeSelect()).getAllByRole("option")).toHaveLength(3));
    await waitFor(() => expect(placeSelect()).toHaveValue(expected));
  });

  it("keeps the resumed draft and its place when /places/new hands back a cancelled (null) pick", async () => {
    vi.mocked(locationsApi.getMyLocations).mockResolvedValue([KETY, POZNAN]);
    panel.reset({
      ...panel.get(),
      items: [myItem("i1", KETY.id, "2026-10-01T10:00:00")],
      itemDraft: { ...createEmptyItemQuickAddValue(), name: "Rowerek", location_id: POZNAN.id },
    });
    renderWithRoute(<ItemCreateView />, {
      url: "/add/product",
      pattern: "/add/product",
      state: { pickedLocation: { picker: "item-create-place", locationId: null } },
      wrapper: createQueryWrapper(),
    });

    await waitFor(() => expect(within(placeSelect()).getAllByRole("option")).toHaveLength(3));
    expect(placeSelect()).toHaveValue(POZNAN.id);
    expect(screen.getByLabelText("Nazwa")).toHaveValue("Rowerek");
    expect(storedDraft().location_id).toBe(POZNAN.id);
  });

  it("treats a resumed draft's deleted place as no place: inline error, no request", async () => {
    panel.reset({
      ...panel.get(),
      itemDraft: { ...createEmptyItemQuickAddValue(), name: "Rowerek", location_id: "loc-deleted" },
    });
    renderPage();
    await waitFor(() => expect(within(placeSelect()).getAllByRole("option")).toHaveLength(2));
    await chooseStrollers();

    for (const button of actionButtons()) expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Oddam" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz lokalizację");
    expect(placeSelect()).toHaveAttribute("aria-invalid", "true");
    expect(inventoriesApi.registerInventoryItem).not.toHaveBeenCalled();
  });

  it("does not prefill over a resumed draft", async () => {
    panel.reset({ ...panel.get(), itemDraft: { ...createEmptyItemQuickAddValue(), name: "Rowerek" } });
    renderPage();

    await waitFor(() => expect(within(placeSelect()).getAllByRole("option")).toHaveLength(2));
    expect(placeSelect()).toHaveValue("");
  });

  it("orders the page Zdjęcia, Nazwa, Stan, Kategoria, Opis, Lokalizacja and saves the description to the product", async () => {
    vi.mocked(productsApi.updateProductDescription).mockResolvedValue(
      {} as Awaited<ReturnType<typeof productsApi.updateProductDescription>>,
    );
    await fillForm();

    const fields = [
      screen.getByLabelText("Dodaj zdjęcia"),
      screen.getByLabelText("Nazwa"),
      screen.getByLabelText("Stan"),
      categoryTrigger(),
      screen.getByLabelText("Opis"),
      placeSelect(),
    ];
    for (const [before, after] of fields.slice(0, -1).map((field, i) => [field, fields[i + 1]])) {
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByText("Kupujący zobaczą tylko miejscowość. Adres widzisz tylko Ty.")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "  Mało używany  " } });
    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.updateProductDescription).toHaveBeenCalledWith(PRODUCT_ID, "Mało używany");
  });

  it.each([
    ["Oddam", "GIFT"],
    ["Zamienię", "SWAP"],
    ["Wersja robocza", null],
  ] as const)("%s registers the item at its place with listing_mode %s, then uploads the photos", async (label, mode) => {
    const photo = new File(["a"], "a.jpg", { type: "image/jpeg" });
    vi.mocked(productsApi.addProductPhoto).mockResolvedValue(
      {} as Awaited<ReturnType<typeof productsApi.addProductPhoto>>,
    );
    await fillForm("  Rowerek  ");
    fireEvent.change(screen.getByLabelText("Stan"), { target: { value: "LIKE_NEW" } });
    addPhoto(photo);

    fireEvent.click(screen.getByRole("button", { name: label }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.resolveProduct).toHaveBeenCalledWith({ name: "Rowerek", category_id: CAT_STROLLERS });
    expect(inventoriesApi.registerInventoryItem).toHaveBeenCalledWith({
      inventory_id: INVENTORY_ID,
      product_id: PRODUCT_ID,
      condition: "LIKE_NEW",
      location_id: KETY.id,
      listing_mode: mode,
    });
    expect(vi.mocked(productsApi.addProductPhoto).mock.calls).toEqual([[PRODUCT_ID, photo]]);
    const registerOrder = vi.mocked(inventoriesApi.registerInventoryItem).mock.invocationCallOrder[0];
    expect(registerOrder).toBeLessThan(vi.mocked(productsApi.addProductPhoto).mock.invocationCallOrder[0]);
  });

  it("skips an empty description", async () => {
    await fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));
    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.updateProductDescription).not.toHaveBeenCalled();
  });

  it("still opens the new item when the description is refused, with a notice", async () => {
    vi.mocked(productsApi.updateProductDescription).mockRejectedValue(new ApiError(500, "Internal Server Error", {}));
    await fillForm();
    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Opis" } });
    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("nie udało się zapisać opisu");
  });

  it("an empty gallery is one big add tile; a photo shows a tile with Usuń and the main add button", async () => {
    renderPage();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /^Usuń zdjęcie/ })).not.toBeInTheDocument();

    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));
    expect(screen.getByText("+ Dodaj zdjęcia")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Usuń zdjęcie 1" }));
    expect(screen.queryByRole("button", { name: "Usuń zdjęcie 1" })).not.toBeInTheDocument();
    expect(screen.queryByText("+ Dodaj zdjęcia")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dodaj zdjęcia")).toBeEnabled();
  });

  it("shows a 409 verbatim and keeps the form data", async () => {
    vi.mocked(inventoriesApi.registerInventoryItem).mockRejectedValue(
      new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: CONFLICT_MESSAGE }),
    );
    await fillForm();
    fireEvent.change(screen.getByLabelText("Stan"), { target: { value: "NEW" } });
    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));

    fireEvent.click(screen.getByRole("button", { name: "Oddam" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(CONFLICT_MESSAGE);
    expect(productsApi.addProductPhoto).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Nazwa")).toHaveValue("Rowerek");
    expect(screen.getByLabelText("Stan")).toHaveValue("NEW");
    expect(categoryTrigger()).toHaveTextContent("Wózki");
    expect(screen.getByRole("button", { name: "Usuń zdjęcie 1" })).toBeInTheDocument();
    for (const button of actionButtons()) expect(button).toBeEnabled();
  });

  it("sends no request when Enter submits the form from the name input", async () => {
    await fillForm();
    const name = screen.getByLabelText("Nazwa");

    fireEvent.keyDown(name, { key: "Enter" });
    fireEvent.submit(name.closest("form")!);

    expect(peopleApi.getMyProfile).not.toHaveBeenCalled();
    expect(inventoriesApi.registerInventoryItem).not.toHaveBeenCalled();
    expect(screen.queryByText(`ITEM PAGE ${NEW_ITEM_ID}`)).not.toBeInTheDocument();
  });

  it("falls back to a Polish message for an unexpected error", async () => {
    vi.mocked(inventoriesApi.registerInventoryItem).mockRejectedValue(new ApiError(500, "Server Error", null));
    await fillForm();

    fireEvent.click(screen.getByRole("button", { name: "Zamienię" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się dodać rzeczy. Spróbuj ponownie.");
  });

  it("still opens the new item when a photo is refused and tells how many failed", async () => {
    vi.mocked(productsApi.addProductPhoto)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { message: "Duplikat" }))
      .mockResolvedValueOnce({} as Awaited<ReturnType<typeof productsApi.addProductPhoto>>);
    await fillForm();
    addPhoto(new File(["a"], "a.jpg", { type: "image/jpeg" }));
    addPhoto(new File(["b"], "b.png", { type: "image/png" }));

    fireEvent.click(screen.getByRole("button", { name: "Wersja robocza" }));

    expect(await screen.findByText(`ITEM PAGE ${NEW_ITEM_ID}`)).toBeInTheDocument();
    expect(productsApi.addProductPhoto).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("nie udało się dodać części zdjęć (1)");
  });

  it("rejects an unsupported photo with a message and keeps the list empty", async () => {
    renderPage();
    await act(async () => {});

    addPhoto(new File(["gif"], "a.gif", { type: "image/gif" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Nieobsługiwany plik — dodaj zdjęcie JPG, PNG lub WebP");
    expect(screen.queryByRole("button", { name: "Usuń zdjęcie 1" })).not.toBeInTheDocument();
  });
});
