import { fireEvent, screen } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemStatusResponse } from "../api/items";
import { ItemStatusCard } from "../features/product/blocks/ItemStatus";
import * as calendar from "../utils/calendar";

vi.mock("../utils/calendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/calendar")>();
  return { ...actual, downloadIcs: vi.fn() };
});

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";

function eventStatus(over: Partial<ItemStatusResponse> = {}): ItemStatusResponse {
  return {
    code: "RESERVED",
    term_occurs_on: "2026-10-14T16:30:00",
    due_date: null,
    counterparty_label: "Anna K.",
    term_id: null,
    group_id: null,
    group_name: "Kiermasz rzeczy",
    event_id: EVENT_ID,
    event_slug: "ania",
    personal_pickup: false,
    ...over,
  };
}

function renderCard(status: ItemStatusResponse) {
  return renderWithRoute(
    <ItemStatusCard status={status} itemId={ITEM_ID} itemName="Rowerek" isOwner={false} />,
    { url: "/" },
  );
}

describe("ItemStatusCard event reservation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 13, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("party sees the event date and name and a link to the event page", () => {
    renderCard(eventStatus());

    expect(screen.getByRole("status")).toHaveTextContent("Zarezerwowana — odbiór w śr 14.10 o 16:30 · Kiermasz rzeczy");
    expect(screen.getByRole("link", { name: "Zobacz wydarzenie" })).toHaveAttribute("href", `/ania/event/${EVENT_ID}`);
  });

  it("calendar export points at the event page and uses the event id in the uid", () => {
    renderCard(eventStatus());

    fireEvent.click(screen.getByRole("button", { name: /Dodaj do kalendarza/ }));
    const google = new URL(screen.getByRole("menuitem", { name: /Kalendarz Google/ }).getAttribute("href") ?? "");
    expect(google.searchParams.get("details")).toContain(`${window.location.origin}/ania/event/${EVENT_ID}`);
    fireEvent.click(screen.getByRole("menuitem", { name: /\.ics/ }));
    expect(vi.mocked(calendar.downloadIcs).mock.calls[0][0].uid).toBe(calendar.calendarUid(EVENT_ID, ITEM_ID));
  });

  it("non-party viewer of an event reservation sees only the date", () => {
    renderCard(eventStatus({ group_name: null, event_id: null, event_slug: null }));

    expect(screen.getByRole("status")).toHaveTextContent("Zarezerwowana — odbiór na terminie 14.10");
    expect(screen.queryByRole("link", { name: "Zobacz wydarzenie" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj do kalendarza/ })).not.toBeInTheDocument();
  });
});

describe("ItemStatusCard personal pickup", () => {
  const personal = (code: "RESERVED" | "IN_TRANSIT"): ItemStatusResponse => ({
    code,
    term_occurs_on: null,
    due_date: null,
    counterparty_label: "Anna K.",
    term_id: null,
    group_id: null,
    group_name: null,
    event_id: null,
    event_slug: null,
    personal_pickup: true,
  });

  it.each([
    ["RESERVED", "Zarezerwowana"],
    ["IN_TRANSIT", "W drodze"],
  ] as const)("%s reads %s with the chat line and no date or calendar", (code, title) => {
    renderCard(personal(code));

    expect(screen.getByRole("status")).toHaveTextContent(new RegExp(`^${title}$`));
    expect(screen.getByText("Odbiór osobisty — szczegóły ustalacie na czacie.")).toBeInTheDocument();
    expect(screen.queryByText(/odbiór na terminie/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Dodaj do kalendarza/ })).not.toBeInTheDocument();
  });
});
