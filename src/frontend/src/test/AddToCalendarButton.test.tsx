import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AddToCalendarButton } from "../components/shared/AddToCalendarButton";
import type { CalendarEvent } from "../utils/calendar";

const EVENT: CalendarEvent = {
  uid: "term-1-item-9@krag-grupy",
  title: "Odbiór: Pucio",
  occursOn: "2026-10-15T16:30:00",
  groupName: "Krąg Mokotów",
  url: "https://krag.example/krag/g1/t1",
};

function renderButton() {
  render(<AddToCalendarButton event={EVENT} size="lg" direction="up" />);
  return screen.getByRole("button", { name: /Dodaj do kalendarza/ });
}

describe("AddToCalendarButton", () => {
  it("opens an ARIA menu, focuses the first item and moves focus with the arrow keys", () => {
    const trigger = renderButton();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAccessibleName("Kalendarz Google");
    expect(items[1]).toHaveAccessibleName("Apple / Outlook (.ics)");
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(items[1]).toHaveFocus();
  });

  it("Esc closes only the menu: focus returns to the trigger and the event does not propagate", () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <AddToCalendarButton event={EVENT} size="sm" direction="down" />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: /Dodaj do kalendarza/ });
    fireEvent.click(trigger);

    const notCancelled = fireEvent.keyDown(screen.getAllByRole("menuitem")[0], { key: "Escape" });

    expect(notCancelled).toBe(false);
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("Tab and an outside click close the menu; Tab hands focus back to the trigger first", () => {
    const trigger = renderButton();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getAllByRole("menuitem")[0], { key: "Tab" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("links to Google Calendar in a new tab and downloads the .ics file", () => {
    const createObjectURL = vi.fn(() => "blob:ics");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const trigger = renderButton();
    fireEvent.click(trigger);
    const google = screen.getByRole("menuitem", { name: "Kalendarz Google" });
    expect(google.tagName).toBe("A");
    expect(google).toHaveAttribute("target", "_blank");
    expect(google).toHaveAttribute("rel", "noopener noreferrer");
    expect(google.getAttribute("href")).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      fireEvent.click(screen.getByRole("menuitem", { name: "Apple / Outlook (.ics)" }));
      vi.runAllTimers();
    } finally {
      vi.useRealTimers();
    }

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:ics");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    click.mockRestore();
  });

  it("returns focus to the trigger after either menu item is activated", () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:ics"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const trigger = renderButton();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Kalendarz Google" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    trigger.blur();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Apple / Outlook (.ics)" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    click.mockRestore();
  });

  it("keeps the trigger label on one line", () => {
    expect(renderButton()).toHaveClass("whitespace-nowrap");
  });
});
