import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExchangeMode } from "../api/groups";
import type { ItemContextOptionResponse } from "../api/itemActions";
import { ChooseContextSheet } from "../features/product/ChooseContextSheet";

const TERM_CONTEXT: ItemContextOptionResponse = {
  kind: "TERM",
  id: "t-1",
  name: "Wymianka przedszkolna",
  starts_at: "2026-11-07T10:00:00",
  path: "/bartek/group/g-1/term/t-1",
  has_started: false,
  location_name: "Przedszkole nr 12",
  eligible: true,
};

describe("ChooseContextSheet", () => {
  it.each<[ExchangeMode, string]>([
    ["GIFT", "Rezerwuję na ten termin"],
    ["SWAP", "Dalej: wybierz rzecz na zamianę"],
    ["POINTS", "Dalej: zablokuj punkty"],
  ])("names the confirm button for %s: %s", (mode, label) => {
    render(
      <ChooseContextSheet ownerName="Bartek" mode={mode} contexts={[TERM_CONTEXT]} onConfirm={vi.fn()} onClose={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: label })).toBeEnabled();
  });
});
