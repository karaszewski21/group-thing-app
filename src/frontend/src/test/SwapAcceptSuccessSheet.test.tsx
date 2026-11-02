import { fireEvent, screen } from "@testing-library/react";
import { renderWithRoute } from "./renderWithRoute";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SwapAcceptSuccessSheet, type AcceptedSwap } from "../features/items/SwapAcceptSuccessSheet";
import * as calendar from "../utils/calendar";

vi.mock("../utils/calendar", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/calendar")>();
  return { ...actual, downloadIcs: vi.fn() };
});

const ITEM_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";

function eventSwap(over: Partial<AcceptedSwap> = {}): AcceptedSwap {
  return {
    myItemName: "Rowerek",
    offeredName: "Hulajnoga",
    occursOn: "2026-10-14T16:30:00",
    groupName: "Kiermasz rzeczy",
    groupId: null,
    termId: null,
    eventId: EVENT_ID,
    eventSlug: "ania",
    itemId: ITEM_ID,
    hadOtherOffers: false,
    ...over,
  };
}

function renderSheet(swap: AcceptedSwap) {
  return renderWithRoute(<SwapAcceptSuccessSheet swap={swap} onClose={() => {}} />, { url: "/" });
}

describe("SwapAcceptSuccessSheet event branch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("shows the event name, date and a link to the event page", () => {
    renderSheet(eventSwap());

    expect(screen.getByText("śr 14.10 o 16:30")).toBeInTheDocument();
    expect(screen.getByText("— Kiermasz rzeczy")).toBeInTheDocument();
    expect(screen.getByText(/na tym wydarzeniu/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zobacz wydarzenie" })).toHaveAttribute("href", `/ania/event/${EVENT_ID}`);
  });

  it("exports the event to the calendar with the event id as the uid", () => {
    renderSheet(eventSwap());

    fireEvent.click(screen.getByRole("button", { name: /Dodaj do kalendarza/ }));
    const google = new URL(screen.getByRole("menuitem", { name: /Kalendarz Google/ }).getAttribute("href") ?? "");
    expect(google.searchParams.get("details")).toContain(`${window.location.origin}/ania/event/${EVENT_ID}`);
    fireEvent.click(screen.getByRole("menuitem", { name: /\.ics/ }));
    expect(vi.mocked(calendar.downloadIcs).mock.calls[0][0].uid).toBe(calendar.calendarUid(EVENT_ID, ITEM_ID));
  });
});
