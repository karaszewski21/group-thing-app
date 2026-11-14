import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as localitiesApi from "../api/localities";
import type { Locality } from "../api/locations";
import { LocalityCombobox } from "../components/shared/LocalityCombobox";
import { makeLocality, makeLocalitySearchResult } from "./fixtures/locations";
import { withQueryClient } from "./queryClient";

vi.mock("../api/localities", () => ({ searchLocalities: vi.fn() }));

const NOWA_WIES_ELCKA = makeLocalitySearchResult({
  id: "0480001",
  name: "Nowa Wieś Ełcka",
  kind: "TOWN",
  gmina: "Kalinowo",
  powiat: "ełcki",
  voivodeship: "warmińsko-mazurskie",
});
const NOWA_WIES = makeLocalitySearchResult({ id: "0937999", name: "Nowa Wieś", kind: "VILLAGE" });

/** The combobox as a host form drives it: the picked locality in state. */
function Host({ onPick = () => {} }: { onPick?: (locality: Locality | null) => void }) {
  const [value, setValue] = useState<Locality | null>(null);
  return (
    <LocalityCombobox
      idPrefix="test"
      value={value}
      onChange={(next) => {
        setValue(next);
        onPick(next);
      }}
    />
  );
}

function renderCombobox(onPick?: (locality: Locality | null) => void) {
  return render(withQueryClient(<Host onPick={onPick} />));
}

async function typeAndWaitForOptions(text: string) {
  const input = screen.getByRole("combobox", { name: "Miejscowość" });
  fireEvent.change(input, { target: { value: text } });
  await screen.findByRole("listbox");
  return input;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("LocalityCombobox", () => {
  it("lists suggestions with the detail line, '· miasto' for a town and a non-option overflow line", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [NOWA_WIES_ELCKA, NOWA_WIES], total: 414 });
    renderCombobox();

    expect(screen.getByPlaceholderText("Nazwa lub kod pocztowy")).toBeInTheDocument();
    expect(screen.getByText("Np. „Kęty”, „Nowa Wieś” albo „32-650”.")).toBeInTheDocument();
    await typeAndWaitForOptions("Nowa Wie");

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Nowa Wieś Ełcka");
    expect(options[0]).toHaveTextContent("gm. Kalinowo, pow. ełcki, warmińsko-mazurskie · miasto");
    expect(options[1]).toHaveTextContent("gm. Kęty, pow. oświęcimski, małopolskie");
    expect(options[1]).not.toHaveTextContent("miasto");
    const overflow = screen.getByText("… i 412 więcej — doprecyzuj wpis");
    expect(overflow).not.toHaveAttribute("role", "option");
    expect(within(screen.getByRole("listbox")).queryByText(/więcej/)).not.toBeInTheDocument();
  });

  it("postal mode prefixes the detail line with the code", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({
      results: [makeLocalitySearchResult({ postal_code: "32-650" })],
      total: 1,
    });
    renderCombobox();
    await typeAndWaitForOptions("32-650");

    expect(screen.getByRole("option")).toHaveTextContent("32-650 · gm. Kęty, pow. oświęcimski, małopolskie · miasto");
    expect(screen.queryByText(/więcej/)).not.toBeInTheDocument();
  });

  it("ArrowDown + Enter picks the option and shows the chip with 'zmień'", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [NOWA_WIES_ELCKA, NOWA_WIES], total: 2 });
    const onPick = vi.fn();
    renderCombobox(onPick);
    const input = await typeAndWaitForOptions("Nowa");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "test-locality-opt-1");
    expect(input).toHaveAttribute("aria-controls", "test-locality-listbox");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onPick).toHaveBeenLastCalledWith(makeLocality({ id: "0937999", name: "Nowa Wieś", kind: "VILLAGE" }));
    const chip = screen.getByRole("group", { name: "Miejscowość" });
    expect(chip).toHaveTextContent("Nowa Wieś");
    expect(chip).toHaveTextContent("gm. Kęty, pow. oświęcimski, małopolskie");

    fireEvent.click(within(chip).getByRole("button", { name: "Zmień miejscowość Nowa Wieś" }));
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("combobox", { name: "Miejscowość" })).toHaveFocus();
  });

  it("Esc closes only the listbox: the event is default-prevented and does not reach the parent", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [NOWA_WIES], total: 1 });
    const parentKeyDown = vi.fn();
    render(
      withQueryClient(
        <div onKeyDown={parentKeyDown}>
          <Host />
        </div>,
      ),
    );
    const input = await typeAndWaitForOptions("Nowa");

    const notPrevented = fireEvent.keyDown(input, { key: "Escape" });
    expect(notPrevented).toBe(false);
    expect(parentKeyDown).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-controls");
  });

  it("typed text never picked shows 'Wybierz miejscowość z listy' with aria-invalid", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [], total: 0 });
    renderCombobox();
    const input = screen.getByRole("combobox", { name: "Miejscowość" });

    fireEvent.change(input, { target: { value: "Kenty" } });
    fireEvent.blur(input);

    expect(screen.getByRole("alert")).toHaveTextContent("Wybierz miejscowość z listy");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toContain("test-locality-error");
  });
  it("results shrinking under a highlighted option: Enter picks nothing and the highlight resets", async () => {
    vi.mocked(localitiesApi.searchLocalities)
      .mockResolvedValueOnce({ results: [NOWA_WIES_ELCKA, NOWA_WIES], total: 2 })
      .mockResolvedValueOnce({ results: [NOWA_WIES_ELCKA], total: 1 });
    const onPick = vi.fn();
    renderCombobox(onPick);
    const input = await typeAndWaitForOptions("Nowa");

    // The next query is still loading: the previous options stay listed.
    fireEvent.change(input, { target: { value: "Nowa Wieś E" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", "test-locality-opt-1");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));

    expect(input).not.toHaveAttribute("aria-activedescendant");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Miejscowość" })).toBeInTheDocument();
  });

  it("a query with no matches says so in the status region, outside any listbox", async () => {
    vi.mocked(localitiesApi.searchLocalities).mockResolvedValue({ results: [], total: 0 });
    renderCombobox();
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();

    fireEvent.change(screen.getByRole("combobox", { name: "Miejscowość" }), { target: { value: "Kenty" } });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Brak wyników — sprawdź pisownię albo wpisz kod pocztowy"),
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});
