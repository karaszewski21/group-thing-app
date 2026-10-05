import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as categoriesApi from "../api/categories";
import * as groupsApi from "../api/groups";
import * as productsApi from "../api/products";
import * as termsApi from "../api/terms";
import { EditTermDialog } from "../components/panel/EditTermDialog";
import { createQueryWrapper } from "./queryClient";

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
}));
vi.mock("../api/products", () => ({
  resolveProduct: vi.fn(),
}));
vi.mock("../api/terms", () => ({
  createNeededItem: vi.fn(),
  deleteNeededItem: vi.fn(),
  updateNeededItem: vi.fn(),
  updateTerm: vi.fn(),
}));
vi.mock("../api/groups", () => ({
  formalizeGroupFromTerm: vi.fn(),
  getTermAttendeesForFormalization: vi.fn(),
}));

const term: termsApi.TermResponse = {
  id: "t1",
  circle_group_id: "g1",
  occurs_on: "2026-10-14T17:00:00",
  description: "Park Sołacki",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  attendee_count: 0,
  child_count: 0,
};

const group: groupsApi.GroupResponse = {
  id: "g1",
  party_id: "p1",
  name: "Nutki",
  organizer_slug: null,
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const neededItem: termsApi.NeededItemResponse = {
  id: "ni1",
  term_id: "t1",
  product_id: "pr1",
  product_name: "Rower",
  product_category_id: "c1",
  product_category_name: "Zabawki",
  description: null,
  claimed: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderDialog() {
  return render(
    <EditTermDialog
      term={term}
      neededItems={[neededItem]}
      group={group}
      onChanged={vi.fn()}
      onClose={vi.fn()}
    />,
    { wrapper: createQueryWrapper() },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(categoriesApi.getCategories).mockResolvedValue([
    {
      id: "c1",
      name: "Zabawki",
      description: null,
      sortOrder: 0,
      productCount: 1,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ]);
  vi.mocked(groupsApi.getTermAttendeesForFormalization).mockResolvedValue([]);
});

describe("EditTermDialog — server error surfacing", () => {
  it("saveEdit_rejectedName_showsItemsErrorAndKeepsRowEditorOpen", async () => {
    const rejection = "Nazwa rzeczy narusza zasady społeczności. Zmień ją i spróbuj ponownie.";
    vi.mocked(productsApi.resolveProduct).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Edytuj potrzebną rzecz" }));
    fireEvent.change(screen.getByLabelText("Nazwa rzeczy"), { target: { value: "Zła nazwa" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[1]);

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.getByLabelText("Nazwa rzeczy")).toHaveValue("Zła nazwa");
    expect(termsApi.updateNeededItem).not.toHaveBeenCalled();
  });

  it("updateTerm_rejectedDescription_showsFormErrorAlert", async () => {
    const rejection = "Opis terminu narusza zasady społeczności. Zmień go i spróbuj ponownie.";
    vi.mocked(termsApi.updateTerm).mockRejectedValue(
      new ApiError(400, "Bad Request", { message: rejection }),
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Zły opis" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(rejection);
    expect(screen.getByLabelText("Opis")).toHaveValue("Zły opis");
  });

  it("updateTerm_moderationUnavailable_showsServerMessage", async () => {
    const unavailable = "Moderacja jest chwilowo niedostępna — spróbuj za chwilę.";
    vi.mocked(termsApi.updateTerm).mockRejectedValue(
      new ApiError(503, "Service Unavailable", { message: unavailable }),
    );
    renderDialog();

    fireEvent.change(screen.getByLabelText("Opis"), { target: { value: "Nowy opis" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Zapisz" })[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent(unavailable);
  });
});
