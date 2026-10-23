import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ModalSheet } from "../components/shared/ModalSheet";
import { JoinByCodeSheet } from "../pages/term/modals/JoinByCodeSheet";
import { getOpenSheetCount, subscribeOpenSheets, useRegisterOpenSheet } from "../components/shared/openSheets";
import { UnsavedChangesDialog } from "../pages/organizer/editor/UnsavedChangesDialog";
import { ModalSheet as AppModalSheet } from "../components/shared/appComponents";

function Opener({ removeOpenerOnOpen = false }: { removeOpenerOnOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <main tabIndex={-1}>
      {!(open && removeOpenerOnOpen) && <button onClick={() => setOpen(true)}>Otwórz</button>}
      {open && (
        <ModalSheet title="Arkusz" onClose={() => setOpen(false)}>
          <p>Treść</p>
        </ModalSheet>
      )}
    </main>
  );
}

describe("ModalSheet", () => {
  it("closes on Escape pressed inside the dialog", () => {
    const onClose = vi.fn();
    render(
      <ModalSheet title="Arkusz" onClose={onClose}>
        <button>Akcja</button>
      </ModalSheet>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Akcja" }), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores an Escape a child already handled with preventDefault", () => {
    const onClose = vi.fn();
    render(
      <ModalSheet title="Arkusz" onClose={onClose}>
        <button
          onKeyDown={(event) => {
            if (event.key === "Escape") event.preventDefault();
          }}
        >
          Menu
        </button>
      </ModalSheet>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Menu" }), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("moves focus into the dialog on open and back to the opener on close", () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "Otwórz" });
    opener.focus();

    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Arkusz" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("falls back to main when the opener is gone after close", () => {
    render(<Opener removeOpenerOnOpen />);
    const opener = screen.getByRole("button", { name: "Otwórz" });
    opener.focus();

    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Zamknij" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("wraps Tab from the last control to the first and Shift+Tab back to the last", () => {
    render(
      <ModalSheet title="Arkusz" onClose={() => {}}>
        <input aria-label="Nazwa" />
        <button>Zapisz</button>
      </ModalSheet>,
    );
    const close = screen.getByRole("button", { name: "Zamknij" });
    const save = screen.getByRole("button", { name: "Zapisz" });

    save.focus();
    fireEvent.keyDown(save, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();

    const input = screen.getByRole("textbox", { name: "Nazwa" });
    input.focus();
    fireEvent.keyDown(input, { key: "Tab" });
    expect(input).toHaveFocus();
  });

  it("Shift+Tab from the dialog itself (focus on open) wraps to the last control", () => {
    render(
      <ModalSheet title="Arkusz" onClose={() => {}}>
        <button>Zapisz</button>
      </ModalSheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Arkusz" });
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });

    expect(screen.getByRole("button", { name: "Zapisz" })).toHaveFocus();
  });

  it("has a close button of at least 36px (h-9 w-9)", () => {
    render(
      <ModalSheet title="Arkusz" onClose={() => {}}>
        <p>Treść</p>
      </ModalSheet>,
    );

    expect(screen.getByRole("button", { name: "Zamknij" })).toHaveClass("h-9", "w-9");
  });
});

describe("openSheets registry", () => {
  it("counts a registered sheet while mounted and notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOpenSheets(listener);

    const { rerender, unmount } = renderHook(({ open }) => useRegisterOpenSheet(open), {
      initialProps: { open: true },
    });
    expect(getOpenSheetCount()).toBe(1);
    expect(listener).toHaveBeenCalled();

    rerender({ open: false });
    expect(getOpenSheetCount()).toBe(0);

    rerender({ open: true });
    expect(getOpenSheetCount()).toBe(1);

    listener.mockClear();
    unmount();
    expect(getOpenSheetCount()).toBe(0);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("registers page dialogs while rendered, except an opted-out krag ModalSheet", () => {
    const krag = render(
      <ModalSheet title="Arkusz" onClose={() => {}}>
        <p>Treść</p>
      </ModalSheet>,
    );
    expect(getOpenSheetCount()).toBe(1);
    krag.unmount();

    const host = render(
      <ModalSheet title="Host" onClose={() => {}} registerAsPageSheet={false}>
        <p>Treść</p>
      </ModalSheet>,
    );
    expect(getOpenSheetCount()).toBe(0);
    host.unmount();

    const others = render(
      <>
        <AppModalSheet title="Panel" onClose={() => {}}>
          <p>Treść</p>
        </AppModalSheet>
        <JoinByCodeSheet initialCode="" autoSubmit={false} onSubmit={async () => {}} onClose={() => {}} />
        <UnsavedChangesDialog onDiscard={() => {}} onKeepEditing={() => {}} />
      </>,
    );
    expect(getOpenSheetCount()).toBe(3);

    act(() => others.unmount());
    expect(getOpenSheetCount()).toBe(0);
  });
});
