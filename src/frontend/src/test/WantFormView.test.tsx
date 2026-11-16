import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as categoriesApi from "../api/categories";
import type { Category } from "../api/categories";
import { ApiError } from "../api/client";
import * as localitiesApi from "../api/localities";
import * as wantsApi from "../api/wants";
import { WantFormView } from "../features/wanted/WantFormView";
import { makeLocality, makeLocalitySearchResult } from "./fixtures/locations";
import { makeWant } from "./fixtures/wants";
import { withQueryClient } from "./queryClient";
import { getTestRouter, renderWithRoute } from "./renderWithRoute";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ token: "token-a" }) }));

vi.mock("../api/wants", () => ({
  getMyWants: vi.fn(),
  createWant: vi.fn(),
  updateWant: vi.fn(),
  extendWant: vi.fn(),
  closeWant: vi.fn(),
  resumeWant: vi.fn(),
}));

vi.mock("../api/localities", () => ({ searchLocalities: vi.fn(), getLocality: vi.fn() }));

vi.mock("../api/categories", () => ({
  getCategories: vi.fn(),
  deleteCategory: vi.fn(),
  moveCategory: vi.fn(),
}));

function category(id: string, name: string, parent_id: string | null): Category {
  return {
    id,
    name,
    description: null,
    parent_id,
    sort_order: 0,
    product_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const BIKES_ID = "5f2b8c1e-3a4d-4e6f-9a7b-1c2d3e4f5a6b";
const CATEGORIES = [category("toys", "Zabawki", null), category(BIKES_ID, "Pojazdy dla dzieci", "toys")];
const CAP_MESSAGE = "Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe.";
const CONTACT_MESSAGE =
  "Nazwa i opis nie mogą zawierać danych kontaktowych (numeru telefonu, e-maila, linków ani komunikatorów)";
const NAME_HINT = "Wpisz, czego szukasz (3–80 znaków).";
const NAME_ERROR = "Nazwa musi mieć od 3 do 80 znaków.";
const SAVED = makeWant({ id: "want-9" });
const EDITED = makeWant({
  id: "want-1",
  name: "Rowerek biegowy",
  note: "Dla 3-latka",
  category_id: BIKES_ID,
  category_name: "Pojazdy dla dzieci",
  category_path: "Zabawki › Pojazdy dla dzieci",
  offer_mode: "GIFT",
  locality_id: "0937730",
  locality_name: "Kęty",
  radius_km: 10,
});

function renderCreate(query = "") {
  return renderWithRoute(withQueryClient(<WantFormView />), {
    url: `/add/wanted${query}`,
    pattern: "/add/wanted",
    routes: { "/wanted/:id": <p>Lista dopasowań</p> },
  });
}

function renderEdit() {
  return renderWithRoute(withQueryClient(<WantFormView />), {
    url: "/wanted/want-1/edit",
    pattern: "/wanted/:id/edit",
    routes: { "/wanted/:id": <p>Lista dopasowań</p> },
  });
}

const nameInput = () => screen.getByLabelText("Czego szukasz?");
const disclosure = () => screen.getByRole("button", { name: "Doprecyzuj (opcjonalnie)" });
const chip = (name: string) => screen.getByRole("button", { name });
const submitButton = (name = "Zapisz poszukiwanie") => screen.getByRole("button", { name });

function typeName(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
}

function expectInOrder(elements: HTMLElement[]) {
  for (let i = 1; i < elements.length; i++) {
    expect(elements[i - 1].compareDocumentPosition(elements[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
}

/** Lets the list and category queries of a synchronous test land inside act(). */
async function settle() {
  await act(async () => {});
}

function replaceCalls() {
  return getTestRouter().calls.filter((call) => call.method === "replace");
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(wantsApi.getMyWants).mockResolvedValue([]);
  vi.mocked(categoriesApi.getCategories).mockResolvedValue(CATEGORIES);
  vi.mocked(localitiesApi.getLocality).mockResolvedValue(makeLocality());
  vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [makeLocalitySearchResult()], total: 1 });
});

describe("WantFormView", () => {
  it("empty create form: copy, collapsed disclosure, field order and a submit blocked by aria-disabled with the hint", async () => {
    renderCreate();

    expect(screen.getByRole("heading", { level: 1, name: "Szukam rzeczy" })).toBeInTheDocument();
    expect(
      screen.getByText("Napisz, czego szukasz — damy znać, gdy ktoś doda pasującą rzecz."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "‹ Dodaj" })).toHaveAttribute("href", "/add");
    expect(nameInput()).toHaveAttribute("placeholder", "Np. kask rowerowy dla dziecka");
    expect(screen.getByText("0/80 znaków")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Anuluj" })).not.toBeInTheDocument();

    const toggle = disclosure();
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeNull();
    expect(within(toggle).getByText("▸")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByLabelText("Notatka dla siebie")).not.toBeInTheDocument();

    const submit = submitButton();
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveAccessibleDescription(NAME_HINT);
    expect(screen.getByText(NAME_HINT)).toBeVisible();
    fireEvent.click(submit);
    expect(wantsApi.createWant).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(toggle).getByText("▾")).toHaveAttribute("aria-hidden", "true");
    const note = screen.getByLabelText("Notatka dla siebie");
    expect(panel).toContainElement(note);
    expect(note).toHaveAttribute("placeholder", "Rozmiar, kolor, do kiedy potrzebujesz");
    expect(screen.getByText("Widzisz ją tylko Ty. 0/300 znaków")).toBeInTheDocument();
    const locality = screen.getByRole("combobox", { name: "Miejscowość" });
    expect(locality).toHaveAttribute("placeholder", "Cała Polska — wpisz, aby zawęzić");
    expect(screen.getByRole("group", { name: "Jak chcesz dostać rzecz?" })).toBeInTheDocument();
    expectInOrder([
      nameInput(),
      toggle,
      screen.getByRole("button", { name: "Kategoria Dowolna kategoria" }),
      chip("Obojętnie"),
      chip("Oddam"),
      chip("Zamiana"),
      locality,
      note,
      submit,
    ]);
    await settle();
  });

  it("prefills from the query string, opens the disclosure and saves with replace to the match list", async () => {
    vi.mocked(wantsApi.createWant).mockResolvedValue(SAVED);
    renderCreate(`?name=rowerek%20biegowy&category=${BIKES_ID}&offer_type=GIFT&locality=0937730&radius=10`);

    expect(nameInput()).toHaveValue("rowerek biegowy");
    expect(screen.getByText("15/80 znaków")).toBeInTheDocument();
    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "‹ Szukaj" })).toHaveAttribute(
      "href",
      `/search?q=rowerek+biegowy&category=${BIKES_ID}&offer_type=GIFT&locality=0937730&radius=10`,
    );
    expect(chip("Oddam")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Obojętnie")).toHaveAttribute("aria-pressed", "false");
    expect(await screen.findByRole("button", { name: /^Kategoria .*Pojazdy dla dzieci/ })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Zmień miejscowość Kęty" })).toBeInTheDocument();
    expect(localitiesApi.getLocality).toHaveBeenCalledWith("0937730");
    expect(chip("+10 km")).toHaveAttribute("aria-pressed", "true");

    const submit = submitButton();
    expect(submit).not.toHaveAttribute("aria-disabled");
    fireEvent.click(submit);

    await waitFor(() => expect(replaceCalls()).toEqual([{ method: "replace", url: "/wanted/want-9", scroll: true }]));
    expect(wantsApi.createWant).toHaveBeenCalledWith({
      name: "rowerek biegowy",
      note: null,
      category_id: BIKES_ID,
      offer_mode: "GIFT",
      locality_id: "0937730",
      radius_km: 10,
    });
  });

  it.each([
    { title: "fails", lookup: () => Promise.reject(new ApiError(404, "Not Found", null)) },
    { title: "has not finished", lookup: () => new Promise<never>(() => {}) },
  ])("a create keeps the prefilled locality and radius when their lookup $title", async ({ lookup }) => {
    vi.mocked(localitiesApi.getLocality).mockImplementation(lookup);
    vi.mocked(wantsApi.createWant).mockResolvedValue(SAVED);
    renderCreate("?name=rowerek%20biegowy&locality=0937730&radius=10");
    await settle();

    fireEvent.click(submitButton());

    await waitFor(() => expect(wantsApi.createWant).toHaveBeenCalledTimes(1));
    expect(wantsApi.createWant).toHaveBeenCalledWith({
      name: "rowerek biegowy",
      note: null,
      category_id: null,
      offer_mode: null,
      locality_id: "0937730",
      radius_km: 10,
    });
  });

  it("shows an out-of-range prefilled name as typed with the inline error, and an over-length note blocks the submit", async () => {
    renderCreate("?name=tv");

    const name = nameInput();
    expect(name).toHaveValue("tv");
    expect(screen.getByRole("alert")).toHaveTextContent(NAME_ERROR);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(expect.stringContaining(NAME_ERROR));
    expect(disclosure()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("link", { name: "‹ Szukaj" })).toHaveAttribute("href", "/search?q=tv");
    const submit = submitButton();
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAccessibleDescription(NAME_ERROR);
    fireEvent.click(submit);
    expect(wantsApi.createWant).not.toHaveBeenCalled();

    const tooLong = "a".repeat(81);
    typeName(tooLong);
    expect(name).toHaveValue(tooLong);
    expect(screen.getByRole("alert")).toHaveTextContent(NAME_ERROR);

    typeName("kask rowerowy");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(submit).not.toHaveAttribute("aria-disabled");

    fireEvent.click(disclosure());
    const note = screen.getByLabelText("Notatka dla siebie");
    fireEvent.change(note, { target: { value: "n".repeat(301) } });
    expect(screen.getByRole("alert")).toHaveTextContent("Notatka może mieć najwyżej 300 znaków.");
    expect(screen.getByText("Widzisz ją tylko Ty. 301/300 znaków")).toBeInTheDocument();
    expect(note).toHaveAttribute("aria-invalid", "true");
    expect(submit).toHaveAttribute("aria-disabled", "true");
    expect(submit).toHaveAccessibleDescription("Notatka może mieć najwyżej 300 znaków.");
    fireEvent.click(submit);
    expect(wantsApi.createWant).not.toHaveBeenCalled();
    await settle();
  });

  it("offer chips are exclusive and „Obojętnie” sends null", async () => {
    vi.mocked(wantsApi.createWant).mockResolvedValue(SAVED);
    renderCreate();
    typeName("  Kask rowerowy ");
    fireEvent.click(disclosure());

    const pressed = () =>
      ["Obojętnie", "Oddam", "Zamiana"].filter((name) => chip(name).getAttribute("aria-pressed") === "true");
    expect(pressed()).toEqual(["Obojętnie"]);
    fireEvent.click(chip("Zamiana"));
    expect(pressed()).toEqual(["Zamiana"]);
    fireEvent.click(chip("Oddam"));
    expect(pressed()).toEqual(["Oddam"]);
    fireEvent.click(chip("Obojętnie"));
    expect(pressed()).toEqual(["Obojętnie"]);
    fireEvent.change(screen.getByLabelText("Notatka dla siebie"), { target: { value: " Rozmiar S " } });

    fireEvent.click(submitButton());

    await waitFor(() => expect(wantsApi.createWant).toHaveBeenCalledTimes(1));
    expect(wantsApi.createWant).toHaveBeenCalledWith({
      name: "Kask rowerowy",
      note: "Rozmiar S",
      category_id: null,
      offer_mode: null,
      locality_id: null,
      radius_km: null,
    });
  });

  it("a picked locality selects „Tylko tu” (null), with no town picker and no remembered search locality", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.mocked(wantsApi.createWant).mockResolvedValue(SAVED);
    renderCreate();
    typeName("Kask");
    fireEvent.click(disclosure());

    expect(screen.queryByRole("button", { name: "Tylko tu" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ostatnio/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Lokalizacja" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Województwo/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Większe miasta/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Miejscowość" }), { target: { value: "Kęt" } });
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option"));

    expect(chip("Tylko tu")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["+10 km", "+25 km", "+50 km"]) expect(chip(name)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip("+25 km"));
    fireEvent.click(chip("Tylko tu"));

    fireEvent.click(screen.getByRole("button", { name: "Kategoria Dowolna kategoria" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Dowolna kategoria" })).toHaveAttribute("type", "button");
    fireEvent.click(await within(sheet).findByRole("button", { name: "Zabawki" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Wybierz „Zabawki”" }));

    fireEvent.click(submitButton());

    await waitFor(() => expect(wantsApi.createWant).toHaveBeenCalledTimes(1));
    expect(wantsApi.createWant).toHaveBeenCalledWith({
      name: "Kask",
      note: null,
      category_id: "toys",
      offer_mode: null,
      locality_id: "0937730",
      radius_km: null,
    });
    expect(getItem).not.toHaveBeenCalledWith("search.lastLocality");
    expect(setItem).not.toHaveBeenCalledWith("search.lastLocality", expect.anything());
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it("shows server errors verbatim above the name, adds „Zobacz listę” for the limit and keeps the form filled", async () => {
    let rejectSave: (error: unknown) => void = () => {};
    vi.mocked(wantsApi.createWant).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    renderCreate();
    typeName("Hulajnoga");
    const submit = submitButton();

    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    rejectSave(new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: CAP_MESSAGE }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(CAP_MESSAGE);
    expect(within(alert).getByRole("link", { name: "Zobacz listę" })).toHaveAttribute("href", "/wanted");
    expect(alert.compareDocumentPosition(nameInput()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nameInput()).toHaveValue("Hulajnoga");
    expect(submit).not.toBeDisabled();
    expect(replaceCalls()).toEqual([]);

    vi.mocked(wantsApi.createWant).mockRejectedValueOnce(
      new ApiError(400, "Bad Request", { status: 400, error: "Bad Request", message: CONTACT_MESSAGE }),
    );
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(CONTACT_MESSAGE));
    expect(screen.getByRole("alert").textContent).toBe(CONTACT_MESSAGE);
    expect(screen.queryByRole("link", { name: "Zobacz listę" })).not.toBeInTheDocument();
    expect(nameInput()).toHaveValue("Hulajnoga");
  });

  it("„Zobacz listę” follows a create's 409 status, not the message's wording", async () => {
    const reworded = "Limit aktywnych poszukiwań osiągnięty.";
    vi.mocked(wantsApi.createWant)
      .mockRejectedValueOnce(new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: reworded }))
      .mockRejectedValueOnce(new ApiError(400, "Bad Request", { status: 400, error: "Bad Request", message: CAP_MESSAGE }));
    renderCreate();
    typeName("Hulajnoga");

    fireEvent.click(submitButton());
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(reworded));
    expect(within(alert).getByRole("link", { name: "Zobacz listę" })).toHaveAttribute("href", "/wanted");

    fireEvent.click(submitButton());
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(CAP_MESSAGE));
    expect(screen.queryByRole("link", { name: "Zobacz listę" })).not.toBeInTheDocument();
  });

  it("edit: a 409 on save shows the message without „Zobacz listę”", async () => {
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([EDITED]);
    vi.mocked(wantsApi.updateWant).mockRejectedValueOnce(
      new ApiError(409, "Conflict", { status: 409, error: "Conflict", message: CAP_MESSAGE }),
    );
    renderEdit();

    fireEvent.click(await screen.findByRole("button", { name: "Zapisz zmiany" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(CAP_MESSAGE));
    expect(screen.queryByRole("link", { name: "Zobacz listę" })).not.toBeInTheDocument();
  });

  it("edit: loads the want, shows the hint and „Anuluj”, and saves the changes with replace", async () => {
    vi.mocked(wantsApi.getMyWants).mockResolvedValue([EDITED]);
    vi.mocked(wantsApi.updateWant).mockResolvedValue(EDITED);
    renderEdit();

    expect(await screen.findByRole("heading", { level: 1, name: "Edytuj poszukiwanie" })).toBeInTheDocument();
    expect(screen.queryByText(/Napisz, czego szukasz/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "‹ Rowerek biegowy" })).toHaveAttribute("href", "/wanted/want-1");
    expect(screen.getByRole("link", { name: "Anuluj" })).toHaveAttribute("href", "/wanted/want-1");
    expect(
      screen.getByText("Zmiana nazwy, kategorii, sposobu lub miejsca wyszuka dopasowania od nowa."),
    ).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Rowerek biegowy");
    expect(disclosure()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Notatka dla siebie")).toHaveValue("Dla 3-latka");
    expect(chip("Oddam")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("button", { name: "Zmień miejscowość Kęty" })).toBeInTheDocument();
    expect(chip("+10 km")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(chip("Zamiana"));
    fireEvent.click(submitButton("Zapisz zmiany"));

    await waitFor(() => expect(replaceCalls()).toEqual([{ method: "replace", url: "/wanted/want-1", scroll: true }]));
    expect(wantsApi.updateWant).toHaveBeenCalledWith("want-1", {
      name: "Rowerek biegowy",
      note: "Dla 3-latka",
      category_id: BIKES_ID,
      offer_mode: "SWAP",
      locality_id: "0937730",
      radius_km: 10,
    });
  });

  it("edit: an unknown want shows the own not-found state and a closed one goes to its match list", async () => {
    const unknown = renderEdit();

    expect(await screen.findByRole("heading", { name: "Nie ma takiego poszukiwania" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wróć do listy „Szukam”" })).toHaveAttribute("href", "/wanted");
    expect(screen.queryByLabelText("Czego szukasz?")).not.toBeInTheDocument();
    unknown.unmount();

    vi.mocked(wantsApi.getMyWants).mockResolvedValue([makeWant({ id: "want-1", status: "EXPIRED" })]);
    renderEdit();

    expect(await screen.findByText("Lista dopasowań")).toBeInTheDocument();
    expect(replaceCalls()).toEqual([{ method: "replace", url: "/wanted/want-1", scroll: true }]);
  });
});
