import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GroupResponse } from "../api/groups";
import { DeleteGroupDialog } from "../pages/meetings/DeleteGroupDialog";

const GROUP: GroupResponse = {
  id: "g-1",
  party_id: "p-1",
  name: "Joga w parku",
  organizer_slug: "ola",
  layout_mode: "CIRCLE",
  visibility: "PUBLIC",
  created_at: "2026-10-01T10:00:00",
  updated_at: "2026-10-01T10:00:00",
};

function renderDialog(onConfirm: () => Promise<void> = vi.fn(() => Promise.resolve())) {
  const onClose = vi.fn();
  render(<DeleteGroupDialog group={GROUP} onConfirm={onConfirm} onClose={onClose} />);
  return { onClose, onConfirm };
}

describe("DeleteGroupDialog", () => {
  it("focuses Anuluj initially and renders the title and body copy", () => {
    renderDialog();

    const dialog = screen.getByRole("alertdialog", { name: "Usunąć grupę „Joga w parku”?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(
      "Grupa zniknie dla uczestników. Jeśli to pomyłka, napisz do nas — przywrócimy ją.",
    );
    expect(screen.getByRole("button", { name: "Anuluj" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Usuń grupę" })).toBeEnabled();
  });

  it("Esc and Anuluj call onClose", () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("confirm shows Usuwanie… with both buttons disabled while pending", async () => {
    let resolve: () => void = () => {};
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const { onClose } = renderDialog(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "Usuń grupę" }));

    const busyButton = await screen.findByRole("button", { name: "Usuwanie…" });
    expect(busyButton).toBeDisabled();
    expect(busyButton).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Anuluj" })).toBeDisabled();
    expect(screen.getByRole("alertdialog")).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => resolve());
  });

  it("rejected onConfirm shows role=alert message and keeps dialog open", async () => {
    const onConfirm = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Grupy nie można usunąć — na termin 21.10 są zapisy."))
      .mockReturnValueOnce(new Promise<void>(() => {}));
    const { onClose } = renderDialog(onConfirm);

    fireEvent.click(screen.getByRole("button", { name: "Usuń grupę" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Grupy nie można usunąć — na termin 21.10 są zapisy.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Anuluj" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Usuń grupę" }));
    await screen.findByRole("button", { name: "Usuwanie…" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
